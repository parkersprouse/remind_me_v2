/**
 * Date/time formatting matching the Jiffy patterns used in the Flutter app:
 * `yMMMd` ("Sep 4, 2024") and `jm` ("5:08 PM").
 */

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

export function formatTimeOfDay(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return timeFormatter.format(d);
}

/** Matches Reminder.formattedDate(): "Sep 4, 2024, 5:08 PM" */
export function formatEpoch(epochMillis: number): string {
  const date = new Date(epochMillis);
  return `${formatDate(date)}, ${formatTime(date)}`;
}

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
