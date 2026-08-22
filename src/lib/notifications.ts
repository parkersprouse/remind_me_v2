import { invoke } from '@tauri-apps/api/core';
import {
  requestPermission,
  registerActionTypes,
  onNotificationReceived,
  cancel as cancelPending,
  createChannel,
  Importance,
  Visibility,
  Schedule,
} from '@tauri-apps/plugin-notification';
import { ref, watch } from 'vue';


import { DB } from '~lib/db.ts';
import { parseDurationString } from '~lib/duration.ts';
import {
  isChained,
  nextOccurrence,
  parseRepeat,
  serializeRepeat,
  toSchedule,
  withAnchor,

} from '~lib/repeat.ts';
import { useSettingsStore } from '~stores/settings.ts';

import type { Reminder } from '~lib/db.ts';
import type { RepeatSpec } from '~lib/repeat.ts';

/**
 * Mirrors NotificationManager from the Flutter app.
 *
 * Reminders are scheduled through the Android OS notification system (with
 * snooze action buttons) exactly like flutter_local_notifications did, so they
 * fire whether or not the app is running.
 */

const MAX_INT = 0x7F_FF_FF_FF;
const SNOOZE_PREFIX = 'snooze_';
const CUSTOM_SNOOZE_ACTION_ID = 'snooze_custom';
const ACTION_TYPE_ID = 'reminder_actions';
const NOTIFICATION_TITLE = "Don't Forget!";
// The plugin's built-in "default" channel is IMPORTANCE_DEFAULT, which relegates
// notifications to the drawer. Reminders need a high-importance channel to pop
// on-screen (heads-up). Channel importance is frozen by the OS at creation, so a
// rename of this id is the only way to change it later.
const CHANNEL_ID = 'reminders_high';

/**
 * Details of fired one-shots removed by cleanExpired, kept so a snooze action
 * tapped on a notification whose DB row was already swept (the sweep and the
 * tap race at launch — the plugin dismisses the notification before the JS
 * side even boots) can still re-schedule the reminder.
 */
const recently_expired = new Map<number, string>();

/**
 * Set when the "Custom…" snooze action is tapped on a delivered notification;
 * App.vue watches this and presents the custom snooze dialog.
 */
export const custom_snooze_request = ref<{
  id: number;
  details: string;
} | null>(null);

declare global {
  interface Window {
    /**
     * Bridge target for MainActivity.kt (see there for why the notification
     * plugin's own actionPerformed event cannot be used on Android). Returns
     * true so the Kotlin side knows the frontend accepted delivery and can
     * stop retrying.
     */
    androidNotificationAction?: (id: number, actionId: string) => boolean;
    /**
     * Bridge target for MainActivity.kt's PENDING_OPS_UPDATED receiver: a
     * receiver just journalled a background snooze or a headless create, so
     * pick it up right away instead of waiting for the next resume.
     */
    androidPendingOps?: () => void;
  }
}

/** A background snooze recorded by SnoozeActionReceiver.kt. */
interface SnoozeOp {
  /**
   * Absent on entries written before headless creates existed — the journal
   * lives in SharedPreferences, which survives an app update, so an untyped
   * entry can still turn up on the first run of a new build.
   */
  type?: 'snooze';
  /** Reminder whose notification carried the tapped button. */
  sourceId: number;
  /** Id the receiver armed the snoozed copy under. */
  newId: number;
  fireAt: number;
  details: string;
}

/** A reminder armed from a broadcast by CreateReminderReceiver.kt. */
interface CreateOp {
  type: 'create';
  /** Id the receiver armed it under; the row must match so a re-drain is a no-op. */
  id: number;
  fireAt: number;
  details: string;
}

/** One piece of reminders.db bookkeeping a receiver could not do itself. */
type PendingOp = CreateOp | SnoozeOp;

/**
 * Route a notification action tap (from the MainActivity bridge) to snooze.
 *
 * Only "Custom…" reaches this now — preset buttons are registered with
 * `foreground: false` and are handled natively without opening the app (see
 * registerSnoozeActions). The preset branch stays as a fallback for
 * notifications armed by an older build that are still sitting in the drawer
 * across an app update, since their PendingIntents still target the Activity.
 */
