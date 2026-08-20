# Plan: external reminder creation & home screen widgets

Two prospective feature areas, broken into shippable phases. Beyond phase 1
(done — see below), nothing here is committed to yet; this is the design and
cost assessment, written down so the decisions and their reasoning survive.

**Neither feature needs a Rust change.** `src-tauri/src/lib.rs` stays plugin
wiring plus the SQLite migration; all of this is Kotlin in the hand-edited
`src-tauri/gen/android/` tree plus TypeScript. That tree already carries
`MainActivity.kt`, `SnoozeActionReceiver.kt` and manual manifest edits, so this
is consistent with existing practice — but it is more surface that
`tauri android init` cannot regenerate. See the "hand edits" note in
[CLAUDE.md](CLAUDE.md).

## Phases at a glance

| # | Phase | Size | Depends on | Status |
|---|---|---|---|---|
| 1 | Deep link + share target (foreground creation) | small | — | **Done** |
| 2 | App shortcuts | hours | 1 | **Done** |
| 3 | Headless creation broadcast | medium | 1 | **Done** |
| 4 | Quick-create widget | small | 3 | **Done** |
| 5 | Reminder list widget | medium | — | **Done** |

Recommended order is 1 → 2 → 3 → 4 → 5. Phases 1–2 deliver most of the
practical "create a reminder fast" value for a fraction of a widget's cost;
phase 5 is the most work and the most design-dependent, so it goes last.

All five are shipped.

---

## Phase 1 — Deep link + share target

Let another app (or a URL, or the share sheet) open Remind Me! with a reminder
request. The app comes to the foreground; the request is handed to the frontend
and either prefills the New Reminder form or creates the reminder outright.

### Surface

```
remindme://create?details=Take%20out%20the%20bins&at=2026-08-14T07:30:00Z
```

Plus an `ACTION_SEND` / `text/plain` filter, so "share text → Remind Me!" works
from any app, arriving as details with no time set.

### Design

The delivery mechanism is already written. `deliverNotificationAction()` in
`MainActivity.kt` retries `evaluateJavascript` on a 250 ms timer until the
frontend registers its handler, because a cold start has no webview yet. A
create-request has exactly that problem, so it gets exactly that treatment —
generalize the existing pending-action plumbing rather than writing a second
copy of it.

Frontend side: a `window.androidCreateRequest(json)` bridge target that parses
the request, routes through `useRouterStore()` to `HomeTabs.NewReminder`, and
either prefills `ReminderForm.vue` or calls
`notification_manager.schedule(...)` directly.

### The replay trap

`launchMode="singleTask"` redelivers the task's base intent when the user
relaunches from Recents, and again on in-process recreation. That is precisely
why `MainActivity.kt` carries `HANDLED_ACTION_KEY`, `fingerprint()` and the
`FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` check for notification actions.

**A create-intent travels the identical path.** Without the same guard, a
deep-link launch that is later resumed from Recents silently creates a second
reminder. The existing dedup generalizes — a create-request needs a fingerprint
and a `savedInstanceState` record just like an action tap does.

On top of that, accept an optional caller-supplied idempotency key. Tasker- and
HTTP-Shortcuts-style callers retry on any ambiguity, and a key is the only way
to distinguish "the user really wants two identical reminders" from "the same
request arrived twice".

### Open decision: auto-create or confirm?

Recommendation: the share-sheet path prefills and waits for the user (shared
text is rarely a well-formed reminder), a fully-specified `remindme://create`
URL with both details and time creates immediately and toasts. A URL missing a
time always falls back to prefill.

### Files

- `src-tauri/gen/android/app/src/main/AndroidManifest.xml` — intent filters
- `src-tauri/gen/android/app/src/main/java/software/greysky/remindme/MainActivity.kt` — parse + deliver, generalized replay guard
- `src/lib/` — new module for request parsing/validation (sibling to `backup.ts`)
- `src/App.vue`, `src/stores/router.ts`, `src/components/ReminderForm.vue` — prefill path

### Estimate

**Small — about half a day.** Most of it is the replay guard and the
auto-create-vs-confirm decision, not the intent plumbing.

### Result — done

Shipped as designed above, including the auto-create-vs-confirm split under
"Open decision" (which is no longer open: implemented exactly as
recommended, gated additionally on notification permission being granted —
ungranted falls back to prefill rather than arming an alarm the user can't
yet see). The frontend module landed as `src/lib/createRequest.ts`; the
prefill path runs through a new `ReminderForm.prefill()` method and
`NewReminderTab.vue` (not `App.vue` — the router alone was enough, no app-shell
change needed).

