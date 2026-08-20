package software.greysky.remindme

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import app.tauri.notification.ACTION_INTENT_KEY
import app.tauri.notification.NOTIFICATION_INTENT_KEY
import app.tauri.notification.NOTIFICATION_OBJ_INTENT_KEY
import app.tauri.notification.Notification
import app.tauri.notification.NotificationSchedule
import app.tauri.notification.scheduleNotificationInBackground
import java.security.SecureRandom
import java.util.Date

/** Mirrors SNOOZE_PREFIX / CUSTOM_SNOOZE_ACTION_ID in src/lib/notifications.ts. */
private const val SNOOZE_PREFIX = "snooze_"
private const val CUSTOM_SNOOZE_ACTION_ID = "snooze_custom"

/**
 * Handles a preset snooze button tapped in the notification drawer *without*
 * bringing the app to the foreground.
 *
 * The plugin routes here (rather than to MainActivity) because these actions
 * are registered with `foreground: false` — see registerSnoozeActions() in
 * src/lib/notifications.ts and BACKGROUND_ACTION_BROADCAST in the vendored
 * TauriNotificationManager. The tradeoff is that there is no webview here, so
 * none of the TypeScript reminder logic can run; this receiver does only the
 * two things that cannot wait for the app to be opened again — dismiss the
 * notification and arm the snoozed copy — and journals the rest for the
 * frontend to apply to reminders.db on its next drain (PendingOpsJournal).
 *
 * Everything needed to rebuild the notification (body, channel, icon, action
 * group) rides along in the intent as the serialized source notification, so
 * no reminder constants are duplicated here.
 */
class SnoozeActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val sourceId = intent.getIntExtra(NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
    if (sourceId == Int.MIN_VALUE) return

    val actionId = intent.getStringExtra(ACTION_INTENT_KEY) ?: return
    // "Custom…" deliberately stays on the Activity path (it needs the in-app
    // dialog), so it should never arrive here; ignore it if it somehow does.
    if (!actionId.startsWith(SNOOZE_PREFIX) || actionId == CUSTOM_SNOOZE_ACTION_ID) return
    val minutes = snoozeMinutes(actionId.removePrefix(SNOOZE_PREFIX))
    if (minutes <= 0) return

    val serialized = intent.getStringExtra(NOTIFICATION_OBJ_INTENT_KEY) ?: return
    val snoozed = Notification.fromJson(serialized) ?: return

    // The Activity path got this for free via dismissVisibleNotification().
    NotificationManagerCompat.from(context).cancel(sourceId)

    val newId = SecureRandom().nextInt(Int.MAX_VALUE)
    val fireAt = System.currentTimeMillis() + minutes * 60_000L
    // Reuses the deserialized source (a private copy already) as the new
    // notification: body, channelId, icon and actionTypeId carry over
    // untouched, so the snoozed reminder is indistinguishable from the original
    // and this receiver needs to know none of those values.
    snoozed.id = newId
    // A snooze is always a one-shot, even when the reminder that fired repeats:
    // the recurrence rule stays with the original (matching
    // notification_manager.snooze in src/lib/notifications.ts). allowWhileIdle
    // mirrors the Schedule.at(dateTime, false, true) used by arm().
    snoozed.schedule = NotificationSchedule.At().also {
      it.date = Date(fireAt)
      it.repeating = false
      it.allowWhileIdle = true
    }

    scheduleNotificationInBackground(context, snoozed)

    PendingOpsJournal.appendSnooze(
      context, sourceId, newId, fireAt, snoozed.largeBody ?: snoozed.body ?: ""
    )
    PendingOpsJournal.notifyUpdated(context)
  }

  /** Parses the `H:MM:SS` duration encoded in the action id into minutes. */
  private fun snoozeMinutes(duration: String): Int {
    val parts = duration.split(":")
    val hours = parts.getOrNull(0)?.toDoubleOrNull()?.toInt() ?: 0
    val minutes = parts.getOrNull(1)?.toDoubleOrNull()?.toInt() ?: 0
    return hours * 60 + minutes
  }
}
