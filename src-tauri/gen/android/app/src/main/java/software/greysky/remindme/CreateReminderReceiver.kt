package software.greysky.remindme

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import app.tauri.notification.Notification
import app.tauri.notification.NotificationSchedule
import app.tauri.notification.scheduleNotificationInBackground
import java.security.SecureRandom
import java.util.Date

private const val TAG = "CreateReminder"

/**
 * Mirrors CHANNEL_ID / NOTIFICATION_TITLE and the `icon` passed by arm() in
 * src/lib/notifications.ts — a reminder armed here must be indistinguishable
 * from one armed in-app. These three are module constants on the TS side, so
 * they are duplicated rather than plumbed across; the one value that is *not*
 * constant (the snooze action group, which depends on the user's settings)
 * comes from NotificationActionGroup instead.
 */
private const val CHANNEL_ID = "reminders_high"
private const val NOTIFICATION_TITLE = "Don't Forget!"
private const val SMALL_ICON = "ic_stat_logo"

/** Mirrors DETAILS_MAX_LENGTH in src/lib/createRequest.ts (DetailsInput.vue's cap). */
private const val DETAILS_MAX_LENGTH = 240

/** How far in the past a fireAt may sit and still count as "fire now". */
private const val PAST_GRACE_MILLIS = 60_000L

/** Upper bound on how far out a reminder may be armed (~10 years). */
private const val MAX_FUTURE_MILLIS = 10L * 365 * 24 * 60 * 60 * 1000

/** Mirrors the intent filter in AndroidManifest.xml; keep the two in sync. */
const val ACTION_CREATE_REMINDER = "software.greysky.remindme.CREATE_REMINDER"

const val EXTRA_DETAILS = "details"
const val EXTRA_FIRE_AT = "fireAt"
const val EXTRA_IN_MINUTES = "inMinutes"

/**
 * Extras that would imply a recurring reminder. Repeats are deliberately not
 * supported headlessly (PLAN.md phase 3, decision A): the recurrence rules live
 * in src/lib/repeat.ts and porting nextOccurrence() to Kotlin is not worth it.
 * A caller that sends one is rejected rather than silently given a one-shot.
 *
 * Deliberately only names that can't mean anything else: a generic automation
 * tool dumping its variables into extras could plausibly carry a `count` or a
 * `unit` alongside a perfectly valid one-shot, and rejecting that would be a
 * false positive for a request with no recurrence in it.
 */
private val REPEAT_EXTRAS = listOf("repeat", "every", "interval", "frequency")

// Result codes, readable by an ordered broadcast's result receiver — which is
// what `adb shell am broadcast` uses, so these are also the fastest way to see
// what the receiver made of a request. 0 is Android's default and means the
// receiver never ran (wrong component/action, or the app is force-stopped).
const val RESULT_SCHEDULED = 1
const val RESULT_SCHEDULED_NOTIFICATIONS_DISABLED = 2
const val RESULT_INVALID_DETAILS = 10
const val RESULT_INVALID_TIME = 11
const val RESULT_UNSUPPORTED_REPEAT = 12

/**
 * Arms a reminder from a broadcast, with no UI and without launching the app
 * (PLAN.md, phase 3) — the automation entry point: Tasker, HTTP Shortcuts, an
 * `adb shell am broadcast`, or (phase 4) a home-screen widget button.
 *
 *     adb shell "am broadcast \
 *       -n software.greysky.remindme/.CreateReminderReceiver \
 *       -a software.greysky.remindme.CREATE_REMINDER \
 *       --es details 'Take out the bins' --el fireAt 1786000000000"
 *
 * The work splits exactly as it does for a background snooze
 * (SnoozeActionReceiver): there is no webview in a receiver, so Kotlin does
 * only what cannot wait — arm the OS alarm — and journals the reminders.db
 * bookkeeping for the frontend to apply on its next drain. The id armed here is
 * the id journalled, so a re-drain is idempotent.
 *
 * The receiver is exported: automation apps cannot hold a signature or custom
 * permission, so access control would defeat the feature outright. The
 * mitigation is input validation instead (see the bounds above) — extras only
 * ever become notification body text, so that is the whole threat surface.
 *
 * Note this is *not* idempotent against a caller retry: a broadcast is never
 * redelivered by the OS the way a singleTask launch intent is, so there is no
 * replay to guard against, and a "seen keys" table would only dedup against
 * entries that have not yet been drained — a half-guarantee that reads like a
 * whole one. Callers must not blind-retry (see README).
 */
class CreateReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val details = normalizeDetails(intent.getStringExtra(EXTRA_DETAILS))
    if (details == null) {
      return reject(RESULT_INVALID_DETAILS, "missing or blank `$EXTRA_DETAILS` extra")
    }

    val repeatExtra = REPEAT_EXTRAS.firstOrNull { intent.hasExtra(it) }
    if (repeatExtra != null) {
      return reject(
        RESULT_UNSUPPORTED_REPEAT,
        "`$repeatExtra`: repeating reminders cannot be created headlessly; " +
          "use the remindme://create deep link and set the rule in the app",
      )
    }

    val now = System.currentTimeMillis()
    val requested = resolveFireAt(intent, now)
      ?: return reject(
        RESULT_INVALID_TIME,
        "exactly one of `$EXTRA_FIRE_AT` (epoch millis) or `$EXTRA_IN_MINUTES` is required",
      )
    if (requested < now - PAST_GRACE_MILLIS || requested > now + MAX_FUTURE_MILLIS) {
      return reject(RESULT_INVALID_TIME, "fire time $requested is out of range")
    }
    // Inside the grace window a past time means "as soon as possible", so it is
    // clamped rather than rejected. The journal gets the clamped value too, so
    // the row and the alarm agree.
    val fireAt = maxOf(requested, now)

    val id = SecureRandom().nextInt(Int.MAX_VALUE)
    val notification = Notification().also {
      it.id = id
      it.title = NOTIFICATION_TITLE
      it.body = details
      it.largeBody = details
      it.channelId = CHANNEL_ID
      it.icon = SMALL_ICON
      it.actionTypeId = NotificationActionGroup.current(context)
      // allowWhileIdle mirrors the Schedule.at(dateTime, false, true) in arm().
      it.schedule = NotificationSchedule.At().also { at ->
        at.date = Date(fireAt)
        at.repeating = false
        at.allowWhileIdle = true
      }
    }

    scheduleNotificationInBackground(context, notification)
    PendingOpsJournal.appendCreate(context, id, fireAt, details)
    PendingOpsJournal.notifyUpdated(context)

    // Notifications being disabled is deliberately not a rejection: the alarm
    // is armed and the reminder still shows up in the list on next open, which
    // beats losing it. The caller is told so it can say something useful.
    val visible = NotificationManagerCompat.from(context).areNotificationsEnabled()
    val code = if (visible) RESULT_SCHEDULED else RESULT_SCHEDULED_NOTIFICATIONS_DISABLED
    Log.i(TAG, "scheduled reminder $id for $fireAt (notifications enabled: $visible)")
    if (isOrderedBroadcast) resultCode = code
  }

  /**
   * Absolute `fireAt` wins over relative `inMinutes`; one of the two is
   * required. `inMinutes` exists because a widget button (phase 4) cannot bake
   * an absolute time into a PendingIntent that may be tapped hours later.
   */
  private fun resolveFireAt(intent: Intent, now: Long): Long? {
    numberExtra(intent, EXTRA_FIRE_AT)?.let { return it }
    val minutes = numberExtra(intent, EXTRA_IN_MINUTES) ?: return null
    // Guard the multiplication itself: a caller-supplied Long.MAX_VALUE would
    // otherwise overflow into a *past* time and sail through the range check.
    if (minutes < 0 || minutes > MAX_FUTURE_MILLIS / 60_000L) return null
    return now + minutes * 60_000L
  }

  /**
   * Reads a numeric extra whatever shape the caller sent it in. `--el` gives a
   * Long, `--ei` an Int, and a shell caller may well send `--es`; a typed
   * getter silently returns its default for the wrong type, which would read as
   * "absent" and produce a baffling rejection.
   */
  private fun numberExtra(intent: Intent, key: String): Long? {
    if (!intent.hasExtra(key)) return null
    val asLong = intent.getLongExtra(key, Long.MIN_VALUE)
    if (asLong != Long.MIN_VALUE) return asLong
    val asInt = intent.getIntExtra(key, Int.MIN_VALUE)
    if (asInt != Int.MIN_VALUE) return asInt.toLong()
    return intent.getStringExtra(key)?.trim()?.toLongOrNull()
  }

  /** Mirrors normalizeDetails() in src/lib/createRequest.ts. */
  private fun normalizeDetails(raw: String?): String? {
    val trimmed = raw?.trim()
    if (trimmed.isNullOrEmpty()) return null
    return if (trimmed.length > DETAILS_MAX_LENGTH) trimmed.take(DETAILS_MAX_LENGTH) else trimmed
  }

  /**
   * Never fail silently: a dropped broadcast is invisible to the caller, which
   * PLAN.md calls the worst failure mode this feature can have. Every reject
   * path logs and, when the broadcast is ordered, reports a distinct code.
   */
  private fun reject(code: Int, reason: String) {
    Log.w(TAG, "rejected create request: $reason")
    if (isOrderedBroadcast) resultCode = code
  }
}
