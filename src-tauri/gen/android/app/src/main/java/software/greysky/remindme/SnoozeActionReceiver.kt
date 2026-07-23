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
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Date

/** Mirrors SNOOZE_PREFIX / CUSTOM_SNOOZE_ACTION_ID in src/lib/notifications.ts. */
private const val SNOOZE_PREFIX = "snooze_"
private const val CUSTOM_SNOOZE_ACTION_ID = "snooze_custom"

/** Broadcast telling a live MainActivity that the journal grew (see there). */
const val SNOOZE_JOURNAL_UPDATED = "software.greysky.remindme.SNOOZE_JOURNAL_UPDATED"

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
 * frontend to apply to reminders.db on its next drain (SnoozeJournal below).
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

    SnoozeJournal.append(context, sourceId, newId, fireAt, snoozed.largeBody ?: snoozed.body ?: "")
    context.sendBroadcast(Intent(SNOOZE_JOURNAL_UPDATED).setPackage(context.packageName))
  }

  /** Parses the `H:MM:SS` duration encoded in the action id into minutes. */
  private fun snoozeMinutes(duration: String): Int {
    val parts = duration.split(":")
    val hours = parts.getOrNull(0)?.toDoubleOrNull()?.toInt() ?: 0
    val minutes = parts.getOrNull(1)?.toDoubleOrNull()?.toInt() ?: 0
    return hours * 60 + minutes
  }
}

/**
 * Snoozes performed while the app was not running, waiting to be written to
 * reminders.db.
 *
 * The alarm is already armed by the time an entry lands here, so nothing is
 * lost if the app stays closed for days — the journal only carries the
 * bookkeeping the *list* needs, and the frontend drains it (applying the same
 * one-shot/repeat rules as an in-app snooze) whenever it next runs. Kotlin
 * deliberately does not touch the SQLite file: reminders.db is owned by
 * tauri-plugin-sql and its schema semantics live in TypeScript.
 */
object SnoozeJournal {
  private const val STORE = "SNOOZE_JOURNAL"
  private const val ENTRIES_KEY = "entries"

  /** Receiver (main thread) and takeAll (WebView thread) both touch this. */
  private val lock = Any()

  fun append(context: Context, sourceId: Int, newId: Int, fireAt: Long, details: String) {
    synchronized(lock) {
      val store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
      val entries = parse(store.getString(ENTRIES_KEY, null))
      entries.put(
        JSONObject()
          .put("sourceId", sourceId)
          .put("newId", newId)
          .put("fireAt", fireAt)
          .put("details", details)
      )
      // commit(), not apply(): the process may be torn down as soon as
      // onReceive returns, and an async write could be lost with it.
      store.edit().putString(ENTRIES_KEY, entries.toString()).commit()
    }
  }

  /** Returns the pending entries as a JSON array string and clears the store. */
  fun takeAll(context: Context): String {
    synchronized(lock) {
      val store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
      val entries = store.getString(ENTRIES_KEY, null) ?: return "[]"
      store.edit().remove(ENTRIES_KEY).commit()
      return entries
    }
  }

  private fun parse(raw: String?): JSONArray =
    if (raw == null) JSONArray()
    else try {
      JSONArray(raw)
    } catch (_: Exception) {
      JSONArray()
    }
}
