import { Schedule, ScheduleEvery } from '@tauri-apps/plugin-notification';

import { formatTimeOfDay } from '~lib/format.ts';

/**
 * Repeat rules for reminders, serialized as JSON into the `repeat` column.
 *
 * Mapping onto the notification plugin (verified against its Android source):
 * - `interval` with unit `minutes`, or `hours` with no `minute` set (legacy
 *   data — see below) → `Schedule.every(unit, count)`: AlarmManager.setRepeating
 *   anchored at now + interval. Inexact by design (the OS batches repeating
 *   alarms and always anchors the first fire to "now", never a wall-clock
 *   target) — acceptable for plain "every N units from now" semantics.
 * - `daily`/`weekly`/`monthly` with `every === 1` → `Schedule.interval(DateMatch)`:
 *   an exact alarm for the next wall-clock match that the plugin's broadcast
 *   receiver re-arms itself after each fire. Works with the app process dead.
 * - `daily`/`weekly`/`monthly` with `every > 1`, and `interval` with unit
 *   `hours` + a `minute` set → the plugin has no primitive for "every 2nd
 *   Tuesday" or "every 3 hours, aligned to :15" (setRepeating can't be
 *   anchored to a wall-clock target), so these are CHAINED: an exact one-shot
 *   `Schedule.at` for the next occurrence, re-armed by the app on launch and
 *   on delivery. `anchor` pins the first occurrence so cycles stay stable
 *   across re-arms.
 *
 * `days`/`weeks`/`months` interval units, and a bare `hours` interval with no
 * `minute`, are legacy shapes the "Every…" picker no longer creates (daily
 * and larger cycles now live under "On a schedule", and hourly intervals
 * always carry a minute-of-hour alignment) — kept here so reminders created
 * before that change keep scheduling and displaying correctly.
 */
export type IntervalUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

export type RepeatSpec =
  | {
    kind: 'interval';
    count: number;
    unit: IntervalUnit;
    /** Minute past the hour to align fires to. Only meaningful (and only
       *  ever set by the picker) when `unit === 'hours'`; its presence is
       *  what makes an hourly interval chained instead of a native repeat. */
    minute?: number;
    /** Epoch millis of the first occurrence; set when scheduled (chained hourly only). */
    anchor?: number;
  } |
  {
    kind: 'daily';
    every: number;
    hour: number;
    minute: number;
    /** Epoch millis of the first occurrence; set when scheduled. */
    anchor?: number;
  } |
  {
    kind: 'weekly';
    every: number;
    /** 1 = Sunday .. 7 = Saturday (plugin DateMatch convention) */
    weekday: number;
    hour: number;
    minute: number;
    /** Epoch millis of the first occurrence; set when scheduled. */
    anchor?: number;
  } |
  {
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
  minutes: 60000,
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
    const value = JSON.parse(json) as { kind?: string; };
    if (
      value.kind === 'interval' ||
      value.kind === 'daily' ||
      value.kind === 'weekly' ||
      value.kind === 'monthly'
    ) {
      return value as RepeatSpec;
    }
    return null;
  } catch {
    return null;
  }
}

/** An hourly interval only chains when it carries a minute-of-hour alignment. */
function isChainedHourly(spec: Extract<RepeatSpec, { kind: 'interval'; }>): boolean {
  return spec.unit === 'hours' && spec.minute !== undefined;
}

/** Chained specs need the app to re-arm the next occurrence after each fire. */
export function isChained(spec: RepeatSpec): boolean {
  if (spec.kind === 'interval') return isChainedHourly(spec);
  return spec.every > 1;
}

export function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/** "Every 15 minutes", "Every 3 hours at :15", "Every Tuesday at 9:00 AM", "Every 2nd Tuesday at 9:00 AM". */
export function describeRepeat(spec: RepeatSpec): string {
  switch (spec.kind) {
    case 'interval': {
      const unit = spec.count === 1 ? spec.unit.slice(0, -1) : spec.unit;
      const prefix = spec.count === 1 ? `Every ${unit}` : `Every ${spec.count} ${unit}`;
      if (isChainedHourly(spec)) return `${prefix} at :${String(spec.minute).padStart(2, '0')}`;
      return prefix;
    }
    case 'daily': {
      const prefix = spec.every === 1 ? 'Daily' : `Every ${ordinal(spec.every)} day`;
      return `${prefix} at ${formatTimeOfDay(spec.hour, spec.minute)}`;
    }
    case 'weekly': {
      const day = WEEKDAY_NAMES[spec.weekday - 1];
      const prefix = spec.every === 1 ? `Every ${day}` : `Every ${ordinal(spec.every)} ${day}`;
      return `${prefix} at ${formatTimeOfDay(spec.hour, spec.minute)}`;
    }
    case 'monthly': {
      const day = `the ${ordinal(spec.day)}`;
      const prefix =
        spec.every === 1 ? `Monthly on ${day}` : `Every ${ordinal(spec.every)} month on ${day}`;
      return `${prefix} at ${formatTimeOfDay(spec.hour, spec.minute)}`;
    }
    // no default
  }
}

/** Next minute-of-hour match strictly after `after` (chained hourly interval). */
function nextHourlyMatch(spec: Extract<RepeatSpec, { kind: 'interval'; }>, after: Date): Date {
  const d = new Date(after);
  d.setMinutes(spec.minute ?? 0, 0, 0);
  if (d.getTime() <= after.getTime()) d.setHours(d.getHours() + 1);
  return d;
}

