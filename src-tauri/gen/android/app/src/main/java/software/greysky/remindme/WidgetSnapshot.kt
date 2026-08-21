package software.greysky.remindme

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.util.Log
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "WidgetSnapshot"

/**
 * The reminder-list widget's entire view of the world (PLAN.md, phase 5):
 * already-formatted rows plus both color schemes, pushed by the frontend
 * through the AndroidNative bridge whenever reminders or the palette change.
 *
 * Kotlin deliberately never reads reminders.db — the same rule the
 * pending-ops journal follows, for the same reasons. Here it also keeps
 * formatEpoch/describeRepeat (and the repeat rules behind them) from being
 * ported into a second language where they would drift, and avoids opening a
 * second SQLite connection against a WAL database tauri-plugin-sql owns.
 *
 * Held in SharedPreferences, so it survives reboot and app update: the widget
 * renders real reminders on a device that has not opened the app in weeks,
 * which is the property that makes the snapshot the right design rather than
 * merely the cheaper one. What it costs is staleness whenever something
 * changes reminders while the app is closed — see src/lib/widget.ts for the
 * three cases and which of them are handled where.
 *
 * Parsed with org.json rather than Jackson on purpose. Reflected model classes
 * are exactly what R8 stripped out of the notification plugin twice (see
 * CLAUDE.md); a hand-parsed JSONObject has nothing to strip.
 */
object WidgetSnapshot {
  private const val STORE = "WIDGET_SNAPSHOT"
  private const val SNAPSHOT_KEY = "snapshot"

  /** Highest snapshot version this build understands (mirrors src/lib/widget.ts). */
  private const val SUPPORTED_VERSION = 1

  /** Receivers, the RemoteViewsFactory's binder thread and the bridge all touch this. */
  private val lock = Any()

  /** Colors for one scheme; mirrors WidgetPalette in src/lib/theme.ts. */
  data class Palette(
    val surface: Int,
    val onSurface: Int,
    val meta: Int,
    val primary: Int,
    val divider: Int,
  )

  /** One reminder, formatted by the frontend. */
  data class Row(
    /**
     * The reminder's own id, so the row can deep-link to *its* details dialog
     * (PLAN.md, phase 6). 0 when the snapshot predates phase 6 — prefs survive
     * an app update — and the row then falls back to opening the plain list,
     * which is the same miss path an id that no longer exists takes.
     */
    val id: Long,
    val details: String,
    /** Timestamp for a one-shot, repeat rule for a repeating reminder. */
    val meta: String,
    val fireAt: Long,
    val repeating: Boolean,
  )

  data class Snapshot(
    /** The app's own theme setting: "light", "dark" or "system". */
    val theme: String,
    val light: Palette,
    val dark: Palette,
    val rows: List<Row>,
  ) {
    /**
     * A 'system' setting is resolved against the *launcher's* configuration
     * rather than being baked in at push time: that is the only reading that
     * stays right while the app is closed, and it is why the snapshot carries
     * both schemes instead of one resolved palette.
     */
    fun paletteFor(context: Context): Palette =
      when (theme) {
        "light" -> light
        "dark" -> dark
        else -> if (isNightMode(context)) dark else light
      }
  }

  /**
   * Store the pushed snapshot and repaint the widget from it.
   *
   * Runs on the WebView's @JavascriptInterface thread — fine for both halves:
   * the write is a SharedPreferences commit and the repaint a binder call.
   * commit() rather than apply() so the repaint, which reads the store back,
   * cannot see the previous snapshot.
   */
  fun set(context: Context, json: String) {
    synchronized(lock) {
      context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        .edit()
        .putString(SNAPSHOT_KEY, json)
        .commit()
    }
    ReminderListWidgetProvider.refresh(context)
  }

  /**
   * Null when the app has never pushed one — a fresh install whose widget was
   * placed before the app was first opened, which is a real state (binding a
   * widget does not launch the app). The widget says so rather than claiming
   * there are no reminders; see the two empty-state strings.
   */
  fun read(context: Context): Snapshot? {
    val raw = synchronized(lock) {
      context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString(SNAPSHOT_KEY, null)
    } ?: return null

    return try {
      val root = JSONObject(raw)
      // Written by a newer build than this one: prefs survive an app update,
      // but a downgrade would leave a shape this parser can only guess at.
      // Rendering nothing (and saying "open the app") beats rendering wrong.
      val version = root.optInt("version", 0)
      if (version > SUPPORTED_VERSION) {
        Log.w(TAG, "ignoring snapshot version $version (this build reads $SUPPORTED_VERSION)")
        return null
      }
      Snapshot(
        theme = root.optString("theme", "system"),
        light = palette(root.optJSONObject("light"), fallbackPalette(context, night = false)),
        dark = palette(root.optJSONObject("dark"), fallbackPalette(context, night = true)),
        rows = rows(root.optJSONArray("items")),
      )
    } catch (e: Exception) {
      Log.w(TAG, "unparseable snapshot", e)
      null
    }
  }

