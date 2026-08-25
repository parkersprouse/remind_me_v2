package software.greysky.remindme

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.RemoteViews
import android.widget.Toast
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Request codes for this widget's PendingIntents. They matter for more than
 * tidiness: a PendingIntent's identity is (package, request code, type,
 * Intent.filterEquals) — mutability is *not* part of it — so two intents that
 * compare equal collapse onto one PendingIntent, and with FLAG_UPDATE_CURRENT
 * whichever call site ran first decides whether it is mutable. An immutable
 * template silently breaks every row tap. Since phase 6 the row template
 * carries no data URI, so it no longer compares equal to the "open the list"
 * tap — but these codes are what makes that a detail rather than the thing
 * holding the widget together.
 */
private const val REQUEST_ROW_TEMPLATE = 5001
private const val REQUEST_OPEN_LIST = 5002
private const val REQUEST_NEW_REMINDER = 5003
private const val REQUEST_REFRESH = 5004
private const val REQUEST_VOICE_REMINDER = 5005

/**
 * Header refresh button, opposite the "+". Not declared in an intent filter —
 * same as QuickCreateWidgetProvider's ACTION_QUICK_CREATE — since the
 * PendingIntent below is explicit and needs no filter match.
 *
 * Deliberately does not open the app: Kotlin already holds the last snapshot
 * the frontend pushed, and everything a tap can usefully do — re-run the
 * render-time fireAt filter against *now*, dropping a reminder that fired
 * since the last push, and (when the relative-time setting is on) re-render
 * every row's meta line against the current clock — is exactly what refresh()
 * below already does on every push. This just lets the user ask for that
 * re-evaluation on demand instead of waiting for the next app resume or
 * list-tab visit (see App.vue's onResume and ReminderListTab's cleanExpired).
 * It cannot pick up a reminder actually created or snoozed in the background
 * and not yet drained — that still needs the app, per the module boundary in
 * WidgetSnapshot's own header comment.
 *
 * The tap also runs a short spin animation on the button icon and finishes
 * with a Toast (spinAndRefresh below) — otherwise the actual work is fast
 * enough that a tap with the app closed produces literally no visible
 * feedback, which reads as a broken button rather than a no-op.
 */
private const val ACTION_REFRESH = "software.greysky.remindme.WIDGET_REFRESH"

/**
 * Flipbook frames for the refresh icon's spin, one per 45° step; frame 0
 * (unrotated) is the layout's own default, so it isn't repeated here — see
 * spinAndRefresh, which lands back on it by rebuilding the chrome from
 * scratch rather than by painting a matching last frame.
 */
private val SPIN_FRAMES = intArrayOf(
  R.drawable.ic_widget_refresh_45,
  R.drawable.ic_widget_refresh_90,
  R.drawable.ic_widget_refresh_135,
  R.drawable.ic_widget_refresh_180,
  R.drawable.ic_widget_refresh_225,
  R.drawable.ic_widget_refresh_270,
  R.drawable.ic_widget_refresh_315,
)
private const val SPIN_FRAME_INTERVAL_MS = 90L

/**
 * Home-screen reminder list (PLAN.md, phase 5): a scrolling list of upcoming
 * reminders, rendered entirely from the snapshot the frontend pushes (see
 * WidgetSnapshot).
 *
 * Plain RemoteViews, not Jetpack Glance — pulling Compose into this
 * hand-edited Gradle tree would reopen precisely the R8 failure class this
 * repo has already been bitten by twice (CLAUDE.md), to buy authoring
 * ergonomics for a list of text rows.
 *
 * The list is populated the pre-API-31 way, through a RemoteViewsService
 * (ReminderListWidgetService): RemoteViews.RemoteCollectionItems is API 31+
 * and minSdk here is 26, and one code path that works everywhere beats a
 * version branch for a list this small.
 */
class ReminderListWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    appWidgetIds.forEach { id ->
      appWidgetManager.updateAppWidget(id, buildViews(context, id))
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    // goAsync() keeps the receiver (and its process) alive past onReceive
    // returning, which the spin's postDelayed loop needs. The guard means a
    // double-tap mid-spin is a no-op rather than two interleaved sequences
    // stomping each other's frames and finishing (or Toasting) twice.
    if (intent.action == ACTION_REFRESH && spinning.compareAndSet(false, true)) {
      spinAndRefresh(context.applicationContext, goAsync())
    }
    super.onReceive(context, intent)
  }

  companion object {
    private val spinning = AtomicBoolean(false)

    /**
     * Repaint every placed instance, from the snapshot the frontend just
     * pushed (WidgetSnapshot.set). Nothing else would repaint it:
     * updatePeriodMillis is 0, which has a 30-minute floor and would only
     * wake the process to re-read a file that changes when the app says so.
     */
    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        ComponentName(context, ReminderListWidgetProvider::class.java)
      )
      if (ids.isEmpty()) return
      val chrome = chromeViews(context)
      // partiallyUpdateAppWidget, not updateAppWidget, and this is
      // load-bearing rather than an optimization: a full updateAppWidget from
      // the app is accepted and then dropped by the platform ("Trying to
      // notify widget update deferred" in logcat) whenever the RemoteViews
      // carry a setRemoteAdapter — only the APPWIDGET_UPDATE broadcast's own
      // onUpdate gets through. The failure is quiet and lopsided: the rows go
      // on refreshing, because the host re-queries the factory directly, so
      // what you see is a fresh list drawn in a stale palette — light text on
      // a dark panel after a theme change. A partial update carries only the
      // chrome actions, merges into the stored views, and lands. It also
      // skips re-binding the adapter on every push, which was wasted work.
      ids.forEach { id -> manager.partiallyUpdateAppWidget(id, chrome) }
      manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list)
    }

    /**
     * The refresh button's on-tap feedback: paint SPIN_FRAMES onto the icon
     * one at a time, then do the actual refresh() and finish with a Toast.
     *
     * RemoteViews gives no way to hand the launcher a real animation to run —
     * everything here has to be driven from this side, one partial update per
     * frame, which is exactly what goAsync()'s PendingResult exists to keep
     * the receiver alive for. The refresh itself runs *after* the spin,
     * not before: chromeViews() below always inflates the layout from
     * scratch, so calling refresh() is also what resets the icon to its
     * layout default (frame 0) — no separate "reset" step needed — and it
     * means the Toast and the list visibly updating land together.
     *
     * If ids is empty there is nothing to animate or refresh, and no button
     * was tapped to receive a Toast about it.
     */
    private fun spinAndRefresh(context: Context, pendingResult: BroadcastReceiver.PendingResult) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        ComponentName(context, ReminderListWidgetProvider::class.java)
      )
      if (ids.isEmpty()) {
        spinning.set(false)
        pendingResult.finish()
        return
      }

      val handler = Handler(Looper.getMainLooper())

      fun paintFrame(index: Int) {
        if (index >= SPIN_FRAMES.size) {
          refresh(context)
          Toast.makeText(
            context,
            context.getString(R.string.list_widget_refreshed),
            Toast.LENGTH_SHORT,
          ).show()
          spinning.set(false)
          pendingResult.finish()
          return
        }
        val frame = RemoteViews(context.packageName, R.layout.widget_reminder_list).apply {
          setImageViewResource(R.id.widget_refresh, SPIN_FRAMES[index])
        }
        ids.forEach { id -> manager.partiallyUpdateAppWidget(id, frame) }
        handler.postDelayed({ paintFrame(index + 1) }, SPIN_FRAME_INTERVAL_MS)
      }

      paintFrame(0)
    }

    /**
     * Everything the snapshot decides: the palette applied to the chrome, and
     * which empty-state line is true. Kept separate from the structural half
     * below because this is what a push repaints — see refresh().
     */
    private fun chromeViews(context: Context): RemoteViews {
      val snapshot = WidgetSnapshot.read(context)
      val views = RemoteViews(context.packageName, R.layout.widget_reminder_list)

      // A widget sits on the wallpaper, so it paints its own panel — and the
      // panel has to take the user's accent-derived surface color, which is
      // the whole point of shipping colors in the snapshot. Tinting a rounded
      // *background* is not possible below API 31, so the panel is an
      // ImageView holding a white rounded rect and ImageView.setColorFilter
      // (SRC_ATOP, so the rounded alpha survives) recolors it. Reflection
      // reaches setColorFilter(int) because it is @RemotableViewMethod — the
      // only methods RemoteViews will call. See setSnapshotColor for how the
      // value itself is chosen.
      views.setSnapshotColor(context, snapshot, R.id.widget_panel, "setColorFilter") { it.surface }
      views.setSnapshotColor(context, snapshot, R.id.widget_title, "setTextColor") { it.onSurface }
      views.setSnapshotColor(
        context,
        snapshot,
        R.id.widget_new_reminder,
        "setColorFilter",
      ) { it.primary }
      views.setSnapshotColor(
        context,
        snapshot,
        R.id.widget_refresh,
        "setColorFilter",
      ) { it.primary }
      views.setSnapshotColor(
        context,
        snapshot,
        R.id.widget_mic,
        "setColorFilter",
      ) { it.primary }

      // One empty view, two truths. "No reminders scheduled" would be a claim
      // about data that has never been read on an install whose widget was
      // placed before the app was first opened — a real state, since binding a
      // widget does not launch the app.
      views.setTextViewText(
        R.id.widget_empty,
        context.getString(
          if (snapshot == null) R.string.list_widget_never_opened else R.string.list_widget_empty
        ),
      )
      views.setSnapshotColor(context, snapshot, R.id.widget_empty, "setTextColor") { it.meta }
      return views
    }

    /**
     * The full painting: the chrome above plus everything that only an
     * APPWIDGET_UPDATE can establish — the collection's adapter, its empty
     * view and its click targets. partiallyUpdateAppWidget merges into what
     * this leaves behind, so a widget must receive one of these first.
     */
    private fun buildViews(context: Context, appWidgetId: Int): RemoteViews {
      val views = chromeViews(context)

      val adapter = Intent(context, ReminderListWidgetService::class.java)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
      // Same trap phase 4's preset buttons hit: Intent.filterEquals ignores
      // extras, so without a distinguishing data URI every placed instance
      // would share one RemoteViewsFactory and show the same list — which,
      // here, happens to be the right list, making this the kind of defect
      // that survives a screenshot. Encoding the whole intent is the
      // conventional way to guarantee uniqueness.
      adapter.data = Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME))
      @Suppress("DEPRECATION") // The RemoteCollectionItems replacement is API 31+.
      views.setRemoteAdapter(R.id.widget_list, adapter)
      views.setEmptyView(R.id.widget_list, R.id.widget_empty)

      // Children of a collection cannot carry their own PendingIntent; the
      // list gets a template and each row a fill-in intent, which the launcher
      // merges into it. Each row opens its own reminder (PLAN.md, phase 6), so
      // the data URI is the row's to supply — and Intent.fillIn will only fill
      // a field the template left unset, which is why the template below sets
      // action, component and flags but deliberately not data. Getting that
      // backwards is invisible: every row would quietly open the plain list,
      // which is exactly what phase 5 did.
      views.setPendingIntentTemplate(R.id.widget_list, rowTemplate(context))
      views.setOnClickPendingIntent(R.id.widget_title, openList(context))
      views.setOnClickPendingIntent(R.id.widget_empty, openList(context))
      views.setOnClickPendingIntent(R.id.widget_new_reminder, newReminder(context))
      views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context))
      views.setOnClickPendingIntent(R.id.widget_mic, voiceReminder(context))
      return views
    }

    /**
     * Opens the app on the Scheduled Reminders tab, for the header and the
     * empty state. `remindme://reminders` writes nothing and needs no replay
     * guard; the only query parameter either side reads is the rows' `id`
     * (PLAN.md, phase 6), and this one carries none.
     */
    private fun openList(context: Context): PendingIntent =
      PendingIntent.getActivity(
        context,
        REQUEST_OPEN_LIST,
        listIntent(context).setData(Uri.parse("remindme://reminders")),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    /**
     * The rows' shared template: everything except the data URI, which each
     * row fills in with its own `remindme://reminders?id=N` (see
     * ReminderListWidgetService). Intent.fillIn copies no flags, so
     * FLAG_ACTIVITY_NEW_TASK has to live here rather than on the row.
     *
     * MUTABLE by necessity — a template the launcher cannot merge into is a
     * template that ignores every fill-in. Android 14+ only rejects mutable
     * PendingIntents wrapping *implicit* intents; leaving the data unset does
     * not make this one implicit, since it still names its component, so the
     * rule phase 4's FLAG_IMMUTABLE note cites does not apply here either.
     */
    private fun rowTemplate(context: Context): PendingIntent =
      PendingIntent.getActivity(
        context,
        REQUEST_ROW_TEMPLATE,
        listIntent(context),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )

    private fun listIntent(context: Context): Intent =
      Intent(context, MainActivity::class.java)
        .setAction(Intent.ACTION_VIEW)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * A plain broadcast back to this same provider, handled by onReceive
     * above. No data URI or per-instance distinguishing is needed the way
     * phase 4's preset buttons required — every placed instance's button
     * doing the identical "refresh everything" action collapsing onto one
     * PendingIntent changes nothing observable, since refresh() (see above)
     * already repaints every instance regardless of which one was tapped.
     */
    private fun refreshIntent(context: Context): PendingIntent {
      val intent = Intent(context, ReminderListWidgetProvider::class.java)
        .setAction(ACTION_REFRESH)
      return PendingIntent.getBroadcast(
        context,
        REQUEST_REFRESH,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /**
     * The mic button, next to the "+": launches VoiceQuickCreateActivity —
     * not MainActivity, unlike every other PendingIntent here — so a tap
     * never visibly opens the app. See that class for the rest of the flow.
     */
    private fun voiceReminder(context: Context): PendingIntent {
      val intent = Intent(context, VoiceQuickCreateActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(
        context,
        REQUEST_VOICE_REMINDER,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** The phase-1 details-less deep link: open the New Reminder form. */
    private fun newReminder(context: Context): PendingIntent {
      val intent = Intent(context, MainActivity::class.java)
        .setAction(Intent.ACTION_VIEW)
        .setData(Uri.parse("remindme://create"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(
        context,
        REQUEST_NEW_REMINDER,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