async function handleNotificationAction(id: number, actionId: string): Promise<void> {
  if (!actionId.startsWith(SNOOZE_PREFIX)) return; // plain body taps just open the app

  if (actionId === CUSTOM_SNOOZE_ACTION_ID) {
    const details = (await DB.getById(id))?.details ?? recently_expired.get(id) ?? '';
    custom_snooze_request.value = {
      id,
      details,
    };
    return;
  }

  const [hours, minutes] = parseDurationString(actionId.slice(SNOOZE_PREFIX.length));
  await notification_manager.snooze(id, hours * 60 + minutes);
}

type ChangeListener = () => void;
const change_listeners = new Set<ChangeListener>();

/** Subscribe to reminder mutations (fired, snoozed, cancelled). */
export function onRemindersChanged(listener: ChangeListener): () => void {
  change_listeners.add(listener);
  return () => change_listeners.delete(listener);
}

function emitChange(): void {
  for (const listener of change_listeners) listener();
}

/**
 * Whether a reminder should still appear in a "what's coming" list — used by
 * both the in-app list and the widget snapshot builder.
 *
 * cleanExpired() deliberately keeps a fired one-shot's DB row while its
 * notification is still undismissed (the row is what its snooze buttons need
 * to re-arm), but that is a retention concern, not a display one: a row whose
 * time has already passed reads as broken sitting in a list of "upcoming"
 * reminders regardless of whether the drawer notification is still up. So
 * this filters on time alone, independent of drawer state — a fired one-shot
 * drops out of both lists the moment it fires, and reappears if snoozed
 * (which mints a fresh row with a future time).
 *
 * A repeating reminder is exempt: its stored time is only its last-armed
 * occurrence and goes stale the instant it fires (same split as
 * ReminderListEntry.vue's meta line), not a sign it's done.
 */
export function isPendingDisplay(reminder: Pick<Reminder, 'repeat' | 'scheduledForEpochMillis'>, now = Date.now()): boolean {
  return reminder.repeat !== null || reminder.scheduledForEpochMillis > now;
}

export const permissions = {
  async status(): Promise<boolean> {
    // Deliberately NOT the plugin's isPermissionGranted() wrapper: it
    // short-circuits on the webview's cached window.Notification.permission,
    // which freezes at 'denied' once requestPermission() is rejected and never
    // re-syncs when the user later enables notifications in system settings
    // (only a process restart re-reads it). Querying the native command
    // directly returns the live OS permission, so returning from settings
    // reflects reality and the landing gate opens. null = "not yet determined".
    return (await invoke<boolean | null>('plugin:notification|is_permission_granted')) === true;
  },

  /** Returns true when granted. */
  async request(): Promise<boolean> {
    return (await requestPermission()) === 'granted';
  },
};