Emulator-verified end-to-end (WebView CDP + direct `reminders.db` queries):
a fully-specified deep link inserts a row and arms the alarm with no form
interaction; a deep link missing `at`, or one that arrives before
notifications are granted, prefills instead; a share-sheet `ACTION_SEND`
always prefills. All three intent filters resolve per `dumpsys package`.

Two environment gotchas surfaced during verification, unrelated to the
feature itself but worth keeping in mind next time:

- `pnpm tauri android build` picks Android Studio's bundled JBR (Java 25) by
  default when `JAVA_HOME` is unset, which fails Gradle's `:buildSrc`
  configuration with a cryptic `> 25.0.2` error. Fix: export
  `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`
  before building.
- `adb shell 'am start ... -d "remindme://create?details=x&at=y"'` silently
  truncates at the `&`: adb joins argv into one string and hands it to the
  *device's* shell, which treats an unescaped `&` as a background operator.
  Wrap the whole `-d` value in single quotes inside the outer double-quoted
  command, e.g. `adb shell "am start -a android.intent.action.VIEW -d
  'remindme://create?details=x&at=y'"`.

---

## Phase 2 — App shortcuts

Declarative long-press-launcher entries: "New reminder", plus preset durations
once phase 3 exists ("Remind me in 1h").

A `res/xml/shortcuts.xml` and one `meta-data` line in the manifest, pointing at
the phase-1 deep links. No Kotlin. This is the cheapest quick-create surface the
app can have, and it falls straight out of phase 1.

**Estimate: hours.**

### Result — done

Shipped as one static shortcut, "New reminder", firing the phase-1 deep link
with no query parameters. Preset durations stayed out, as anticipated above:
a static intent is fixed at build time and cannot express "now + 1h", so they
genuinely wait on phase 3.

Two things the sketch above did not anticipate:

- **A bare `remindme://create` had no meaning yet.** Phase 1 dropped any
  request whose details were empty, so the shortcut would have launched the
  app and done nothing. It now reads as a *navigate* request — route to
  Home / New Reminder — deliberately without prefilling or resetting the
  form, so a half-typed reminder survives the trip (the launcher icon doesn't
  clear it either, and `ReminderForm.prefill()` would have). Details-less
  shares are still dropped; only a deep link can mean "open the form".
