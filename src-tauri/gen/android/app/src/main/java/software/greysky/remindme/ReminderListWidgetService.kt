package software.greysky.remindme

import android.content.Context
import android.content.Intent
import android.net.Uri
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

    // A collection's children cannot carry their own PendingIntent, so the
    // row supplies only what distinguishes it — its data URI — and the
    // launcher merges that into the provider's template, which holds action,
    // component and flags. This works precisely because that template leaves
    // the data unset: Intent.fillIn refuses to overwrite a field the template
    // already filled (PLAN.md, phase 6).
    //
    // Falling back to the plain list for an id-less row is the same miss path
    // an id that no longer exists takes; it happens only while a snapshot
    // written before phase 6 is still in prefs.
    val uri =
      if (row.id > 0) "remindme://reminders?id=${row.id}" else "remindme://reminders"
    views.setOnClickFillInIntent(R.id.widget_row, Intent().setData(Uri.parse(uri)))
    return views
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount(): Int = 1

  /**
   * The reminder's own id since phase 6. A snapshot written before it carries
   * none, and every such row would report 0 — duplicate ids with stable ids
   * enabled is how a list recycles the wrong view — so those fall back to a
   * position-derived id, negated so it can never collide with a real one.
   */
  override fun getItemId(position: Int): Long =
    rows.getOrNull(position)?.id?.takeIf { it > 0 } ?: -(position + 1L)

  /** True now that rows carry reminder ids; only affects list-update behaviour. */
  override fun hasStableIds(): Boolean = true
}
