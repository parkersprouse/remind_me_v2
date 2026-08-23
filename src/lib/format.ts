/**
 * Date/time formatting matching the Jiffy patterns used in the Flutter app:
 * `yMMMd` ("Sep 4, 2024") and `jm` ("5:08 PM").
 */

import { ref } from 'vue';

const date_formatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const time_formatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(date: Date): string {
  return date_formatter.format(date);
}

export function formatTime(date: Date): string {
  return time_formatter.format(date);
}

export function formatTimeOfDay(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return time_formatter.format(d);
}

/** Matches Reminder.formattedDate(): "Sep 4, 2024, 5:08 PM" */
export function formatEpoch(epochMillis: number): string {
  const date = new Date(epochMillis);
  return `${formatDate(date)}, ${formatTime(date)}`;
}

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Compound relative label for a one-shot reminder's scheduled time, e.g.
 * "in 3 hours, 25 minutes" or "in 4 days". Mirrors formatRelativeTime() in
 * ReminderListWidgetService.kt, which needs its own copy: the widget renders
 * from a live "now" at draw time, not anything the frontend can push ahead of
 * time (see relative_clock below for why the app side also needs a live
 * clock). Keep the two in sync by hand if the wording changes.
 *
 * Days deliberately drop the hours/minutes remainder ("in 4 days", not
 * "in 4 days, 3 hours") — reminders scheduled that far out don't need
 * minute-level precision, and Intl.RelativeTimeFormat only handles a single
 * unit anyway, so the compound cases are hand-rolled to match.
 */
export function formatRelative(epochMillis: number, now: number = Date.now()): string {
  const diff_ms = epochMillis - now;
  // Clamped rather than "X ago": isPendingDisplay() (notifications.ts) is
  // meant to keep an already-fired one-shot out of this view entirely, but it
  // filters at fetch time, not continuously — the reactive clock can tick
  // past a reminder's time before the next refetch catches up.
  if (diff_ms <= 0) return 'Now';

  const diff_minutes = Math.floor(diff_ms / 60_000);
  if (diff_minutes < 1) return 'in less than a minute';

  const days = Math.floor(diff_minutes / 1440);
  const hours = Math.floor((diff_minutes % 1440) / 60);
  const minutes = diff_minutes % 60;

  const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

  if (days > 0) return `in ${plural(days, 'day')}`;
  if (hours > 0) {
    if (minutes > 0) return `in ${plural(hours, 'hour')}, ${plural(minutes, 'minute')}`;
    return `in ${plural(hours, 'hour')}`;
  }
  return `in ${plural(minutes, 'minute')}`;
}

/**
 * Live clock for relative-time labels. A relative string goes stale the
 * moment time passes, unlike formatEpoch's absolute one — so anything
 * displaying formatRelative() needs to depend on this ref rather than a
 * one-time Date.now() read. Ticks every 30s, which is fine granularity for a
 * label with no seconds in it; startRelativeClock/stopRelativeClock gate the
 * interval on the display setting being on (see App.vue).
 */
export const relative_clock = ref(Date.now());

let clock_interval: ReturnType<typeof setInterval> | null = null;

export function startRelativeClock(): void {
  if (clock_interval !== null) return;
  clock_interval = setInterval(() => {
    relative_clock.value = Date.now();
  }, 30_000);
}

export function stopRelativeClock(): void {
  if (clock_interval !== null) {
    clearInterval(clock_interval);
    clock_interval = null;
  }
}

/**
 * Force an immediate refresh — e.g. on androidResume, where a phone that sat
 * in a pocket for two hours should read "in 1 hour", not whatever it said the
 * moment the screen went off, and the next tick could be up to 30s away.
 */
export function bumpRelativeClock(): void {
  relative_clock.value = Date.now();
}
