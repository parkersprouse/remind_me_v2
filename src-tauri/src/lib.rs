use tauri_plugin_sql::{Migration, MigrationKind};

// Android-only app. Opening the OS notification settings is handled natively in
// MainActivity.kt (@JavascriptInterface `AndroidNative.openNotificationSettings`),
// so there is no custom Rust command here — the backend is purely plugin wiring
// plus the SQLite migration below.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_reminders_table",
            // Schema matches the Flutter app's sqflite table one-to-one
            sql: "CREATE TABLE IF NOT EXISTS reminders (\
                id INTEGER PRIMARY KEY NOT NULL, \
                details TEXT NOT NULL, \
                scheduledForEpochMillis INTEGER NOT NULL, \
                timezone TEXT NOT NULL)",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_repeat_column",
            // Serialized RepeatSpec JSON (see src/lib/repeat.ts); NULL for
            // one-shot reminders
            sql: "ALTER TABLE reminders ADD COLUMN repeat TEXT",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_safe_area_insets_css::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:reminders.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
