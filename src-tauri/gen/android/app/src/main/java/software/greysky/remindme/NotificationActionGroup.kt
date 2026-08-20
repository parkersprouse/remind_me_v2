package software.greysky.remindme

import android.content.Context

/**
 * The action-type id to attach to a notification armed by a receiver.
 *
 * A snooze rebuilds its notification from the serialized source, so it
 * inherits the group for free; a headless create (CreateReminderReceiver) has
 * no source and must be told. The value depends on runtime state Kotlin cannot
 * see — the snooze setting decides whether the group is registered at all — so
 * the frontend mirrors it here whenever it registers the actions
 * (registerSnoozeActions in src/lib/notifications.ts, via the AndroidNative
 * bridge in MainActivity.kt).
 *
 * Absent (app never opened since install) or empty (snooze disabled) means
 * "arm without action buttons": a reminder with no snooze buttons, not a
 * dropped reminder.
 */
object NotificationActionGroup {
  private const val STORE = "NOTIFICATION_DEFAULTS"
  private const val ACTION_TYPE_ID_KEY = "actionTypeId"

  fun set(context: Context, actionTypeId: String) {
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
      .edit()
      .putString(ACTION_TYPE_ID_KEY, actionTypeId)
      .apply()
  }

  /** Null when snooze is off or the frontend has never registered actions. */
  fun current(context: Context): String? =
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
      .getString(ACTION_TYPE_ID_KEY, null)
      ?.takeIf { it.isNotEmpty() }
}