export const notification_manager = {
  async init(): Promise<void> {
    await createChannel({
      id: CHANNEL_ID,
      name: 'Reminders',
      description: 'Scheduled reminder alerts',
      importance: Importance.High,
      visibility: Visibility.Public,
      vibration: true,
      lights: true,
    });

    // Notification action taps (snooze buttons) arrive via the
    // MainActivity.kt bridge, NOT the plugin's onAction event: that event
    // is dropped on cold starts (it fires before any JS listener exists and
    // the plugin does not buffer) and its payload never carries the
    // notification id (sourceJson is never populated in plugin 2.3.3), so
    // it cannot identify which reminder was acted on. Deliberately no
    // onAction listener here — if a fixed plugin ever delivers the event,
    // it would double-fire alongside the bridge.
    window.androidNotificationAction = (id, actionId) => {
      void handleNotificationAction(id, actionId);
      return true;
    };

    window.androidPendingOps = (): void => {
      void notification_manager.drainPendingOps();
    };

    // Also mirrors the resolved action group to the native side, so a reminder
    // armed by CreateReminderReceiver gets the same snooze buttons as one armed
    // in-app. arm() refreshes it on every schedule; this covers an install
    // where nothing has been scheduled yet.
    await registerSnoozeActions();

    // An in-app notification always gets a fresh registration (arm() re-runs
    // this immediately before every notify), but a headless create can land at
    // any moment and reads what was registered last. Without this watcher,
    // turning snooze off would leave the buttons on a broadcast-created
    // reminder until the next in-app schedule or app restart.
    const settings = useSettingsStore();
    watch(
      () => [settings.showNotifSnooze, settings.notifSnoozeCustomButton, settings.notifSnoozeOptions],
      () => {
        void registerSnoozeActions();
      },
      { deep: true },
    );

    // Keep repeating reminders rolling: when one is delivered while the app
    // is alive, advance its stored next-occurrence (and re-arm it if the
    // rule is chained — the OS handles the native ones itself). NOTE:
    // empirically this event never fires on Android with plugin 2.3.3, so
    // the cleanExpired() sweep below is the mechanism that actually
    // advances repeats; this listener is kept as a free upgrade if the
    // plugin fixes delivery events.
    await onNotificationReceived((notification) => {
      const id = notification.id;
      if (typeof id !== 'number') return;
      void advanceRepeat(id);
    });
  },

  async schedule(
    dateTime: Date,
    details: string,
    zone?: string,
    repeat?: RepeatSpec | null,
  ): Promise<void> {
    const id = randomId();
    const spec = repeat ? withAnchor(repeat, new Date()) : null;
    const fire_at = spec ? nextOccurrence(spec, new Date()) : dateTime;

    // All-or-nothing: insert the row first, arm the notification second, and
    // roll the row back if arming fails — either both survive or neither does.
    await DB.insert(id, details, fire_at.getTime(), zone, spec ? serializeRepeat(spec) : null);

    try {
      await arm(id, fire_at, details, spec);
    } catch (err) {
      await DB.remove(id);
      throw err;
    }

    emitChange();
  },

  /**
   * Re-schedule an existing reminder in place, keeping its id: cancel the
   * pending OS notification (or desktop timer), overwrite the row
   * (DB.insert is INSERT OR REPLACE), and arm the replacement. Deliberately
   * not routed through cancel() — that removes the row — or snooze(), which
   * mints a fresh id.
   */
  async update(
    id: number,
    dateTime: Date,
    details: string,
    zone?: string,
    repeat?: RepeatSpec | null,
  ): Promise<void> {
    try {
      await cancelPending([id]);
    } catch {
      // Already delivered or unknown — nothing to cancel.
    }

    const spec = repeat ? withAnchor(repeat, new Date()) : null;
    const fire_at = spec ? nextOccurrence(spec, new Date()) : dateTime;

    await DB.insert(id, details, fire_at.getTime(), zone, spec ? serializeRepeat(spec) : null);
    await arm(id, fire_at, details, spec);
    emitChange();
  },

  async snooze(id: number, minutes: number): Promise<void> {
    const reminder = await DB.getById(id);
    // Row already swept (the reminder fired and cleanExpired got there
    // first)? The launch-time sweep remembers what it deleted.
    const details = reminder?.details ?? recently_expired.get(id);
    if (details === undefined) return;
    // A one-shot moves; a repeating reminder keeps its rule and spawns a
    // one-shot copy instead (cancelling it would kill the recurrence).
    if (reminder !== null && reminder.repeat === null) await notification_manager.cancel(id);
    const date_time = new Date(Date.now() + minutes * 60000);
    await notification_manager.schedule(date_time, details, reminder?.timezone);
  },

  async cancel(id: number): Promise<void> {
    try {
      await cancelPending([id]);
    } catch {
      // Already delivered or unknown — nothing to cancel.
    }
    await DB.remove(id);
    emitChange();
  },

  /**
   * Apply the reminder bookkeeping the receivers performed while the frontend
   * was not running (app closed, or backgrounded with no webview work
   * possible): a background snooze (SnoozeActionReceiver.kt) or a headless
   * create (CreateReminderReceiver.kt).
   *
   * The OS alarm is already armed by the time an entry lands in the journal —
   * that half has to happen natively, since the reminder must fire even if the
   * app is never opened again. This is the other half: bringing reminders.db in
   * line, using exactly the rules the equivalent in-app operation applies, so
   * the two leave identical state behind.
   */
  async drainPendingOps(): Promise<void> {
    const raw = window.AndroidNative?.takePendingOps();
    if (raw === undefined || raw === '') return;

    let entries: PendingOp[];
    try {
      entries = JSON.parse(raw) as PendingOp[];
    } catch {
      return; // Corrupt journal: the alarms are armed regardless.
    }
    if (entries.length === 0) return;

    // Sequential, in write order: snoozing a snoozed reminder makes the next
    // entry's source the previous entry's copy.
    for (const entry of entries) {
      if (entry.type === 'create') {
        // Headless creates are one-shots by contract (no repeat rule can reach
        // the receiver), and the row is keyed on the id it armed. No timezone
        // travels with a broadcast, so DB.insert falls back to the current one.
        await DB.insert(entry.id, entry.details, entry.fireAt);
        continue;
      }
      const source = await DB.getById(entry.sourceId);
      // A one-shot is replaced by its snoozed copy; a repeating reminder keeps
      // its rule and the copy just joins it (cancelling would kill the
      // recurrence) — same split as snooze().
      if (source !== null && source.repeat === null) await DB.remove(entry.sourceId);
      // Keyed on the id the receiver actually armed, so the row and the alarm
      // agree and a re-run of a partially applied drain is a no-op.
      await DB.insert(entry.newId, entry.details, entry.fireAt, source?.timezone);
    }

    emitChange();
  },

  /**
   * Drop one-shot reminders whose scheduled time has already passed, and
   * advance repeating ones past any fired occurrence. Runs at launch and on
   * every list refresh — for chained repeat rules this sweep is what arms
   * the next occurrence (the OS only had a one-shot alarm for the last one).
   */
  async cleanExpired(): Promise<void> {
    const expired = await DB.getExpired(Date.now());
    // Mobile: a fired one-shot still sitting in the notification drawer is
    // still actionable (its snooze buttons need the row), so it survives the
    // sweep until the notification is tapped or dismissed.
    const undismissed = await activeNotificationIds();
    for (const reminder of expired) {
      if (undismissed.has(reminder.id)) continue;
      recently_expired.set(reminder.id, reminder.details);
      await notification_manager.cancel(reminder.id);
    }
    await rearmRepeats();
    // cancel() above already emits per removed row, but an undismissed fired
    // one-shot removes nothing here — it stays in the DB until the drawer
    // notification clears. The widget still needs to stop showing it as
    // upcoming the moment it fires (its own render-time filter just needs a
    // push to re-run against), so emit unconditionally rather than only when
    // a row was actually deleted.
    emitChange();
  },
};

