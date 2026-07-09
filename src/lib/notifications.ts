import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import {
  isPermissionGranted,
  requestPermission,
  registerActionTypes,
  onNotificationReceived,
  active as activeNotifications,
  cancel as cancelPending,
  createChannel,
  Importance,
  Visibility,
  Schedule,
} from '@tauri-apps/plugin-notification';
import { DB } from './db';
import { parseDurationString } from './duration';
import {
  isChained,
  nextOccurrence,
  parseRepeat,
  serializeRepeat,
  toSchedule,
  withAnchor,
  type RepeatSpec,
} from './repeat';
import { useSettingsStore } from '../stores/settings';

/**
 * Mirrors NotificationManager from the Flutter app.
 *
 * Reminders are scheduled through the Android OS notification system (with
 * snooze action buttons) exactly like flutter_local_notifications did, so they
 * fire whether or not the app is running.
 */

const MAX_INT = 0x7fffffff;
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
const recentlyExpired = new Map<number, string>();

/**
 * Set when the "Custom…" snooze action is tapped on a delivered notification;
 * App.vue watches this and presents the custom snooze dialog.
 */
export const customSnoozeRequest = ref<{ id: number; details: string } | null>(null);

declare global {
  interface Window {
    /**
     * Bridge target for MainActivity.kt (see there for why the notification
     * plugin's own actionPerformed event cannot be used on Android). Returns
     * true so the Kotlin side knows the frontend accepted delivery and can
     * stop retrying.
     */
    androidNotificationAction?: (id: number, actionId: string) => boolean;
  }
}

/** Route a notification action tap (from the MainActivity bridge) to snooze. */
async function handleNotificationAction(id: number, actionId: string): Promise<void> {
  if (!actionId.startsWith(SNOOZE_PREFIX)) return; // plain body taps just open the app

  if (actionId === CUSTOM_SNOOZE_ACTION_ID) {
    const details = (await DB.getById(id))?.details ?? recentlyExpired.get(id) ?? '';
    customSnoozeRequest.value = { id, details };
    return;
  }

  const [hours, minutes] = parseDurationString(actionId.slice(SNOOZE_PREFIX.length));
  await NotificationManager.snooze(id, hours * 60 + minutes);
}

type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

/** Subscribe to reminder mutations (fired, snoozed, cancelled). */
export function onRemindersChanged(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function emitChange(): void {
  for (const listener of changeListeners) listener();
}

export const Permissions = {
  async status(): Promise<boolean> {
    return isPermissionGranted();
  },

  /** Returns true when granted. */
  async request(): Promise<boolean> {
    return (await requestPermission()) === 'granted';
  },
};

export const NotificationManager = {
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
    const fireAt = spec ? nextOccurrence(spec, new Date()) : dateTime;

    // All-or-nothing: insert the row first, arm the notification second, and
    // roll the row back if arming fails — either both survive or neither does.
    await DB.insert(id, details, fireAt.getTime(), zone, spec ? serializeRepeat(spec) : null);

    try {
      await arm(id, fireAt, details, spec);
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
    const fireAt = spec ? nextOccurrence(spec, new Date()) : dateTime;

    await DB.insert(id, details, fireAt.getTime(), zone, spec ? serializeRepeat(spec) : null);
    await arm(id, fireAt, details, spec);
    emitChange();
  },

  async snooze(id: number, minutes: number): Promise<void> {
    const reminder = await DB.getById(id);
    // Row already swept (the reminder fired and cleanExpired got there
    // first)? The launch-time sweep remembers what it deleted.
    const details = reminder?.details ?? recentlyExpired.get(id);
    if (details === undefined) return;
    // A one-shot moves; a repeating reminder keeps its rule and spawns a
    // one-shot copy instead (cancelling it would kill the recurrence).
    if (reminder !== null && reminder.repeat === null) await NotificationManager.cancel(id);
    const dateTime = new Date(Date.now() + minutes * 60_000);
    await NotificationManager.schedule(dateTime, details, reminder?.timezone);
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
      recentlyExpired.set(reminder.id, reminder.details);
      await NotificationManager.cancel(reminder.id);
    }
    await rearmRepeats();
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
    repeat === null
      ? Schedule.at(dateTime, false, true) // allowWhileIdle so the alarm fires even in Doze
      : toSchedule(repeat, new Date()).schedule;

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
  if (!settings.showNotifSnooze) return null;

  // The visible presets already account for the custom button claiming a slot;
  // append the custom action only when the setting enables it.
  const actions = settings.visibleSnoozeOptions.map((option) => ({
    id: `${SNOOZE_PREFIX}${option.raw}`,
    title: `+ ${option.label}`,
  }));
  if (settings.notifSnoozeCustomButton) {
    actions.push({ id: CUSTOM_SNOOZE_ACTION_ID, title: 'Custom…' });
  }

  await registerActionTypes([{ id: ACTION_TYPE_ID, actions }]);
  return ACTION_TYPE_ID;
}

/** Ids of notifications currently visible in the drawer. */
async function activeNotificationIds(): Promise<Set<number>> {
  try {
    return new Set((await activeNotifications()).map((notification) => notification.id));
  } catch {
    return new Set(); // Query failed — fall back to sweeping everything.
  }
}
