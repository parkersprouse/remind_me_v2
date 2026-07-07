/**
 * Duration helpers mirroring SettingsProvider's duration handling in the
 * Flutter app. Durations are persisted as `H:MM:SS` strings (the format Dart's
 * `Duration.toString()` produced, minus the microseconds suffix).
 */

export interface DurationOption {
  /** Display label, e.g. "15 min." or "1 hr." */
  label: string;
  /** Original serialized value, e.g. "0:15:00" */
  raw: string;
  hours: number;
  minutes: number;
}

/** Parse a `H:MM:SS[.mmmmmm]` string into [hours, minutes, seconds]. */
export function parseDurationString(duration: string): [number, number, number] {
  const [hours = 0, minutes = 0, seconds = 0] = duration
    .split(':')
    .map((part) => Math.trunc(Number.parseFloat(part)));
  return [hours, minutes, seconds];
}

export function durationToString(hours: number, minutes: number): string {
  return `${hours}:${String(minutes).padStart(2, '0')}:00`;
}

/** Build a duration string from a picker value + unit (dialog semantics). */
export function durationFromElements(value: number, unit: 'minutes' | 'hours'): string {
  return unit === 'hours' ? durationToString(value, 0) : durationToString(0, value);
}

/**
 * Convert serialized durations into labeled options.
 * Label logic matches SettingsProvider.packageDurations: minutes win if
 * present, otherwise "<hours> hr(s).".
 */
export function packageDurations(options: string[]): DurationOption[] {
  return options.map((raw) => {
    const [hours, minutes] = parseDurationString(raw);
    const label = minutes > 0 ? `${minutes} min.` : `${hours} hr${hours > 1 ? 's' : ''}.`;
    return { label, raw, hours, minutes };
  });
}

export function durationToMinutes(option: DurationOption): number {
  return option.hours * 60 + option.minutes;
}
