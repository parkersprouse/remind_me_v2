import { Schedule, ScheduleEvery } from '@tauri-apps/plugin-notification';

/**
 * Repeat rules for reminders, serialized as JSON into the `repeat` column.
 *
 * Mapping onto the notification plugin (verified against its Android source):
 * - `interval` → `Schedule.every(unit, count)`: AlarmManager.setRepeating
 *   anchored at now + interval. Inexact by design (the OS batches repeating
 *   alarms) and `months` is approximated as 30 days — both acceptable for
 *   "every N units from now" semantics.
 * - `weekly`/`monthly` with `every === 1` → `Schedule.interval(DateMatch)`:
 *   an exact alarm for the next wall-clock match that the plugin's broadcast
 *   receiver re-arms itself after each fire. Works with the app process dead.
 * - `weekly`/`monthly` with `every > 1` → the plugin has no primitive for
 *   "every 2nd Tuesday" (setRepeating can't be anchored to a wall-clock
 *   target), so these are CHAINED: an exact one-shot `Schedule.at` for the
 *   next occurrence, re-armed by the app on launch and on delivery. `anchor`
 *   pins the first occurrence so "on" cycles stay stable across re-arms.
 */
export type IntervalUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

export type RepeatSpec =
  | { kind: 'interval'; count: number; unit: IntervalUnit }
  | {
      kind: 'weekly';
      every: number;
      /** 1 = Sunday .. 7 = Saturday (plugin DateMatch convention) */
      weekday: number;
      hour: number;
      minute: number;
      /** Epoch millis of the first occurrence; set when scheduled. */
      anchor?: number;
    }
  | {
      kind: 'monthly';
      every: number;
      /** 1-28 — capped so every month has the day (the plugin's Calendar
       *  arithmetic is lenient and would roll "Feb 31" into March). */
      day: number;
      hour: number;
      minute: number;
      anchor?: number;
    };

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const INTERVAL_UNIT_TO_EVERY: Record<IntervalUnit, ScheduleEvery> = {
  minutes: ScheduleEvery.Minute,
  hours: ScheduleEvery.Hour,
  days: ScheduleEvery.Day,
  weeks: ScheduleEvery.Week,
  months: ScheduleEvery.Month,
};

// Matches the plugin's getIntervalTime() approximations (month = 30 days) so
// the stored next-occurrence epoch agrees with when the OS will actually fire.
const INTERVAL_UNIT_MILLIS: Record<IntervalUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
  months: 30 * 86_400_000,
};

export function serializeRepeat(spec: RepeatSpec): string {
  return JSON.stringify(spec);
}

