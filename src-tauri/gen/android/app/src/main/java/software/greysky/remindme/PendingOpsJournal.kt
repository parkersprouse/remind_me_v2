package software.greysky.remindme

import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

/** Broadcast telling a live MainActivity that the journal grew (see there). */
const val PENDING_OPS_UPDATED = "software.greysky.remindme.PENDING_OPS_UPDATED"

/**
 * Reminder bookkeeping performed by a receiver — a background snooze
 * (SnoozeActionReceiver) or a headless create (CreateReminderReceiver) —
 * waiting to be written to reminders.db.
 *
 * The alarm is already armed by the time an entry lands here, so nothing is
 * lost if the app stays closed for days: the journal only carries the
 * bookkeeping the *list* needs, and the frontend drains it (applying the same
 * rules the equivalent in-app operation applies) whenever it next runs. Kotlin
 * deliberately does not touch the SQLite file: reminders.db is owned by
 * tauri-plugin-sql and its schema semantics live in TypeScript.
 *
 * Entries are tagged with a `type` the drain switches on
 * (drainPendingOps in src/lib/notifications.ts). Entries written by builds
 * before the headless-create work have no `type` and are read as snoozes —
 * SharedPreferences survives an app update, so an entry written by the old
 * build can still be sitting here when the new one first runs.
 */
object PendingOpsJournal {
  // The on-disk prefs file, not a display name: renaming it would orphan any
  // entry an already-installed build wrote before this file existed. The
  // Kotlin/TS names around it generalized; this string deliberately did not.
  private const val STORE = "SNOOZE_JOURNAL"
  private const val ENTRIES_KEY = "entries"

  /** Receivers (main thread) and takeAll (WebView thread) both touch this. */
  private val lock = Any()

  /** A snooze applied to `sourceId`, re-armed by the receiver as `newId`. */
  fun appendSnooze(context: Context, sourceId: Int, newId: Int, fireAt: Long, details: String) {
    append(
      context,
      JSONObject()
        .put("type", "snooze")
        .put("sourceId", sourceId)
        .put("newId", newId)
        .put("fireAt", fireAt)
        .put("details", details)
    )
  }

  /** A reminder armed from scratch by a broadcast, with no row of its own yet. */
  fun appendCreate(context: Context, id: Int, fireAt: Long, details: String) {
    append(
      context,
      JSONObject()
        .put("type", "create")
        .put("id", id)
        .put("fireAt", fireAt)
        .put("details", details)
    )
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

  /**
   * Nudge a foregrounded app to drain right away. Without this a snooze or a
   * create taken while the app is on-screen (the shade is an overlay, so no
   * resume ever arrives) would leave the reminder list stale.
   */
  fun notifyUpdated(context: Context) {
    context.sendBroadcast(Intent(PENDING_OPS_UPDATED).setPackage(context.packageName))
  }

  private fun append(context: Context, entry: JSONObject) {
    synchronized(lock) {
      val store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
      val entries = parse(store.getString(ENTRIES_KEY, null))
      entries.put(entry)
      // commit(), not apply(): the process may be torn down as soon as
      // onReceive returns, and an async write could be lost with it.
      store.edit().putString(ENTRIES_KEY, entries.toString()).commit()
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
