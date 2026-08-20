package software.greysky.remindme

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.RemoteViews
import androidx.core.app.NotificationManagerCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val TAG = "QuickCreateWidget"

/**
 * Tap on a preset button. Delivered to this provider rather than straight to
 * CreateReminderReceiver so the widget can repaint a confirmation: a
 * home-screen button that does nothing visible reads as a broken widget, and
 * the create broadcast is silent by design.
 *
 * Not declared in an intent filter — the PendingIntents built below are
 * explicit, which is all an exported receiver needs.
 */
private const val ACTION_QUICK_CREATE = "software.greysky.remindme.WIDGET_QUICK_CREATE"

private const val EXTRA_MINUTES = "minutes"

/**
 * The preset buttons, paired with the views they paint. Durations mirror
 * quickScheduleOptions' defaults in src/stores/settings.ts (the app's own
 * quick-schedule chips); the labels live in strings.xml, which explains why
 * they are hardcoded rather than read from the user's setting.
 */
private val PRESETS = listOf(
  Preset(R.id.widget_preset_0, R.string.widget_preset_15m, 15),
  Preset(R.id.widget_preset_1, R.string.widget_preset_30m, 30),
  Preset(R.id.widget_preset_2, R.string.widget_preset_1h, 60),
)

/**
 * The label is painted from here rather than left to the layout's
 * `android:text`, which nothing ties to `minutes`: changing a duration would
 * otherwise leave the button claiming the old one, and no build or screenshot
 * would catch it. The layout's static text stays as what `previewLayout`
 * shows in the widget picker.
 */
private data class Preset(val viewId: Int, val labelId: Int, val minutes: Int)

/**
 * Upper bound on a forwarded duration. The buttons only ever send a value from
 * PRESETS, but the provider is exported (every widget provider must be), so an
 * installed app could broadcast ACTION_QUICK_CREATE with anything. Clamping
 * here is defence in depth — CreateReminderReceiver validates the same request
 * again and is the documented public surface — and it keeps the confirmation
 * line from claiming an absurd time.
 */
private const val MAX_MINUTES = 7 * 24 * 60

/**
 * Mirrors formatTime() in src/lib/format.ts, which hardcodes the en-US `jm`
 * pattern ("5:08 PM") rather than following the device's 12/24-hour setting —
 * so a confirmation here reads the same as the reminder does in the app.
 */
private val TIME_FORMAT = SimpleDateFormat("h:mm a", Locale.US)

/**
 * Home-screen quick-create widget (PLAN.md, phase 4): three preset buttons
 * that arm a reminder without launching the app, plus a button that opens the
 * New Reminder form.
 *
 * The presets are the phase-3 headless-creation broadcast with a UI on top —
 * they forward to CreateReminderReceiver by explicit component and it does all
 * the arming and journalling. The relative `inMinutes` extra exists precisely
 * for this: a PendingIntent is built when the widget is painted and may be
 * tapped hours later, so an absolute fire time cannot be baked into it.
 *
 * Text input is impossible in a widget (RemoteInput is notification-only,
 * RemoteViews has no editable field), so a preset reminder's body is the fixed
 * widget_reminder_details string; anything that needs words goes through the
 * "+" button into the app.
 */
class QuickCreateWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    // Every id, not just the first: the user may have placed several, and the
    // PendingIntents are per-instance (see quickCreateIntent).
    appWidgetIds.forEach { id ->
      appWidgetManager.updateAppWidget(id, buildViews(context, id, status = null))
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION_QUICK_CREATE) quickCreate(context, intent)
    super.onReceive(context, intent)
  }

  private fun quickCreate(context: Context, intent: Intent) {
    val minutes = intent.getIntExtra(EXTRA_MINUTES, 0)
    if (minutes !in 1..MAX_MINUTES) {
      Log.w(TAG, "ignoring quick-create for out-of-range duration: $minutes minutes")
      return
    }

    context.sendBroadcast(
      Intent(context, CreateReminderReceiver::class.java)
        // Redundant next to the explicit component, but it keeps a logged
        // intent readable and matches the documented contract (README.md).
        .setAction(ACTION_CREATE_REMINDER)
        .putExtra(EXTRA_DETAILS, context.getString(R.string.widget_reminder_details))
        .putExtra(EXTRA_IN_MINUTES, minutes.toLong())
    )

    // Optimistic: a plain sendBroadcast has no result code to wait for, and a
    // request built from PRESETS cannot fail validation by construction —
    // details is a non-blank constant and the duration was just range-checked.
    // If the real code is ever wanted, it is goAsync() + sendOrderedBroadcast.
    val fireAt = System.currentTimeMillis() + minutes * 60_000L
    // The one outcome worth distinguishing, and the provider can read it for
    // itself rather than waiting on a result code: with notifications off the
    // alarm is still armed (AlarmManager doesn't care) but nothing will show,
    // which a bare "Reminder set" would quietly misrepresent — and it is the
    // state a widget placed before the app was ever opened is in.
    val visible = NotificationManagerCompat.from(context).areNotificationsEnabled()
    val status = context.getString(
      if (visible) R.string.widget_status_set else R.string.widget_status_set_muted,
      TIME_FORMAT.format(Date(fireAt)),
    )
    Log.i(TAG, "quick-create: $minutes minutes -> $fireAt (notifications enabled: $visible)")

    val appWidgetId = intent.getIntExtra(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID,
    )
    if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return
    AppWidgetManager.getInstance(context)
      .updateAppWidget(appWidgetId, buildViews(context, appWidgetId, status))
  }

  /** @param status the confirmation line, or null for the idle hint. */
  private fun buildViews(context: Context, appWidgetId: Int, status: String?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_quick_create)
    views.setTextViewText(R.id.widget_status, status ?: context.getString(R.string.widget_hint))
    PRESETS.forEach { preset ->
      views.setTextViewText(preset.viewId, context.getString(preset.labelId))
      views.setOnClickPendingIntent(
        preset.viewId,
        quickCreateIntent(context, appWidgetId, preset.minutes),
      )
    }
    views.setOnClickPendingIntent(R.id.widget_new_reminder, newReminderIntent(context))
    return views
  }

  private fun quickCreateIntent(context: Context, appWidgetId: Int, minutes: Int): PendingIntent {
    val intent = Intent(context, QuickCreateWidgetProvider::class.java)
      .setAction(ACTION_QUICK_CREATE)
      .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
      .putExtra(EXTRA_MINUTES, minutes)
      // PendingIntent identity ignores extras (Intent.filterEquals), so without
      // something distinguishing per button *and* per widget instance, every
      // one of them would collapse onto a single PendingIntent and
      // FLAG_UPDATE_CURRENT would leave them all doing whatever was registered
      // last. The data URI is what makes them distinct — filterEquals does
      // compare data — and the request code mirrors it as a second axis.
      .setData(Uri.parse("remindme-widget://quick-create/$appWidgetId/$minutes"))
    return PendingIntent.getBroadcast(
      context,
      appWidgetId * 10_000 + minutes,
      intent,
      // IMMUTABLE for the reason documented in CLAUDE.md: mutability is only
      // needed for RemoteInput, and Android 14+ rejects a mutable PendingIntent
      // wrapping an implicit intent anyway.
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /**
   * The phase-1 deep link with no query parameters, which the frontend treats
   * as "open the New Reminder form" rather than a create request — so it is
   * exempt from the replay guard and, deliberately, does not touch a
   * half-typed form (src/lib/createRequest.ts). Same intent the launcher
   * shortcut fires (res/xml/shortcuts.xml); no frontend change was needed for
   * this button.
   */
  private fun newReminderIntent(context: Context): PendingIntent {
    val intent = Intent(context, MainActivity::class.java)
      .setAction(Intent.ACTION_VIEW)
      .setData(Uri.parse("remindme://create"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
