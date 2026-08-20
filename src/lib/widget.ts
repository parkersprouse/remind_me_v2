import { watch } from 'vue';

import { DB } from '~lib/db.ts';
import { formatEpoch } from '~lib/format.ts';
import { onRemindersChanged } from '~lib/notifications.ts';
import { describeRepeat, parseRepeat } from '~lib/repeat.ts';
import { widgetPalette } from '~lib/theme.ts';
import { useSettingsStore } from '~stores/settings.ts';

import type { WidgetPalette } from '~lib/theme.ts';
import type { ThemeMode } from '~stores/settings.ts';

/**
 * The home-screen reminder-list widget's data source (PLAN.md, phase 5).
 *
 * The widget is RemoteViews inflated by the launcher: no webview, no CSS, and
 * no way to read reminders.db without opening a second SQLite connection to a
 * WAL database tauri-plugin-sql owns. So Kotlin is never told about reminders
 * at all — the frontend pushes a denormalized snapshot of already-formatted
 * rows (plus both color schemes, see WidgetPalette) through the AndroidNative
 * bridge, and the widget renders purely from that.
 *
 * The point of the design is that formatEpoch/describeRepeat stay in one
 * language. The property that makes it clearly right rather than merely
 * cheaper is where the snapshot lives: SharedPreferences, so it survives
 * reboot and app update and the widget renders correctly on a device that has
 * not opened the app in weeks.
 *
 * Staleness is the accepted cost, and it has exactly one shape: only the
 * frontend ever writes the snapshot, so anything that changes reminders while
 * the app is closed leaves it stale until the next open.
 *
 * - A fired one-shot is handled at render time — the widget drops rows whose
 *   `fireAt` has passed (see ReminderListWidgetService.kt).
 * - A repeating reminder shows its rule rather than a timestamp, exactly as
 *   ReminderListEntry.vue does, so a fired occurrence does not make the row
 *   wrong. This is why the "chained repeat displays a stale next-time" case
 *   PLAN.md worried about mostly evaporates.
 * - A background snooze (SnoozeActionReceiver) or a headless create
 *   (CreateReminderReceiver) is stale until next open, deliberately. Those
 *   receivers cannot refresh the snapshot themselves: they hold raw
 *   details/fireAt and cannot produce a formatted row without reading
 *   settings.json from Kotlin, which is the second cross-language read this
 *   whole design exists to avoid.
 */

/**
 * Snapshot shape, mirrored by WidgetSnapshot.kt. Bumped only for a change
 * Kotlin cannot read defensively; it is stamped on every push so a snapshot
 * written by the previous build — SharedPreferences survives an app update —
 * is identifiable rather than silently misread.
 */
const SNAPSHOT_VERSION = 1;

/**
 * Rows past this are dropped. Nothing scrolls that far on a home screen, and
 * the snapshot is a single SharedPreferences string.
 */
const MAX_ROWS = 100;

interface SnapshotRow {
  details: string;
  /** The line under the details: a timestamp, or the repeat rule. */
  meta: string;
  /** Only meaningful for one-shots; what the widget's render-time filter reads. */
  fireAt: number;
  repeating: boolean;
}

interface Snapshot {
  version: number;
  /** The app's own light/dark/system setting; 'system' is resolved by the widget. */
  theme: ThemeMode;
  light: WidgetPalette;
  dark: WidgetPalette;
  items: SnapshotRow[];
}

/** Rebuild the snapshot and hand it to the widget. */
export async function pushWidgetSnapshot(): Promise<void> {
  const bridge = window.AndroidNative;
  if (bridge === undefined) return;

  const settings = useSettingsStore();
  const reminders = await DB.getAll();
  const items = reminders.slice(0, MAX_ROWS).map((reminder): SnapshotRow => {
    const spec = parseRepeat(reminder.repeat);
    return {
      details: reminder.details,
      // Same split as ReminderListEntry.vue: a repeating reminder shows its
      // rule, since its stored one-shot date goes stale the moment it fires.
      meta: spec === null ? formatEpoch(reminder.scheduledForEpochMillis) : describeRepeat(spec),
      fireAt: reminder.scheduledForEpochMillis,
      repeating: spec !== null,
    };
  });

  const snapshot: Snapshot = {
    version: SNAPSHOT_VERSION,
    theme: settings.theme,
    light: widgetPalette(settings.accentColor, 'light'),
    dark: widgetPalette(settings.accentColor, 'dark'),
    items,
  };
  bridge.setWidgetSnapshot(JSON.stringify(snapshot));
}

/**
 * Push now, and on every reminder mutation and palette change afterwards.
 * Needs an active Pinia and a loaded settings store, so it runs at the end of
 * main.ts's async init.
 */
export function initWidgetSnapshot(): void {
  onRemindersChanged(() => void pushWidgetSnapshot());

  // The palette is baked into the snapshot, so a re-seed or a theme switch
  // has to re-push it — nothing else would, since no reminder changed.
  //
  // systemPrefersDark is watched even though it changes nothing in the
  // snapshot: with theme 'system' the widget picks its scheme from the
  // launcher's configuration, and a push is the only thing that makes it look
  // again. Android delivers no configuration-change broadcast a manifest
  // receiver can subscribe to, so a night flip that happens while the app is
  // not running leaves the widget in the previous scheme until it next runs —
  // the same "only the frontend writes the snapshot" staleness as everything
  // above.
  const settings = useSettingsStore();
  watch(
    () => [settings.theme, settings.accentColor, settings.systemPrefersDark],
    () => void pushWidgetSnapshot(),
  );

  void pushWidgetSnapshot();
}
