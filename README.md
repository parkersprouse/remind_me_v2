# Remind Me!

Remind Me! is an app to help you quickly and easily set reminders to make sure you always
remember what you need to.

This is a **Tauri v2** rewrite of the original Flutter application
(`~/Code/GSS/remind-me`), migrated 1-1 in functionality and design. It targets **Android
only** — there is no desktop or browser build.

## Stack

| Concern | Flutter original | This app |
|---|---|---|
| UI | Flutter widgets (Material 3) | Vue 3 + TypeScript (Vite) |
| State | `provider` (`ChangeNotifier`) | Pinia |
| Reminder storage | `sqflite` | `tauri-plugin-sql` (SQLite, same schema) |
| Settings | `shared_preferences` | `tauri-plugin-store` (`settings.json`) |
| Notifications | `flutter_local_notifications` | `tauri-plugin-notification` (vendored, patched) |
| Permissions | `permission_handler` / `app_settings` | notification plugin, read natively |
| Theming | Material 3 blue `ColorScheme` | dynamic M3 palette generated from a seed color |
| Fonts | Inter Display (bundled) | same OTFs via `@font-face` |

## Behavior notes

- Reminders are scheduled through the Android OS notification system (`Schedule.at`),
  including snooze action buttons, so they fire whether or not the app is running.
  Reminders survive device reboot.
- Reminders can repeat (daily/weekly/custom interval, chained from the prior fire time),
  not just fire once.
- Reminders can be created from outside the app: a `remindme://create` deep link, the
  Android share sheet, a long-press launcher shortcut, the home-screen widget, or a
  broadcast that creates one with no UI at all (see [Automation](#automation)).
- The **Quick reminder** home-screen widget has one-tap buttons for 15 minutes, 30
  minutes and an hour from now — those arm the reminder without opening the app, and
  every one of them is titled simply "Reminder", since a widget can't take text input —
  plus a "+" button that opens the New Reminder form. Its colours follow the system
  light/dark setting rather than the accent you picked in the app.
- The **Reminders** home-screen widget lists what's coming up, scrolls, and takes both
  its contents and its colours from the app, so it follows your accent seed and your
  light/dark/system setting. Tapping a row opens the reminder list; "+" opens the New
  Reminder form. It renders from a snapshot the app saves, so it stays correct across
  reboots and shows real reminders even if the app hasn't been opened in weeks — but
  anything that changes reminders while the app is closed (a snooze from a notification,
  a reminder created by broadcast) shows up the next time you open it.
- Theming is generated at runtime: pick one accent seed color and the full Material 3
  palette (light/dark) is derived from it and applied as CSS custom properties. There's no
  static authored color scheme to edit.
- Settings → Backup lets you export your reminders to a JSON file and import them back
  (e.g. when moving to a new device), via the Android system file picker.
- The reminders database (`reminders.db`) and settings (`settings.json`) live in the
  app's private Android data directory.

## Automation

Other apps — Tasker, HTTP Shortcuts, an `adb` one-liner — can create reminders without
Remind Me! coming to the foreground.

### Broadcast (no UI)

Arms the OS alarm directly; the app is not launched and nothing is shown until the
reminder fires.

```sh
adb shell "am broadcast \
  -n software.greysky.remindme/.CreateReminderReceiver \
  -a software.greysky.remindme.CREATE_REMINDER \
  --es details 'Take out the bins' \
  --el fireAt 1786000000000"
```

| Extra | Type | Meaning |
|---|---|---|
| `details` | string | Reminder text. Required, trimmed, truncated to 240 characters. |
| `fireAt` | long | Absolute fire time, epoch milliseconds. |
| `inMinutes` | long | Minutes from now. Used only when `fireAt` is absent. |

Exactly one of `fireAt` / `inMinutes` is required. Numbers are accepted as `--el`, `--ei`
or `--es`. A `fireAt` up to a minute in the past means "fire now"; anything earlier, or
more than ten years out, is rejected.

The result code says what happened — `am broadcast` prints it, and an ordered broadcast
from an app can read it:

| Code | Meaning |
|---|---|
| `1` | Scheduled. |
| `2` | Scheduled, but notifications are disabled for the app. The alarm is armed and a still-future reminder shows up in the list, but it will fire invisibly — and a reminder that fires while notifications are off is dropped from the list the next time the app is opened. |
| `10` | `details` missing or blank. |
| `11` | Fire time missing, unparseable, or out of range. |
| `12` | A repeat-like extra was sent (see below). |
| `0` | The receiver never ran — wrong component or action, or the app is in Android's *stopped* state (force-stopped, or freshly installed and never opened). |

Two limits worth knowing before you build against this:

- **One-shots only.** Recurrence rules live in the app's TypeScript, not in the receiver,
  so a request carrying `repeat`, `every`, `interval` or `frequency` is rejected outright
  rather than quietly downgraded to a single reminder. Use the deep
  link below and set the rule in the app.
- **Not idempotent.** A broadcast is never redelivered by the system, so there is no
  replay to guard against and no de-duplication is attempted. A caller that retries on
  ambiguity will create two reminders.

Since Android 8 a manifest-declared receiver gets no implicit broadcasts, so the caller
must set the component (`-n`, above) or at least the package — a bare `-a` action reaches
nothing.

### Deep link (opens the app)

```
remindme://create?details=Take%20out%20the%20bins&at=2026-08-14T07:30:00Z
```

`at` is ISO-8601. With both fields present, a future time, and notifications already
granted, the reminder is created immediately and the app shows a confirmation; anything
short of that prefills the New Reminder form instead. With no `details` at all it just
opens the form — that is what the launcher shortcut fires. Repeats are set in the app.

Sharing plain text to Remind Me! from any app's share sheet always prefills the form,
since shared text is rarely a well-formed reminder.

Deep links are de-duplicated across an intent replay (relaunching from Recents, or an
in-process activity recreation); add a `key` query parameter to make a retried request
distinguishable from a deliberate duplicate.

```
remindme://reminders
```

Opens the app on the scheduled-reminder list. It never creates anything, and any query
parameters are ignored — this is what the Reminders widget's rows fire.

## Development

```sh
pnpm install
pnpm build            # vue-tsc typecheck + vite bundle (frontend only) — the main correctness gate
pnpm lint             # eslint
```

There's no desktop or browser dev loop: the app assumes the Android/Tauri webview and its
native bridges are always present, so verification is `pnpm build` plus an Android build
(below).

### Android

```sh
pnpm tauri android build --debug --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n software.greysky.remindme/.MainActivity
```

Requires the Android SDK/NDK plus the Rust Android targets:

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Signed release builds (`pnpm release:build` / `pnpm run release`) are documented in
[RELEASE.md](RELEASE.md).

## Project layout

```
src/                  # Vue frontend
  lib/                # db, notifications, backup, theme, color, duration, repeat, format,
                       # toaster, Android native/back-button bridges
  stores/             # Pinia stores (settings, page router)
  components/         # dialogs, pickers, chips, switches, color picker
  views/              # Landing, Home (New Reminder / Scheduled Reminders), Settings
src-tauri/            # Rust backend: plugin registration + SQL migration only,
                      # no custom commands
  gen/android/        # Android project (hand-edited MainActivity.kt bridges; see CLAUDE.md)
  vendored/           # patched tauri-plugin-notification (Android action-button
                       # and boot-restore fixes)
```
