import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  registerActionTypes,
  onAction,
  cancel as cancelPending,
  Schedule,
} from '@tauri-apps/plugin-notification';
import { DB } from './db';
import { packageDurations, parseDurationString } from './duration';
import { isMobile } from './platform';
import { isTauri } from './tauri';
import { useSettingsStore } from '../stores/settings';

/**
 * Mirrors NotificationManager from the Flutter app.
 *
 * On mobile, notifications are scheduled through the OS (with snooze action
 * buttons) exactly like flutter_local_notifications did. Desktop OSes have no
 * scheduled-notification API, so there we keep the reminder in SQLite and arm
 * an in-app timer that fires the notification while the app is running.
 */

const MAX_INT = 0x7fffffff;
const SNOOZE_PREFIX = 'snooze_';
const ACTION_TYPE_ID = 'reminder_actions';
const NOTIFICATION_TITLE = "Don't Forget!";

/** Desktop-only: pending in-app timers keyed by reminder id. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

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
    if (!isTauri) return true; // Browser-dev fallback
    return isPermissionGranted();
  },

  /** Returns true when granted. */
  async request(): Promise<boolean> {
    if (!isTauri) return true; // Browser-dev fallback
    return (await requestPermission()) === 'granted';
  },
};

export const NotificationManager = {
  async init(): Promise<void> {
    if (isMobile) {
      // Notification action taps (snooze buttons) only exist on mobile.
      await onAction((notification) => {
        const actionId = (notification as { actionId?: string }).actionId;
        const id = notification.id;
        if (typeof id !== 'number' || !actionId?.startsWith(SNOOZE_PREFIX)) return;
        const [hours, minutes] = parseDurationString(actionId.replace(SNOOZE_PREFIX, ''));
        void NotificationManager.snooze(id, hours * 60 + minutes);
      });
    } else {
      // Desktop: re-arm in-app timers for everything still in the DB.
      const reminders = await DB.getAll();
      for (const reminder of reminders) {
        armTimer(reminder.id, reminder.details, reminder.scheduledForEpochMillis);
      }
    }
  },

  async schedule(dateTime: Date, details: string, zone?: string): Promise<void> {
    const id = randomId();

    if (isMobile) {
      await sendNotification({
        id,
        title: NOTIFICATION_TITLE,
        body: details,
        largeBody: details,
        schedule: Schedule.at(dateTime),
        actionTypeId: (await registerSnoozeActions()) ?? undefined,
      });
    } else {
      armTimer(id, details, dateTime.getTime());
    }

    await DB.insert(id, details, dateTime.getTime(), zone);
    emitChange();
  },

  async snooze(id: number, minutes: number): Promise<void> {
    const reminder = await DB.getById(id);
    if (reminder === null) return;
    await NotificationManager.cancel(id);
    const dateTime = new Date(Date.now() + minutes * 60_000);
    await NotificationManager.schedule(dateTime, reminder.details, reminder.timezone);
  },

  async cancel(id: number): Promise<void> {
    if (isMobile) {
      try {
        await cancelPending([id]);
      } catch {
        // Already delivered or unknown — nothing to cancel.
      }
    } else {
      const timer = timers.get(id);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(id);
    }
    await DB.remove(id);
    emitChange();
  },

  /** Drop reminders whose scheduled time has already passed. */
  async cleanExpired(): Promise<void> {
    const expired = await DB.getExpired(Date.now());
    for (const reminder of expired) {
      await NotificationManager.cancel(reminder.id);
    }
  },
};

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
 * disabled. Mobile only — desktop notifications have no action support.
 */
async function registerSnoozeActions(): Promise<string | null> {
  const settings = useSettingsStore();
  if (!settings.showNotifSnooze) return null;

  const options = packageDurations(settings.notifSnoozeOptions);
  await registerActionTypes([
    {
      id: ACTION_TYPE_ID,
      actions: options.map((option) => ({
        id: `${SNOOZE_PREFIX}${option.raw}`,
        title: `+ ${option.label}`,
      })),
    },
  ]);
  return ACTION_TYPE_ID;
}

function armTimer(id: number, details: string, epochMillis: number): void {
  const delay = epochMillis - Date.now();
  if (delay > MAX_INT) return; // Beyond setTimeout range (~24.8 days); re-armed on next launch

  const timer = setTimeout(() => {
    void (async () => {
      if (isTauri) {
        sendNotification({ title: NOTIFICATION_TITLE, body: details });
      } else {
        console.info(`[browser-dev] notification: ${NOTIFICATION_TITLE} — ${details}`);
      }
      timers.delete(id);
      await DB.remove(id);
      emitChange();
    })();
  }, Math.max(delay, 0));

  timers.set(id, timer);
}
