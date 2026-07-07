use tauri_plugin_sql::{Migration, MigrationKind};

/// Opens the OS-level notification settings so the user can re-enable
/// notifications after denying them (mirrors the Flutter app's use of the
/// `app_settings` plugin).
#[tauri::command]
fn open_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.notifications")
            .spawn()
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:notifications"])
            .spawn()
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        // No universal notification settings URI on Linux; open the general
        // settings app if available.
        std::process::Command::new("gnome-control-center")
            .arg("notifications")
            .spawn()
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    #[cfg(mobile)]
    {
        Err("Opening notification settings is not supported on this platform yet".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_reminders_table",
        // Schema matches the Flutter app's sqflite table one-to-one
        sql: "CREATE TABLE IF NOT EXISTS reminders (\
            id INTEGER PRIMARY KEY NOT NULL, \
            details TEXT NOT NULL, \
            scheduledForEpochMillis INTEGER NOT NULL, \
            timezone TEXT NOT NULL)",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_safe_area_insets_css::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:reminders.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_notification_settings])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
