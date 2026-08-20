package software.greysky.remindme

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Request codes for this widget's PendingIntents. They matter for more than
 * tidiness: a PendingIntent's identity is (package, request code, type,
 * Intent.filterEquals) — mutability is *not* part of it — so the row template
 * and the "open the list" tap, which wrap the same intent, would otherwise
 * collapse onto one PendingIntent and whichever was created first would
 * decide whether it is mutable. An immutable template silently breaks every
 * row tap.
 */
private const val REQUEST_ROW_TEMPLATE = 5001
private const val REQUEST_OPEN_LIST = 5002
private const val REQUEST_NEW_REMINDER = 5003

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

  companion object {
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
      // list gets a template and each row a fill-in intent. Every row opens
      // the same place, so the template carries the whole intent and the
      // fill-in is empty — which also sidesteps Intent.fillIn's rule that a
      // field already set on the template wins.
      views.setPendingIntentTemplate(R.id.widget_list, openList(context, REQUEST_ROW_TEMPLATE))
      views.setOnClickPendingIntent(R.id.widget_title, openList(context, REQUEST_OPEN_LIST))
      views.setOnClickPendingIntent(R.id.widget_empty, openList(context, REQUEST_OPEN_LIST))
      views.setOnClickPendingIntent(R.id.widget_new_reminder, newReminder(context))
      return views
    }

    /**
     * Opens the app on the Scheduled Reminders tab. `remindme://reminders` is
     * navigate-only on both sides — MainActivity.kt does not read this host's
     * query string at all — so it creates nothing and needs no replay guard.
     */
    private fun openList(context: Context, requestCode: Int): PendingIntent {
      val intent = Intent(context, MainActivity::class.java)
        .setAction(Intent.ACTION_VIEW)
        .setData(Uri.parse("remindme://reminders"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      // The row template must be MUTABLE — the launcher merges each row's
      // fill-in intent into it — which is why it also needs its own request
      // code (see above). Android 14+ only rejects mutable PendingIntents
      // wrapping *implicit* intents, and this one names its component, so the
      // rule phase 4's FLAG_IMMUTABLE note cites does not apply here.
      val mutability =
        if (requestCode == REQUEST_ROW_TEMPLATE) PendingIntent.FLAG_MUTABLE
        else PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or mutability,
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