/** Arm the platform notification for a reminder already persisted in the DB. */
async function arm(
  id: number,
  dateTime: Date,
  details: string,
  repeat: RepeatSpec | null = null,
): Promise<void> {
  // One-shots (and chained repeats, whose toSchedule() also yields a
  // one-shot Schedule.at) use an exact alarm; native repeats map to the
  // plugin's interval/every schedules.
  const schedule =
    repeat === null ?
      Schedule.at(dateTime, false, true) : // allowWhileIdle so the alarm fires even in Doze
      toSchedule(repeat, new Date()).schedule;

  // Invoked directly rather than through sendNotification(): the
  // window.Notification shim it wraps is fire-and-forget, so backend
  // failures would be silently swallowed.
  await invoke('plugin:notification|notify', {
    options: {
      id,
      channelId: CHANNEL_ID,
      title: NOTIFICATION_TITLE,
      body: details,
      largeBody: details,
      // Monochrome status-bar icon (res/drawable-anydpi/ic_stat_logo.xml). Android
      // renders a notification's small icon from its alpha alone, so without a
      // dedicated glyph the plugin falls back to the full launcher icon and it
      // shows as a featureless white square. Mirrors the Flutter app's ic_stat_logo.
      icon: 'ic_stat_logo',
      schedule,
      actionTypeId: (await registerSnoozeActions()) ?? undefined,
    },
  });
}

/**
 * Advance a repeating reminder past a delivery: store the next occurrence
 * (so the list stays fresh) and, for chained rules the OS won't re-fire on
 * its own, arm the next one-shot.
 */
async function advanceRepeat(id: number): Promise<void> {
  const row = await DB.getById(id);
  const spec = row ? parseRepeat(row.repeat) : null;
  if (row === null || spec === null) return;

  const next = nextOccurrence(spec, new Date());
  await DB.insert(id, row.details, next.getTime(), row.timezone, row.repeat);
  if (isChained(spec)) await arm(id, next, row.details, spec);
  emitChange();
}