/** Next day/time match strictly after `after`. */
function nextDailyMatch(spec: Extract<RepeatSpec, { kind: 'daily'; }>, after: Date): Date {
  const d = new Date(after);
  d.setHours(spec.hour, spec.minute, 0, 0);
  if (d.getTime() <= after.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** Next weekday/time match strictly after `after`. */
function nextWeeklyMatch(spec: Extract<RepeatSpec, { kind: 'weekly'; }>, after: Date): Date {
  const d = new Date(after);
  d.setHours(spec.hour, spec.minute, 0, 0);
  // JS getDay() is 0=Sunday; the spec uses 1=Sunday
  while (d.getDay() !== spec.weekday - 1 || d.getTime() <= after.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** Next day-of-month/time match strictly after `after` (day is always 1-28). */
function nextMonthlyMatch(spec: Extract<RepeatSpec, { kind: 'monthly'; }>, after: Date): Date {
  let d = new Date(after.getFullYear(), after.getMonth(), spec.day, spec.hour, spec.minute);
  if (d.getTime() <= after.getTime()) {
    d = new Date(after.getFullYear(), after.getMonth() + 1, spec.day, spec.hour, spec.minute);
  }
  return d;
}

/**
 * Next occurrence of a chained hourly interval (`every > 1` isn't the trigger
 * here — any minute-aligned hourly interval chains) strictly after `after`:
 * steps whole `count`-hour cycles from the anchor.
 */
function nextChainedHourly(spec: Extract<RepeatSpec, { kind: 'interval'; }>, after: Date): Date {
  if (spec.anchor === undefined) return nextHourlyMatch(spec, after);
  const d = new Date(spec.anchor);
  while (d.getTime() <= after.getTime()) d.setHours(d.getHours() + spec.count);
  return d;
}

/**
 * Next occurrence of a chained (every > 1) calendar rule strictly after
 * `after`: steps whole cycles from the anchor using local-calendar
 * arithmetic so the wall-clock time survives DST shifts.
 */
function nextChainedOccurrence(
  spec: Extract<RepeatSpec, { kind: 'daily' | 'weekly' | 'monthly'; }>,
  after: Date,
): Date {
  const anchor_epoch = spec.anchor;
  if (anchor_epoch === undefined) {
    if (spec.kind === 'daily') return nextDailyMatch(spec, after);
    return spec.kind === 'weekly' ? nextWeeklyMatch(spec, after) : nextMonthlyMatch(spec, after);
  }

  const d = new Date(anchor_epoch);
  while (d.getTime() <= after.getTime()) {
    if (spec.kind === 'daily') d.setDate(d.getDate() + spec.every);
    else if (spec.kind === 'weekly') d.setDate(d.getDate() + 7 * spec.every);
    else d.setMonth(d.getMonth() + spec.every);
  }
  return d;
}

/** Compute the next occurrence of a repeat rule strictly after `after`. */
export function nextOccurrence(spec: RepeatSpec, after: Date): Date {
  switch (spec.kind) {
    case 'interval':
      if (isChainedHourly(spec)) return nextChainedHourly(spec, after);
      return new Date(after.getTime() + spec.count * INTERVAL_UNIT_MILLIS[spec.unit]);
    case 'daily':
      return spec.every === 1 ? nextDailyMatch(spec, after) : nextChainedOccurrence(spec, after);
    case 'weekly':
      return spec.every === 1 ? nextWeeklyMatch(spec, after) : nextChainedOccurrence(spec, after);
    case 'monthly':
      return spec.every === 1 ? nextMonthlyMatch(spec, after) : nextChainedOccurrence(spec, after);
    // no default
  }
}

/**
 * Stamp the anchor (first occurrence) onto a chained spec that doesn't have
 * one yet. Called when a reminder is (re)scheduled so edits recompute cycles.
 */
export function withAnchor(spec: RepeatSpec, from: Date): RepeatSpec {
  if (!isChained(spec) || spec.anchor !== undefined) return spec;
  return {
    ...spec,
    anchor: nextOccurrence(spec, from).getTime(),
  };
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
    case 'interval': {
      if (isChainedHourly(spec)) {
        const next = nextChainedHourly(spec, from);
        return {
          schedule: Schedule.at(next, false, true),
          nextEpochMillis: next.getTime(),
          chained: true,
        };
      }
      return {
        schedule: Schedule.every(INTERVAL_UNIT_TO_EVERY[spec.unit], spec.count, true),
        nextEpochMillis: nextOccurrence(spec, from).getTime(),
        chained: false,
      };
    }
    case 'daily': {
      if (spec.every === 1) {
        return {
          schedule: Schedule.interval({
            hour: spec.hour,
            minute: spec.minute,
          }, true),
          nextEpochMillis: nextDailyMatch(spec, from).getTime(),
          chained: false,
        };
      }
      const next = nextChainedOccurrence(spec, from);
      return {
        schedule: Schedule.at(next, false, true),
        nextEpochMillis: next.getTime(),
        chained: true,
      };
    }
    case 'weekly': {
      if (spec.every === 1) {
        return {
          schedule: Schedule.interval(
            {
              weekday: spec.weekday,
              hour: spec.hour,
              minute: spec.minute,
            },
            true,
          ),
          nextEpochMillis: nextWeeklyMatch(spec, from).getTime(),
          chained: false,
        };
      }
      const next = nextChainedOccurrence(spec, from);
      return {
        schedule: Schedule.at(next, false, true),
        nextEpochMillis: next.getTime(),
        chained: true,
      };
    }
    case 'monthly': {
      if (spec.every === 1) {
        return {
          schedule: Schedule.interval({
            day: spec.day,
            hour: spec.hour,
            minute: spec.minute,
          }, true),
          nextEpochMillis: nextMonthlyMatch(spec, from).getTime(),
          chained: false,
        };
      }
      const next = nextChainedOccurrence(spec, from);
      return {
        schedule: Schedule.at(next, false, true),
        nextEpochMillis: next.getTime(),
        chained: true,
      };
    }
    // no default
  }
}
