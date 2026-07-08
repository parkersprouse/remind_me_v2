# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tauri v2 (Vue 3 + TypeScript + Pinia + Vite) rewrite of the Flutter app at `~/Code/GSS/remind-me`, migrated 1-1 in functionality and design. **The Flutter source is the behavior/design reference — preserve parity unless told otherwise.**

## Commands

```sh
pnpm install
pnpm tauri dev        # desktop dev build
pnpm build            # vue-tsc typecheck + vite bundle (frontend only)
pnpm tauri build      # production desktop bundle
```

There are no tests or linters configured; `pnpm build` (typecheck) is the main correctness gate.

### Android

```sh
pnpm tauri android build --debug --target aarch64
# APK: src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb install -r <apk>
adb shell am start -n software.greysky.remindme/.MainActivity
```

- Wait ~8s after launch before sending adb input events, or an ANR dialog kills the app.
- Stale dev-cache gotcha: if the installed APK shows "Failed to request http://localhost:1420/", a prior `tauri android dev` left dev-mode build-script output in the cargo cache. Fix: `cd src-tauri && cargo clean -p remind_me && touch build.rs`, then rebuild.
- Inspect live JS state via WebView CDP: `adb forward tcp:9223 localabstract:webview_devtools_remote_$(adb shell pidof software.greysky.remindme)` then `Runtime.evaluate` over WebSocket. Re-forward after every app restart. Prefer CDP evals over screenshots for asserting app state.
- `withGlobalTauri` is enabled in `tauri.conf.json`, so CDP evals can drive the backend directly via `window.__TAURI__.core.invoke(...)` (e.g. `plugin:notification|notify`, `plugin:notification|cancel`).
- The app DB is WAL-mode SQLite at `/data/data/software.greysky.remindme/reminders.db`; to inspect it, `run-as` cat **all three** files (`.db`, `.db-wal`, `.db-shm`) to the host, then open with local `sqlite3` — pulling only the `.db` shows stale pre-checkpoint data.

## Architecture

**Thin Rust backend, logic lives in the frontend.** `src-tauri/src/lib.rs` only registers plugins, defines the SQLite migration (the `reminders` table schema — matches the Flutter sqflite schema exactly), and exposes one command (`open_notification_settings`). Everything else is TypeScript.

**No vue-router.** Navigation is a tiny Pinia store (`src/stores/router.ts`) that switches between three pages (`landing` / `home` / `settings`) plus a home tab index — an IndexedStack-style switcher mirroring the Flutter RouterModel. Its `back()` action encodes the Android back-button policy.

**Platform split is the core design axis** (`src/lib/platform.ts` + `src/lib/notifications.ts`):
- **Mobile (Android/iOS):** reminders are scheduled through the OS notification system (`Schedule.at`) with snooze action buttons. Android uses a high-importance channel (`reminders_high`) so notifications pop heads-up; channel importance is frozen by the OS at creation, so changing it requires renaming the channel id.
- **Desktop:** no OS scheduled-notification API exists, so reminders live in SQLite and in-app `setTimeout` timers fire notifications while the app runs. Timers re-arm on launch; expired reminders are cleaned up on next launch.
- **Browser dev (`pnpm dev` without Tauri):** `isTauri` guards in `src/lib/tauri.ts` provide no-op fallbacks so the UI can run in a plain browser.

**Persistence:** `reminders.db` via tauri-plugin-sql (frontend queries in `src/lib/db.ts`; table created by the Rust migration, not by the frontend) and `settings.json` via tauri-plugin-store (`src/stores/settings.ts`).

**Startup order matters** (`src/main.ts`): mount the app first, then register the Android back handler (needs active Pinia), then run async init (settings → notification channel/actions → expired cleanup).

## Gotchas

- **Capabilities:** any new plugin API call needs a matching permission in `src-tauri/capabilities/default.json`. A missing permission fails silently — the invoke promise rejects but the notification shim is fire-and-forget and native logs show nothing. Android OS permissions (e.g. `SCHEDULE_EXACT_ALARM`) additionally go in `src-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- **`src-tauri/gen/android/` contains hand edits.** `MainActivity.kt` intercepts back presses via `OnBackPressedCallback` and evaluates `window.androidBackHandler()` in the webview (bridge in `src/lib/androidBack.ts`), and delivers notification action taps to `window.androidNotificationAction(id, actionId)` with retry polling — the plugin's own `actionPerformed` event is unusable (dropped on cold start, payload lacks the notification id). The manifest also has manual permission additions. Don't regenerate or blindly overwrite this tree.
- **Safe-area insets:** Android WebView never populates `env(safe-area-inset-*)`; the `@saurl/tauri-plugin-safe-area-insets-css-api` side-effect import in `main.ts` keeps `--safe-area-inset-top/bottom` CSS vars in sync. Layout must use those vars, not `env()`.
- **`tauri-plugin-notification` is vendored** at `src-tauri/vendored/tauri-plugin-notification` via `[patch.crates-io]`: upstream 2.3.3 stores action buttons under the wrong SharedPreferences keys, so every action renders with an empty title and reports an empty action id when tapped (fix + explanation in the vendored `NotificationStorage.kt`). Before upgrading the plugin, check whether upstream fixed `writeActionGroup`; the plugin's `onAction` event is separately unusable on Android (payload lacks the notification id, cold-start events are dropped) — action taps flow through the `MainActivity.kt` → `window.androidNotificationAction` bridge instead.
- **`[profile.dev] strip = "debuginfo"`** in `src-tauri/Cargo.toml` keeps debug APKs ~30MB instead of ~326MB. Don't remove it.
- **Font Awesome:** the Flutter app used FA Pro icons; this rewrite uses the free set plus the `BadgedIcon` component as a stand-in. The `@fortawesome` scope must resolve to registry.npmjs.org (Pro registry returns 401 on this machine).
