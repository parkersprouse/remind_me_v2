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
- Theming is generated at runtime: pick one accent seed color and the full Material 3
  palette (light/dark) is derived from it and applied as CSS custom properties. There's no
  static authored color scheme to edit.
- Settings → Backup lets you export your reminders to a JSON file and import them back
  (e.g. when moving to a new device), via the Android system file picker.
- The reminders database (`reminders.db`) and settings (`settings.json`) live in the
  app's private Android data directory.

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
