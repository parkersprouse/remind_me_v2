package software.greysky.remindme

import android.content.Context

/**
 * Whether the reminder-list widget's mic button should auto-create the
 * parsed reminder headlessly (the only behavior before this setting existed)
 * or instead open the app with the New Reminder form prefilled for the user
 * to review — Settings > Voice Reminders > "Auto-create from widget voice"
 * (src/stores/settings.ts). VoiceQuickCreateActivity can run in a process
 * with no live webview to ask, so the frontend mirrors the setting here
 * whenever it changes (syncVoiceWidgetAutoCreate in src/lib/voiceReminder.ts,
 * via the AndroidNative bridge in MainActivity.kt) — same reasoning and
 * pattern as NotificationActionGroup mirroring the snooze setting.
 *
 * Absent (app never opened since installing this feature) defaults to true,
 * matching the only behavior everyone upgrading into this setting already
 * has.
 */
object VoiceWidgetSettings {
  private const val STORE = "VOICE_WIDGET_SETTINGS"
  private const val AUTO_CREATE_KEY = "autoCreate"

  fun setAutoCreate(context: Context, autoCreate: Boolean) {
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(AUTO_CREATE_KEY, autoCreate)
      .apply()
  }

  fun autoCreate(context: Context): Boolean =
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
      .getBoolean(AUTO_CREATE_KEY, true)
}
