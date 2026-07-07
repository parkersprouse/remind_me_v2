# Remind Me!

Remind Me! is an app to help you quickly and easily set reminders to make sure you always
remember what you need to.

This is a **Tauri v2** rewrite of the original Flutter application
(`~/Code/GSS/remind-me`), migrated 1-1 in functionality and design.

## Stack

| Concern | Flutter original | This app |
|---|---|---|
| UI | Flutter widgets (Material 3) | Vue 3 + TypeScript (Vite) |
| State | `provider` (`ChangeNotifier`) | Pinia |
| Reminder storage | `sqflite` | `tauri-plugin-sql` (SQLite, same schema) |
| Settings | `shared_preferences` | `tauri-plugin-store` (`settings.json`) |
| Notifications | `flutter_local_notifications` | `tauri-plugin-notification` |
| Permissions | `permission_handler` / `app_settings` | notification plugin + a small Rust command |
| Theming | Material 3 blue `ColorScheme` | same palette as CSS custom properties |
| Fonts | Inter Display (bundled) | same OTFs via `@font-face` |

## Behavior notes

- **Mobile (Android/iOS)**: reminders are scheduled through the OS notification system
  (`Schedule.at`), including snooze action buttons, matching the original app.
- **Desktop (macOS/Windows/Linux)**: desktop OSes have no scheduled-notification API, so
  reminders are stored in SQLite and an in-app timer fires the notification while the app
  is running. Timers are re-armed on launch; reminders that expire while the app is closed
  are cleaned up on next launch (same cleanup rule as the original).
- The reminders database (`reminders.db`) and settings (`settings.json`) live in the
  platform app-data directory.

## Development

```sh
pnpm install
pnpm tauri dev        # desktop dev build
pnpm build            # typecheck + bundle the frontend only
pnpm tauri build      # production desktop bundle
```

### Android

```sh
pnpm tauri android init
pnpm tauri android dev
```

Requires the Android SDK/NDK plus the Rust Android targets:

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

## Project layout

```
src/                  # Vue frontend
  lib/                # db, notifications, durations, formatting, toaster
  stores/             # Pinia stores (settings, page router)
  components/         # dialogs, pickers, chips, switches
  views/              # Landing, Home (New Reminder / Scheduled Reminders), Settings
src-tauri/            # Rust backend: plugin setup, SQL migration,
                      # open_notification_settings command
```
