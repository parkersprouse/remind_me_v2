package software.greysky.remindme

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Backs the reminder-list widget's ListView (PLAN.md, phase 5).
 *
 * This is the pre-API-31 collection-widget plumbing:
 * RemoteViews.RemoteCollectionItems would replace the whole file, but it is
 * API 31+ and minSdk here is 26. One code path beats a version branch for a
 * list this small.
 *
 * Declared in the manifest with android:permission="BIND_REMOTEVIEWS" so only
 * the system's AppWidgetService can bind it.
 */
class ReminderListWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    ReminderListFactory(applicationContext)
}

private class ReminderListFactory(private val context: Context) :
  RemoteViewsService.RemoteViewsFactory {

  private var rows: List<WidgetSnapshot.Row> = emptyList()
  private var snapshot: WidgetSnapshot.Snapshot? = null

  override fun onCreate() {
    // Deliberately empty: onDataSetChanged runs before the first getCount,
    // including on the initial bind, and reading here as well would only add a
    // way for the two to disagree.
  }

  /**
   * Re-read the snapshot. This — not the constructor — is where the data
   * comes from: a factory is created once and reused for the life of the
   * binding, so a constructor read renders the list correctly exactly once and
   * never updates again.
   *
   * Runs on a binder thread, so the snapshot is copied into these fields and
   * getCount/getViewAt serve only the copy; re-reading per row could let the
   * count and the content disagree mid-render.
   */
  override fun onDataSetChanged() {
    val current = WidgetSnapshot.read(context)
    snapshot = current
    val now = System.currentTimeMillis()
    // Only the frontend writes the snapshot, so a one-shot that fired while
    // the app was closed is still in it. Dropping it here costs nothing and
    // is the one staleness case with a free fix.
    //
    // Note this diverges from the app on purpose: cleanExpired() keeps a fired
    // reminder's row while its notification is still in the drawer, because
    // the row is what its snooze buttons need. A glance surface has no such
    // duty — it should show what is still coming.
    //
    // A repeating reminder never expires this way: its meta line is the repeat
    // rule, not a timestamp (same split as ReminderListEntry.vue), so a fired
    // occurrence leaves the row correct.
    rows = current?.rows.orEmpty().filter { it.repeating || it.fireAt > now }
  }

  override fun onDestroy() {
    rows = emptyList()
  }

  override fun getCount(): Int = rows.size

  override fun getViewAt(position: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_reminder_row)
    // getViewAt can race a notifyAppWidgetViewDataChanged; the framework
    // tolerates a placeholder, and an out-of-range index must not throw across
    // the binder.
    val row = rows.getOrNull(position) ?: return views

    val current = snapshot
    views.setTextViewText(R.id.widget_row_details, row.details)
    views.setSnapshotColor(context, current, R.id.widget_row_details, "setTextColor") {
      it.onSurface
    }
    views.setTextViewText(R.id.widget_row_meta, row.meta)
    // Pushed as #AARRGGBB: the meta line is drawn at 0.66 alpha over the
    // panel, exactly as ReminderListEntry.vue draws it. Alpha works here
    // because setTextColor blends; it would not survive a color filter, which
    // is why the divider color below is pushed opaque instead.
    views.setSnapshotColor(context, current, R.id.widget_row_meta, "setTextColor") { it.meta }
    views.setSnapshotColor(context, current, R.id.widget_row_divider, "setColorFilter") {
      it.divider
    }

    // Rows all open the same place, so the fill-in intent is empty and the
    // template (set by the provider) carries everything. It still has to be
    // set: without a fill-in intent the template never fires.
    views.setOnClickFillInIntent(R.id.widget_row, Intent())
    return views
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount(): Int = 1

  override fun getItemId(position: Int): Long = position.toLong()

  /**
   * False, honestly: rows are identified by position here (the snapshot
   * carries no reminder ids — nothing in the widget needs one, since every row
   * opens the same screen), so an id is only stable until the list changes.
   */
  override fun hasStableIds(): Boolean = false
}
