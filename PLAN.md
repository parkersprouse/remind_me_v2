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
| 2 | App shortcuts | hours | 1 | not started |
| 3 | Headless creation broadcast | medium | 1 | not started |
| 4 | Quick-create widget | small | 3 | not started |
| 5 | Reminder list widget | medium | — | not started |

Recommended order is 1 → 2 → 3 → 4 → 5. Phases 1–2 deliver most of the
practical "create a reminder fast" value for a fraction of a widget's cost;
phase 5 is the most work and the most design-dependent, so it goes last.

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