- **So it did need Kotlin after all** — the replay guard shouldn't record a
  fingerprint for a request that creates nothing; dedup is meaningless there.
  `CreateRequest.isCreate` (mirroring `normalizeDetails()`'s blank test, so
  the two sides can't drift) now gates both `fingerprint()` and the
  `handledActionFingerprint` write. `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`
  still covers the Recents case, which is the one worth suppressing. Note
  this is a correctness/consistency fix, not a visible-bug fix: a suppressed
  navigate would be invisible anyway, because the webview reboots on
  recreation and Pinia lands on `NewReminder` by default regardless.

### The phase-1 bug this verification turned up

Chasing the above surfaced a genuine duplicate-reminder bug that had been
shipping since phase 1. Two independent defects, both in the replay guard:

1. **The guard survived exactly one recreation.** `onCreate` compared
   `savedInstanceState` against the current fingerprint but never *restored*
   it into `handledActionFingerprint`. The suppressed pass then records
   nothing, so the next `onSaveInstanceState` writes null, and the recreation
   after that sees no match and replays the create. Reproduced on the signed
   release APK: create via deep link → change the system font scale twice
   (`fontScale` is absent from the activity's `configChanges`, so each change
   recreates it in-process) → **two identical reminders**.
2. **`getIntent()` went stale.** Neither `Activity` nor Tauri's
   `TauriActivity`/`WryActivity` calls `setIntent()` in `onNewIntent`, so
   after a recreation the guard was reading the *launch* intent, not the last
   one delivered. A second deep-link create in the same session therefore left
   the first looking unhandled, and a later recreation replayed it.

Fixes are one line each: restore the fingerprint in `onCreate`, and
`setIntent(intent)` in `onNewIntent`. Verified on the signed release build —
six consecutive recreations after a create hold at one row, and the
two-creates-then-recreation sequence holds at two.

### Verification

Emulator-verified on debug **and** on the signed, minified release APK:
`dumpsys shortcut` shows the shortcut parsed with both labels and its icon
resource (confirming `android:data` is honoured on `<intent>` — it works, but
it is absent from the documented attribute set, so it was checked rather than
assumed); a real long-press-and-tap from the launcher opens the New Reminder
tab; firing the intent while the app sits on Scheduled Reminders switches
tabs and leaves typed details intact; a cold start after genuine process
death works, and works identically on the second consecutive tap; on a fresh
install with notifications ungranted it lands on the landing gate and
advances to New Reminder once granted; and across all of it the bare deep
link inserted zero rows into `reminders.db` while a fully-specified one still
auto-created exactly one.

Note `run-as` is unavailable on the release APK (not debuggable), so the
release-build DB assertions went through the sql plugin over WebView CDP:
`window.__TAURI__.core.invoke('plugin:sql|select', { db: 'sqlite:reminders.db',
query: '…', values: [] })`.

One UI detail worth keeping: the launcher renders `shortcutShortLabel`
unless the long label happens to fit its popup, so the short label carries
the meaning ("New reminder"), not a terse "New". The icon is its own
drawable — a filled disc in `@color/ic_launcher_background` with a white
glyph — because `ic_stat_logo` is alpha-only white and would vanish against
a light launcher.

---

## Phase 3 — Headless creation broadcast

The one that actually unlocks automation: a broadcast arms a reminder with no UI
and no app launch.

### Design — same split as the background snooze

There is no webview in a receiver, so the work divides exactly the way
`SnoozeActionReceiver.kt` divides it:

- **Kotlin does what cannot wait:** arm the OS alarm, via the vendored
  `scheduleNotificationInBackground` entry point. That signature is already
  Jackson-free, which is what makes it callable from `gen/android` at all (see
  the module-seam note in [CLAUDE.md](CLAUDE.md) — any signature mentioning an
  `ObjectMapper` will not compile from the app module).
- **TypeScript does the bookkeeping:** the receiver journals
  `{ id, details, fireAt, timezone, … }` to SharedPreferences, and
  `notification_manager.drainSnoozeJournal()` — generalized to a pending-ops
  drain — applies it on next open, from `androidResume`, and from the broadcast
  nudge.

`SnoozeJournal` in `SnoozeActionReceiver.kt` generalizes into a shared journal
with modest refactoring. Keep its existing property that the id armed by the
receiver is the id written to the journal, so a re-drain is idempotent.

Kotlin must keep never touching the SQLite file directly — the one-shot vs
repeat semantics live in TypeScript and should stay there.

### How callers address the broadcast

This belongs in the integration docs, because getting it wrong fails silently —
the worst possible failure mode for this feature. Since API 26, a
manifest-declared receiver does **not** receive plain implicit broadcasts: the
caller must set the component or the package explicitly.
`SnoozeActionReceiver`'s package-scoped `BACKGROUND_ACTION_BROADCAST` is the
working precedent in this repo. For testing:

```sh
adb shell am broadcast \
  -n software.greysky.remindme/.CreateReminderReceiver \
  -a software.greysky.remindme.CREATE_REMINDER \
  --es details 'Take out the bins' \
  --el fireAt 1786000000000
```

### Decision A — how far do repeats go?

Porting `nextOccurrence()` to Kotlin is not worth it. Two options:

1. **One-shot only.** A repeat request launches the app (phase 1 path).
   Simplest, no new failure modes.
2. **Caller supplies an absolute first-fire time.** Kotlin arms that one-shot
   and journals the repeat JSON opaquely; the existing launch-time
   `rearmRepeats()` / `advanceRepeat()` sweep normalizes it on next open. Less
   code than it sounds like — but with a real cost: **if the app is never
   reopened, a chained repeat fires once and then stops.** Native repeats
   (`daily`/`weekly`/`monthly` with `every === 1`, which map to the plugin's
   self-re-arming `Schedule.interval`) are unaffected either way.

Recommendation: start with (1); (2) is a follow-up if headless repeats are
actually wanted.

### Decision B — the schedule contract has a trap

`notification_manager.schedule()` computes:

```ts
const fire_at = spec ? nextOccurrence(spec, new Date()) : dateTime;
```

**A passed `dateTime` is discarded whenever a repeat spec is present.** So an
external contract of "time + repeat rule" would silently ignore the time. Either
document the contract as *absolute time for one-shots, rule-only for repeats*,
or route external repeat requests through `withAnchor()` with an explicit
anchor. Whichever is chosen, write it into the contract docs — this is the kind
of thing that returns as a confusing bug report months later.

### Security posture

An exported receiver means any installed app can create reminders. A signature
or custom permission would defeat the entire use case (third-party automation
apps cannot hold either), so **the mitigation is input validation, not access
control**:

- clamp `fireAt` to sane bounds (not in the past beyond a small grace, not
  centuries out)
- cap `details` length
- reject absurd `count` / `every` / `minute` values before they reach
  `RepeatSpec`

Intent extras only ever become notification body text, so that is the whole
threat surface. Mark the receiver `android:exported="true"` deliberately, with a
comment saying why.

### Files

- new receiver alongside `src-tauri/gen/android/app/src/main/java/software/greysky/remindme/SnoozeActionReceiver.kt`
- `SnoozeActionReceiver.kt` — generalize `SnoozeJournal`
- `AndroidManifest.xml` — receiver registration
- `src/lib/notifications.ts` — generalize the drain

### Verification

Emulator, **with the process killed**, for one-shot and (if decision A picks
option 2) repeating sources — and on a minified release build, not just debug.
That is where the snooze work's time actually went, and the same R8 hazards
apply.

### Estimate

**Medium — a couple of days**, verification included.

### Result — done

Shipped as `CreateReminderReceiver.kt`, addressed exactly as the sketch above
predicted (component `-n .../.CreateReminderReceiver`, action
`software.greysky.remindme.CREATE_REMINDER`, `--es details`, `--el fireAt`).
Decision A went with option 1, one-shot only: a request carrying a repeat-ish
extra (`repeat`, `every`, `interval`, `frequency` — only names that can't mean
anything else, so a generic automation tool's stray `count` variable isn't a
false positive) is **rejected**, not silently downgraded. Decision B therefore has no trap left to
document — with no repeat spec ever reaching `schedule()`, an absolute time can
never be the argument that gets discarded. The caller-facing contract lives in
[README.md](README.md#automation), as the design called for.

Four things the sketch above did not anticipate:

- **`inMinutes` as well as `fireAt`.** A phase-4 widget button cannot bake an
  absolute time into a `PendingIntent` that may be tapped hours later, and
  `updatePeriodMillis` is off the table (30-minute floor). A relative extra is
  the only shape that works, so it is in from the start rather than bolted on
  later. `fireAt` wins if both are present. Numeric extras are read
  type-tolerantly (`--el` / `--ei` / `--es`), because a typed getter silently
  returns its default for the wrong type — which would read as "absent" and
  produce a baffling rejection for a caller that used `--ei`.
- **Nothing fails silently.** Every reject path logs and, when the broadcast is
  ordered (which is what `am broadcast` sends), reports a distinct result code —
  scheduled, scheduled-but-notifications-off, bad details, bad time, unsupported
  repeat. This is also the fastest test loop the feature has.
- **The action group had to be mirrored natively.** A snooze rebuilds its
  notification from the serialized source and inherits the snooze buttons for
  free; a headless create has no source. Channel, title and icon are constants
  and are duplicated in Kotlin with a mirror comment, but *whether snooze
  buttons exist at all* depends on the user's setting, which Kotlin cannot read
  (`NotificationStorage`'s constructor takes an `ObjectMapper`, so the module
  seam blocks it — the same wall the `Jackson-free` entry points exist for). So
  `registerSnoozeActions()` now writes the resolved action-type id through the
  `AndroidNative` bridge into `NotificationActionGroup.kt`, and absent/empty
  means "arm without buttons" rather than "drop the request" — a benign,
  *visible* degradation instead of a silent loss.
- **That mirror needed a watcher, not just a call in `arm()`.** `arm()`
  re-registers immediately before every notify, so in-app notifications are
  always current; but a broadcast can land at any moment and reads whatever was
  registered last. Toggling snooze off left the native mirror stale until the
  next in-app schedule or app restart — reproduced on the emulator — so
  `init()` now watches the snooze settings and re-registers on change.

The journal generalized as designed (`PendingOpsJournal.kt`, shared by both
receivers; `drainSnoozeJournal()` → `drainPendingOps()`, switching on a `type`
tag). Two details worth keeping: the SharedPreferences **store name stayed
`SNOOZE_JOURNAL`** even though every Kotlin/TS name around it generalized, since
prefs survive an app update and renaming the file would orphan an entry the
shipped build wrote; and an entry with **no `type` is read as a snooze**, for
exactly the same reason. Both were verified by injecting a pre-phase-3 entry.

### Verification — what was actually run

Emulator, on debug **and** on the signed minified release APK.

- Process killed (`am kill`, not force-stop — see the stopped-state note below):
  broadcast → alarm armed → fires on `reminders_high` with its snooze buttons,
  app never launched. Then a preset snooze tapped from the shade with the
  process still dead → journal holds a typed `create` followed by a typed
  `snooze` naming it as source → next open collapses the pair into exactly one
  row, the snoozed copy. That compound case is the one that exercises the
  mirrored action group and both receivers together.
- App foregrounded: the `PENDING_OPS_UPDATED` nudge lands the row within a
  couple of seconds, no navigation needed.
- Validation: blank/missing details, missing time, past time, absurd future,
  `Long.MAX_VALUE` `inMinutes` (which would otherwise overflow into a *past*
  time and sail through the range check), repeat extras, 300 → 240 character
  truncation, `--es`-shaped numbers, and a within-grace past time clamping to
  "now". All eleven return their expected result code on both builds.
- Snooze disabled: the mirror clears, and a headless notification arrives with
  no action buttons at all; re-enabling repopulates it live via the watcher.
- Notification permission revoked: both requests still return `2` and still arm
  (AlarmManager doesn't care about `POST_NOTIFICATIONS`), and the reminder fires
  invisibly. A *future* one is in the list on next open; one that already fired
  is swept — a consequence of the `activeNotificationIds()` bug below, and the
  reason the README's result-code table qualifies "still in the list" rather
  than promising it flatly.
- `adb reboot` with the app never reopened: the alarm re-armed at its exact
  original time and fired ~3s late, buttons intact. This is what
  `scheduleNotificationInBackground`'s `appendNotifications()` half is for.
- Legacy compat: a hand-injected untyped journal entry drained as a snooze.

**A force-stopped app is unreachable.** Android's stopped-state rule means a
manifest receiver gets no broadcast until the app is launched again, so the
result code is `0` (receiver never ran) — the same caveat the `BOOT_COMPLETED`
restore path already carries. Documented in the README's result-code table.

### A pre-existing bug this turned up

`activeNotificationIds()` in `src/lib/notifications.ts` has never worked on
Android, so "a fired one-shot still sitting in the drawer survives the
`cleanExpired()` sweep" has never actually happened. The plugin's JS `active()`
wrapper returns the raw Android payload
(`{"values":[{"nameValuePairs":{"id":…}}]}`) rather than an
`ActiveNotification[]`; `.map()` on that object throws, the `catch` swallows it,
and the function returns the empty set that means "sweep everything". So on
every launch the row is deleted *and* `cancelPending()` dismisses the still-
visible notification, taking its snooze buttons with it.

Unrelated to this phase (it predates it and affects in-app reminders
identically), so it was left alone rather than folded into the same change — but
it is worth fixing, and it matters to phase 5: staleness case 1 there assumes
fired one-shots linger in the list, which today they do not.

---

## Phase 4 — Quick-create widget

Text input in a widget is not possible: `RemoteInput` is notification-only and
`RemoteViews` has no editable field. So "quick create" realistically means:

- preset one-tap buttons (`+15m`, `+1h`, `+3h`) that broadcast straight into the
  phase-3 receiver — genuinely no app launch
- one button that deep-links into the New Reminder tab (phase 1)

Once phase 3 exists this widget is nearly free: a layout, a provider, and
`PendingIntent`s.

**Estimate: small — about a day.**

### Result — done

Shipped as `QuickCreateWidgetProvider.kt` plus a layout, a widget-info XML and
four small drawables — no frontend change at all, and no new capability: the
whole feature is the phase-3 broadcast and the phase-1 deep link with a
`RemoteViews` face on them. Preset durations are 15 / 30 / 60 minutes, matching
`quickScheduleOptions`' defaults in `src/stores/settings.ts` rather than the
`+15m / +1h / +3h` this sketch guessed at, so the widget shows the same
durations as the app's own quick-schedule chips.

Four things the sketch above did not anticipate:

- **A silent button reads as a broken widget.** A create broadcast shows
  nothing until the reminder fires, possibly hours later, so the taps are
  routed *through the provider* (its own `ACTION_QUICK_CREATE`, forwarded to
  `CreateReminderReceiver` by explicit component) rather than straight into the
  receiver, purely so the widget can repaint a confirmation line — "Reminder
  set for 2:31 PM", in the same hardcoded en-US `h:mm a` format
  `src/lib/format.ts` uses. The confirmation is optimistic: a plain
  `sendBroadcast` has no result code to read back, and a request built from the
  preset table cannot fail validation by construction. Adding a `toast` extra
  to `CreateReminderReceiver` instead was rejected — its contract is the
  published automation surface (README), and a UI flag does not belong in it.
  The one outcome worth distinguishing, notifications being disabled, the
  provider reads for itself (`areNotificationsEnabled()`) and says so in the
  line — the alarm is armed either way, but a bare "Reminder set" would
  misrepresent a reminder that will fire invisibly, and that is exactly the
  state a widget placed before the app was ever opened is in.
- **The status line is deliberately past-tense.** `updatePeriodMillis` is 0, so
  nothing repaints the widget between taps; a present-tense "Reminder at 2:31
  PM" would rot, while a record of what the last tap did stays true. It resets
  to the "Remind me in…" hint on the next `onUpdate` — reboot, app update, or
  re-placement.
- **`PendingIntent` identity ignores extras.** `Intent.filterEquals()` does not
  compare them, so all three buttons (times every placed instance) would have
  collapsed onto one `PendingIntent`, and `FLAG_UPDATE_CURRENT` would have left
  every button doing whatever was registered last. Each button's intent carries
  a distinct `remindme-widget://quick-create/<widgetId>/<minutes>` data URI and
  a matching request code. This is the defect that would have survived to the
  screenshot stage looking fine, so both of its dimensions were checked
  explicitly: three buttons on one widget give three different durations, and
  two placed widgets tapped on different presets each update their own status
  line. For the same class of reason the button *labels* are painted from the
  `PRESETS` table rather than left to the layout's `android:text` — nothing
  ties that text to `minutes`, so changing a duration would leave the button
  advertising the old one with no build or screenshot catching it.
- **A widget provider must be exported**, so its click action is externally
  reachable even though the app's own `PendingIntent`s are explicit. The
  forwarded duration is therefore range-checked in the provider as well
  (1 minute … 7 days), on top of `CreateReminderReceiver`'s own validation —
  same input-validation-not-access-control posture as phase 3.

The theming question resolved the way the phase-5 notes predict: `RemoteViews`
cannot see the runtime M3 palette, so the widget uses static colours with a
`values-night` variant and the launcher-icon blue for its buttons, exactly as
`ic_shortcut_new_reminder` already does. That means it follows the *system*
light/dark setting, not the app's own. Phase 5's snapshot bridge is the thing
that would carry the accent across; it is also what would let the presets follow
`quickScheduleOptions` instead of being hardcoded, which is why neither was
built here — a widget placed before the app was ever opened has to render
usable buttons anyway.

### Verification — what was actually run

Emulator (API 37), on debug **and** on the signed minified release APK, widget
placed by hand from the launcher's widget picker; CDP evals do not reach
`RemoteViews`, so this phase is screenshots.

- Picker preview renders (`previewLayout`), and the widget places at 4×2.
- Dark and light: `cmd uimode night no/yes` flips the `values-night` surface
  colours; content is vertically centred so a resized widget does not sit in the
  top-left corner.
- Three preset buttons → three distinct durations logged, three alarms armed
  (`dumpsys alarm`), and after opening the app three rows at +15 / +30 / +60
  minutes — the journal drain treats them exactly like any other headless
  create.
- Two widgets placed at once, tapped on different presets: each repaints its
  own confirmation, neither steals the other's.
- A 1-minute reminder pushed through the provider's own action fired normally,
  with its snooze buttons.
- Out-of-range durations (0 and 99999 minutes) sent straight to the exported
  provider are logged and dropped.
- "+" opens the New Reminder tab from wherever the app was, and leaves
  half-typed details alone — the navigate-only deep link, unchanged from
  phase 2.
- On the release build, freshly installed and never launched: the widget still
  places, and the first tap works — binding the widget takes the app out of
  Android's stopped state, so the `BOOT_COMPLETED`/`am broadcast` caveat does
  not apply here. That tap reports "notifications are off" (no runtime
  permission yet) and the reminder is in the list once the app is opened.

---

## Phase 5 — Reminder list widget

A widget is `RemoteViews`. No webview, no CSS, and none of the runtime M3
palette from `src/lib/theme.ts`. The visual design gets re-authored in Android
layout XML with manual tinting — that is the bulk of the cost, and it is design
work more than engineering.

### The load-bearing decision: snapshot, not database

**Do not have Kotlin read `reminders.db`.** Instead, the frontend writes a
denormalized JSON snapshot through a new `AndroidNative` bridge method — the
already-formatted title, time string and repeat description, plus the current
accent color — and the widget renders purely from that.

Why:

- it keeps `format.ts` and `repeat.ts`'s describe logic from being duplicated in
  Kotlin, where it would drift
- it avoids a second SQLite connection (Android `SQLiteDatabase` alongside the
  plugin's) against a WAL database
- it carries the theme across for free, which `RemoteViews` otherwise has no
  access to
- held in SharedPreferences it survives reboot and app update, so the widget
  renders correctly without the app ever being opened — the property that makes
  this clearly the right call rather than merely the cheaper one

The push hook already exists: `emitChange()` in `src/lib/notifications.ts` fires
on every reminder mutation.

Do **not** lean on `updatePeriodMillis` — it has a 30-minute floor and wakes the
process to do nothing.

### The staleness caveat, stated exactly

The snapshot is only ever written by the frontend, so anything that changes
reminders while the app is closed leaves it stale until next open. Three cases:

1. **A one-shot fires.** Free fix: filter or grey rows where `fireAt < now` at
   render time. No native DB knowledge needed.
2. **A chained repeat fires** — it displays a stale next-time. Engineering
   around this means `nextOccurrence()` in Kotlin, so accept it.
3. **A background snooze (`SnoozeActionReceiver`) or a phase-3 headless
   create.** These *cannot* refresh the snapshot themselves: a receiver has raw
   `details`/`fireAt` and no way to produce a formatted row — the time string
   depends on the 12/24h setting in `settings.json`, and reading tauri-plugin-store
   from Kotlin is a second cross-language read, exactly what the snapshot design
   exists to avoid.

Case 3 gets the same treatment as case 2 by default: stale until next open. If
immediacy turns out to matter, the alternative is for the receiver to append raw
`{details, fireAt}` to a separate pending list that the widget renders in a
deliberately minimal form (no repeat description, fixed time format), replaced
by the properly formatted row on the next TS drain. That is a small, bounded
amount of duplicated formatting — take it as a conscious trade, not by accident.

### The fact that swings the estimate

`RemoteViews.RemoteCollectionItems` — the modern, simple way to populate a list
widget — is **API 31+**, and this app is `minSdk = 26`
(`gen/android/app/build.gradle.kts`). So the options are: write the older
`RemoteViewsService` / `RemoteViewsFactory` plumbing, branch on
`Build.VERSION.SDK_INT`, or raise `minSdk` to 31. That choice alone is the
difference between a small widget and a medium one.

Confirm the exact API level before committing to an approach.

### Avoid Glance

Jetpack Glance (Compose for widgets) is much nicer to author, especially for
lists. It is also the single biggest risk-adder in this document.

This repo has documented R8 scar tissue: the vendored `consumer-rules.pro`,
Jackson model classes stripped from the notification plugin, repeat schedules
broken on release builds only. Pulling Compose into the hand-edited
`gen/android` Gradle tree buys authoring ergonomics for a list of text rows and
reopens exactly that class of failure. Use plain `RemoteViews`; revisit Glance
only as a deliberate investment.

### Files

- new provider Kotlin alongside the existing receivers
- `res/xml/` widget info, `res/layout/` widget + row layouts, widget preview
- `AndroidManifest.xml` — provider registration
- `MainActivity.kt` — snapshot bridge method
- `src/lib/notifications.ts` — snapshot push on `emitChange()`

### Verification

Slower than usual: the WebView CDP eval workflow does not reach `RemoteViews`,
so this is screenshots and manual widget placement on the emulator.

### Estimate

**Medium — 2 to 4 days**, weighted toward layout and theming iteration rather
than logic.

### Result — done

Shipped as `ReminderListWidgetProvider.kt` + `ReminderListWidgetService.kt` +
`WidgetSnapshot.kt`, two layouts, two drawables, a widget-info XML, one bridge
method, and `src/lib/widget.ts`. The snapshot design held up exactly as
sketched: Kotlin never opens `reminders.db`, `formatEpoch`/`describeRepeat`
stay in TypeScript, and because the snapshot lives in SharedPreferences the
widget renders real reminders on a device that has not opened the app in weeks.

Decisions the sketch left open:

- **`RemoteViewsService`, not `RemoteCollectionItems` and not a version
  branch.** The API-31 floor is real, but one code path that works on 26 is
  cheaper than two, and the pre-31 plumbing is ~90 lines for a list this
  simple. `minSdk` was not raised.
- **Rows carry no icons.** `ReminderListEntry.vue` prefixes both lines with a
  Font Awesome glyph; hand-authoring vector equivalents buys little, since a
  repeat rule never reads as a date.
- **Row taps open the app on the reminder list**, via a new navigate-only
  `remindme://reminders` deep link — a list widget whose rows do nothing reads
  as broken. It is parsed without touching its query string on both sides,
  because the filter is `BROWSABLE`: a host documented as "just open the list"
  must not become a second create surface outside phase 1's replay guard.
- **The staleness caveat resolved better than feared.** Case 1 (a fired
  one-shot) is dropped at render time — a deliberate divergence from the app,
  which keeps such a row while its notification is still in the drawer because
  the snooze buttons need it; a glance surface has no such duty. Case 2 mostly
  evaporates: a repeating reminder shows its *rule*, not a timestamp, exactly
  as the app does, so a fired occurrence leaves the row correct. Case 3
  (background snooze / headless create with the app closed) is accepted as
  designed.

Two things cost real time and are worth reading before touching this again:

- **A full `updateAppWidget` from the app is silently dropped when the
  RemoteViews carry a `setRemoteAdapter`.** The platform logs "Trying to notify
  widget update deferred" and only the `APPWIDGET_UPDATE` broadcast's own
  `onUpdate` gets through. The failure is lopsided and therefore confusing: the
  *rows* keep refreshing, because the host re-queries the `RemoteViewsFactory`
  directly, so what you see is a current list painted in a stale palette —
  light text on a dark panel after a theme change. `partiallyUpdateAppWidget`
  with a chrome-only RemoteViews merges into the stored views and lands. Two
  plausible-sounding non-fixes were tried and did not help: bouncing the call
  through a broadcast to the provider (main thread, receiver dispatch) and
  `updateAppWidget(ComponentName, …)`.
- **A colour pushed in the snapshot is a plain int, so it cannot follow the
  system night setting** the way a `@color` with a `values-night` variant does
  — and nothing could repaint it, since Android delivers no
  configuration-change broadcast a manifest receiver may subscribe to. With
  theme = 'system' that left the widget in whichever scheme was current at the
  last push. `RemoteViews.setColorInt(viewId, method, notNight, night)` exists
  for precisely this: it carries both values and the host chooses per its own
  configuration, every time it applies. API 31+, so below that a 'system' theme
  resolves once at push time and a `systemPrefersDark` watcher re-pushes while
  the app is running.

Theming otherwise works as the phase-4 notes predicted it could: the panel is
an ImageView holding a white rounded rect recoloured with
`ImageView.setColorFilter` (tinting a rounded *background* is impossible below
API 31), so the widget follows the user's accent seed and, unlike phase 4's,
the app's own light/dark/system setting rather than the system's.

### Verification — what was actually run

Emulator (API 37), on debug **and** on the signed minified release APK; widget
placed by hand from the launcher's picker. CDP evals do not reach
`RemoteViews`, so this is screenshots plus `WIDGET_SNAPSHOT.xml` reads.

- Picker preview, placement at 4×3, scrolling past the visible rows.
- Snapshot round-trip: reminders created by the phase-3 broadcast appear in
  `WIDGET_SNAPSHOT.xml` and then in the widget, with a repeating reminder
  showing "Every Tuesday at 9:00 AM" rather than a date.
- Live accent changes (blue → magenta → green → red → teal) repaint chrome,
  row text and dividers, on debug and on the signed release build.
- All four theme combinations: app light / dark / system crossed with
  `cmd uimode night no|yes`. App-explicit wins over the system setting; with
  'system', flipping night mode repaints the widget correctly **with the app
  closed** (the `setColorInt` path).
- Row tap opens the app on the Scheduled Reminders tab, from cold start; "+"
  opens the New Reminder form and leaves a half-typed one alone.
- `remindme://reminders?details=INJECTED&at=…` creates nothing.
- Empty list shows "No reminders scheduled"; after `pm clear`, with no snapshot
  at all, it shows "Open Remind Me to see your reminders" in the static
  fallback palette.
- Not exercised: two instances placed at once. All instances render the same
  list by construction, and the per-instance parts (the adapter's uniqueness
  data URI, the per-id partial-update loop) have no shared state — but the
  launcher's drag-and-drop would not cooperate, so this is untested rather than
  verified.

---

## Cross-cutting notes

- **Capabilities:** none of this needs a new entry in
  `src-tauri/capabilities/default.json` as long as it stays on the
  `AndroidNative` bridge and the existing notification plugin surface. If a new
  plugin API gets called, remember a missing permission fails *silently*.
- **R8:** every new Kotlin type reached reflectively or across the plugin module
  seam is a release-build hazard. Verify each phase on a signed release APK, not
  just debug — repeat schedules already broke that way once.
- **Untrusted input:** intent extras and shared text are attacker-controlled in
  the sense that any installed app can send them. They only become notification
  body text, but validate lengths and ranges before they reach the DB or a
  `RepeatSpec`.