/**
 * Launch-time sweep for repeating reminders whose stored occurrence is in
 * the past (fired while the app was dead): refresh the stored epoch, and
 * re-arm chained rules — their next one-shot was never scheduled.
 */
async function rearmRepeats(): Promise<void> {
  const now = Date.now();
  for (const reminder of await DB.getAll()) {
    const spec = parseRepeat(reminder.repeat);
    if (spec === null || reminder.scheduledForEpochMillis >= now) continue;
    await advanceRepeat(reminder.id);
  }
}

function randomId(): number {
  // Flutter used Random.secure().nextInt(MAX_INT); crypto is always available
  // in the webview.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % MAX_INT;
}

/**
 * Register the snooze action buttons based on current settings. Returns the
 * action type id to attach to the notification, or null when snooze is
 * disabled.
 */
async function registerSnoozeActions(): Promise<string | null> {
  const settings = useSettingsStore();
  if (!settings.showNotifSnooze) {
    syncNotificationActionGroup(null);
    return null;
  }

  // The visible presets already account for the custom button claiming a slot;
  // append the custom action only when the setting enables it.
  //
  // foreground: false routes a preset tap to SnoozeActionReceiver.kt as a
  // broadcast, so it re-schedules and clears the notification without ever
  // launching the app. "Custom…" stays on the foreground/Activity path — it
  // has nowhere to ask for a duration except the in-app dialog.
  const actions = settings.visibleSnoozeOptions.map((option) => ({
    foreground: false,
    id: `${SNOOZE_PREFIX}${option.raw}`,
    title: `+ ${option.label}`,
  }));
  if (settings.notifSnoozeCustomButton) {
    actions.push({
      foreground: true,
      id: CUSTOM_SNOOZE_ACTION_ID,
      title: 'Custom…',
    });
  }

  await registerActionTypes([{
    id: ACTION_TYPE_ID,
    actions,
  }]);
  syncNotificationActionGroup(ACTION_TYPE_ID);
  return ACTION_TYPE_ID;
}

/**
 * Mirror the action group to the native side for CreateReminderReceiver.kt,
 * which arms reminders with no notification to copy one from (see
 * NotificationActionGroup.kt). Empty string = snooze off, so no buttons.
 */
function syncNotificationActionGroup(actionTypeId: string | null): void {
  window.AndroidNative?.setNotificationActionGroup(actionTypeId ?? '');
}

/**
 * Shapes get_active can resolve to. Android has no Rust command backing
 * `get_active`, so the invoke is forwarded straight to the Kotlin plugin and
 * its `JSArray` return value is serialized by reflection over the org.json
 * internals — `{ values: [{ nameValuePairs: { id, … } }] }` — rather than as
 * the `ActiveNotification[]` the plugin's type declarations promise. The
 * plain-array arm is kept so a future plugin fix doesn't silently regress
 * this back to sweeping everything.
 */
interface RawActive {
  values?: { nameValuePairs?: { id?: unknown; }; }[];
}

/** Ids of notifications currently visible in the drawer. */
async function activeNotificationIds(): Promise<Set<number>> {
  try {
    // Invoked directly rather than through the plugin's active() wrapper: that
    // wrapper types the raw payload above as ActiveNotification[], so .map()
    // over it throws and every launch swept reminders whose notification was
    // still on screen (dismissing it, snooze buttons and all). Same reason
    // permissions.status() bypasses isPermissionGranted().
    const raw = await invoke<RawActive | { id?: unknown; }[]>('plugin:notification|get_active');
    const entries =
      Array.isArray(raw) ?
        raw.map((notification) => notification.id) :
        (raw.values ?? []).map((notification) => notification.nameValuePairs?.id);

    // Coerced rather than trusted: an id arriving as a string would miss every
    // Set lookup without throwing, which is the original bug wearing a disguise.
    // `> 0` and not just isInteger: Number(null) is 0, so a malformed entry
    // would otherwise seed the Set with an id-shaped value (randomId() is
    // `% MAX_INT` of a positive draw, so real ids are always positive).
    return new Set(entries.map(Number).filter((id) => Number.isInteger(id) && id > 0));
  } catch {
    return new Set(); // Query failed — fall back to sweeping everything.
  }
}