export function parseRepeat(json: string | null): RepeatSpec | null {
  if (json === null || json === '') return null;
  try {
    const value = JSON.parse(json) as RepeatSpec;
    if (value.kind === 'interval' || value.kind === 'weekly' || value.kind === 'monthly') {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

/** Chained specs need the app to re-arm the next occurrence after each fire. */
export function isChained(spec: RepeatSpec): boolean {
  return spec.kind !== 'interval' && spec.every > 1;
}

export function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

function formatRuleTime(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return timeFormatter.format(d);
}

/** "Every 15 minutes", "Every Tuesday at 9:00 AM", "Every 2nd Tuesday at 9:00 AM". */
export function describeRepeat(spec: RepeatSpec): string {
  switch (spec.kind) {
    case 'interval': {
      const unit = spec.count === 1 ? spec.unit.slice(0, -1) : spec.unit;
      return spec.count === 1 ? `Every ${unit}` : `Every ${spec.count} ${unit}`;
    }
    case 'weekly': {
      const day = WEEKDAY_NAMES[spec.weekday - 1];
      const prefix = spec.every === 1 ? `Every ${day}` : `Every ${ordinal(spec.every)} ${day}`;
      return `${prefix} at ${formatRuleTime(spec.hour, spec.minute)}`;
    }
    case 'monthly': {
      const day = `the ${ordinal(spec.day)}`;
      const prefix =
        spec.every === 1 ? `Monthly on ${day}` : `Every ${ordinal(spec.every)} month on ${day}`;
      return `${prefix} at ${formatRuleTime(spec.hour, spec.minute)}`;
    }
  }
}

/** Next weekday/time match strictly after `after`. */
function nextWeeklyMatch(spec: Extract<RepeatSpec, { kind: 'weekly' }>, after: Date): Date {
  const d = new Date(after);
  d.setHours(spec.hour, spec.minute, 0, 0);
  // JS getDay() is 0=Sunday; the spec uses 1=Sunday
  while (d.getDay() !== spec.weekday - 1 || d.getTime() <= after.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** Next day-of-month/time match strictly after `after` (day is always 1-28). */
function nextMonthlyMatch(spec: Extract<RepeatSpec, { kind: 'monthly' }>, after: Date): Date {
  let d = new Date(after.getFullYear(), after.getMonth(), spec.day, spec.hour, spec.minute);
  if (d.getTime() <= after.getTime()) {
    d = new Date(after.getFullYear(), after.getMonth() + 1, spec.day, spec.hour, spec.minute);
  }
  return d;
}

/**
 * Next occurrence of a chained (every > 1) rule strictly after `after`:
 * steps whole cycles from the anchor using local-calendar arithmetic so the
 * wall-clock time survives DST shifts.
 */
function nextChainedOccurrence(
  spec: Extract<RepeatSpec, { kind: 'weekly' | 'monthly' }>,
  after: Date,
): Date {
  const anchorEpoch = spec.anchor;
  if (anchorEpoch === undefined) {
    // No anchor yet — the first occurrence is the plain next match.
    return spec.kind === 'weekly' ? nextWeeklyMatch(spec, after) : nextMonthlyMatch(spec, after);
  }

  const anchor = new Date(anchorEpoch);
  const d = new Date(anchor);
  while (d.getTime() <= after.getTime()) {
    if (spec.kind === 'weekly') {
      d.setDate(d.getDate() + 7 * spec.every);
    } else {
      d.setMonth(d.getMonth() + spec.every);
    }
  }
  return d;
}

/** Compute the next occurrence of a repeat rule strictly after `after`. */
export function nextOccurrence(spec: RepeatSpec, after: Date): Date {
  switch (spec.kind) {
    case 'interval':
      return new Date(after.getTime() + spec.count * INTERVAL_UNIT_MILLIS[spec.unit]);
    case 'weekly':
      return spec.every === 1 ? nextWeeklyMatch(spec, after) : nextChainedOccurrence(spec, after);
    case 'monthly':
      return spec.every === 1 ? nextMonthlyMatch(spec, after) : nextChainedOccurrence(spec, after);
  }
}

/**
 * Stamp the anchor (first occurrence) onto a chained spec that doesn't have
 * one yet. Called when a reminder is (re)scheduled so edits recompute cycles.
 */
export function withAnchor(spec: RepeatSpec, from: Date): RepeatSpec {
  if (!isChained(spec) || spec.kind === 'interval') return spec;
  if (spec.anchor !== undefined) return spec;
  return { ...spec, anchor: nextOccurrence(spec, from).getTime() };
}

export interface RepeatSchedule {
  schedule: Schedule;
  nextEpochMillis: number;
  /** True when the app must re-arm the next occurrence itself. */
  chained: boolean;
}

/** Map a repeat rule to the plugin schedule for its next cycle. */
export function toSchedule(spec: RepeatSpec, from: Date): RepeatSchedule {
  switch (spec.kind) {
    case 'interval':
      return {
        schedule: Schedule.every(INTERVAL_UNIT_TO_EVERY[spec.unit], spec.count, true),
        nextEpochMillis: nextOccurrence(spec, from).getTime(),
        chained: false,
      };
    case 'weekly': {
      if (spec.every === 1) {
        return {
          schedule: Schedule.interval(
            { weekday: spec.weekday, hour: spec.hour, minute: spec.minute },
            true,
          ),
          nextEpochMillis: nextWeeklyMatch(spec, from).getTime(),
          chained: false,
        };
      }
      const next = nextChainedOccurrence(spec, from);
      return { schedule: Schedule.at(next, false, true), nextEpochMillis: next.getTime(), chained: true };
    }
    case 'monthly': {
      if (spec.every === 1) {
        return {
          schedule: Schedule.interval({ day: spec.day, hour: spec.hour, minute: spec.minute }, true),
          nextEpochMillis: nextMonthlyMatch(spec, from).getTime(),
          chained: false,
        };
      }
      const next = nextChainedOccurrence(spec, from);
      return { schedule: Schedule.at(next, false, true), nextEpochMillis: next.getTime(), chained: true };
    }
  }
}