  /**
   * Static colors for a widget with no snapshot to read. These are phase 4's
   * quick-create palette (res/values/colors.xml plus its values-night
   * variant), which follows the system light/dark setting — the best that can
   * be done before the app has ever told anyone what accent the user picked.
   *
   * `night` is passed explicitly rather than read from the configuration
   * because this also fills the *unparseable half* of an otherwise valid
   * snapshot, where each scheme needs its own fallback.
   */
  fun fallbackPalette(context: Context, night: Boolean = isNightMode(context)): Palette {
    // The values-night variant is selected by the configuration, so a fallback
    // for the scheme that is not currently active has to be built by hand.
    val surface = if (night) 0xFF1B1B1F.toInt() else 0xFFFFFFFF.toInt()
    val onSurface = if (night) 0xFFE3E2E6.toInt() else 0xFF1B1B1F.toInt()
    val divider = if (night) 0xFF44474E.toInt() else 0xFFC4C6CF.toInt()
    return Palette(
      surface = surface,
      onSurface = onSurface,
      // 0xA8 = the 0.66 alpha ReminderListEntry.vue draws its meta line at.
      meta = (onSurface and 0x00FFFFFF) or 0xA8000000.toInt(),
      primary = ContextCompat.getColor(context, R.color.ic_launcher_background),
      divider = divider,
    )
  }

  /** Also read by setSnapshotColor's pre-API-31 fallback below. */
  fun isNightMode(context: Context): Boolean =
    context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
      Configuration.UI_MODE_NIGHT_YES

  private fun palette(obj: JSONObject?, fallback: Palette): Palette {
    if (obj == null) return fallback
    return Palette(
      surface = color(obj.optString("surface"), fallback.surface),
      onSurface = color(obj.optString("onSurface"), fallback.onSurface),
      meta = color(obj.optString("meta"), fallback.meta),
      primary = color(obj.optString("primary"), fallback.primary),
      divider = color(obj.optString("divider"), fallback.divider),
    )
  }

  /** Accepts "#RRGGBB" and "#AARRGGBB"; the meta line is pushed with alpha. */
  private fun color(hex: String?, fallback: Int): Int {
    if (hex.isNullOrEmpty()) return fallback
    return try {
      Color.parseColor(hex)
    } catch (_: IllegalArgumentException) {
      fallback
    }
  }

  private fun rows(items: JSONArray?): List<Row> {
    if (items == null) return emptyList()
    val rows = ArrayList<Row>(items.length())
    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val details = item.optString("details")
      if (details.isEmpty()) continue
      rows.add(
        Row(
          id = item.optLong("id"),
          details = details,
          meta = item.optString("meta"),
          fireAt = item.optLong("fireAt"),
          repeating = item.optBoolean("repeating"),
        )
      )
    }
    return rows
  }
}

/**
 * Apply one snapshot colour to a view, letting the launcher resolve light vs
 * dark wherever it can.
 *
 * This is the seam where the widget's theming actually works. A colour pushed
 * in the snapshot is a plain int, so — unlike a `@color` reference with a
 * values-night variant — it does not follow the system night setting when the
 * host re-inflates. Nothing would fix it either: Android delivers no
 * configuration-change broadcast a manifest receiver can subscribe to, so with
 * the app closed there is no moment at which anything could repaint.
 *
 * RemoteViews.setColorInt exists for exactly this: it carries *both* values
 * and the host picks by the view's own configuration, every time it applies.
 * It is API 31+, so below that a 'system' theme resolves once, here, and the
 * widget keeps that scheme until the next push (see the systemPrefersDark
 * watcher in src/lib/widget.ts). An explicit light/dark setting needs none of
 * this — it is one colour by definition, and it is why the widget can follow
 * the app's theme rather than the launcher's.
 */
fun RemoteViews.setSnapshotColor(
  context: Context,
  snapshot: WidgetSnapshot.Snapshot?,
  viewId: Int,
  method: String,
  pick: (WidgetSnapshot.Palette) -> Int,
) {
  // An explicit setting is one colour whatever the launcher thinks.
  when (snapshot?.theme) {
    "light" -> {
      setInt(viewId, method, pick(snapshot.light))
      return
    }
    "dark" -> {
      setInt(viewId, method, pick(snapshot.dark))
      return
    }
  }

  val light = pick(snapshot?.light ?: WidgetSnapshot.fallbackPalette(context, night = false))
  val dark = pick(snapshot?.dark ?: WidgetSnapshot.fallbackPalette(context, night = true))
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    setColorInt(viewId, method, light, dark)
  } else {
    setInt(viewId, method, if (WidgetSnapshot.isNightMode(context)) dark else light)
  }
}
