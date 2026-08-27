import { parse as parseDateTime } from 'chrono-node';
import { watch } from 'vue';

import { normalizeDetails } from '~lib/createRequest.ts';
import { useSettingsStore } from '~stores/settings.ts';

import type { ParsedComponents } from 'chrono-node';
import type { AndroidNativeBridge } from '~lib/androidNative.ts';

/**
 * Voice-driven reminder creation: a mic button launches Android's system
 * speech recognizer (RecognizerIntent, via MainActivity.kt's
 * startVoiceCapture bridge method) and the transcript is parsed here with
 * chrono-node into a details string plus an optional Date, the same shape
 * ReminderForm.prefill() already accepts for share/deep-link requests (see
 * src/lib/createRequest.ts).
 *
 * This mirrors src/lib/backup.ts's async-picker-await pattern
 * (bridgeCall/pending resolver/lazy window.android*Result registration) for
 * the native round trip, adapted to a single-shot result instead of an
 * {event, payload} pair.
 */

// Leading filler a spoken reminder often carries that isn't part of the
// details ("set a reminder", "create a reminder", "remind me [to]"). Applied
// to whatever chrono.parse() didn't consume, so it doesn't interfere with
// date/time matching.
const FILLER_PREFIX = /^(please\s+)?(set|create)\s+(up\s+)?(a|an)\s+reminder\s*/i;
const REMIND_ME_PREFIX = /^(please\s+)?remind\s+me\s*/i;
// Left over after the time clause is removed, a leading connector word
// ("...in one hour *for* take out the trash") separates the time clause from
// the details rather than being part of them.
const CONNECTOR_PREFIX = /^(for|to|that)\s+/i;
// The preposition that introduces the time clause ("...reminder *on* August
// 6th...", "...reminder *in* one hour...") sits immediately before whatever
// chrono.parse() matched, so it has to be stripped from the text preceding
// the match rather than the (already-removed) match itself.
const TRAILING_PREPOSITION = /\b(on|in|at)\s*$/i;

export type VoiceCaptureResult =
  | {
    status: 'ok';
    details: string;
    dateTime?: Date;
  } |
  { status: 'cancelled'; } |
  // bridge missing, a capture already in flight, or the native side reported an error
  { status: 'unavailable'; } |
  // got a transcript, but no usable details survived
  { status: 'unparseable'; };

declare global {
  interface Window {
    /** Result sink for MainActivity's RecognizerIntent flow. */
    androidVoiceResult?: (event: string, payload: string) => void;
  }
}

interface BridgeResult {
  event: string;
  payload: string;
}

let pending_bridge: ((result: BridgeResult) => void) | null = null;

/**
 * Launch the recognizer and await its outcome. Returns null when the bridge
 * is missing or a capture is already in flight (the OS can't show two
 * recognizer dialogs anyway) — same shape as backup.ts's bridgeCall.
 */
function bridgeCall(launch: (bridge: AndroidNativeBridge) => void): Promise<BridgeResult> | null {
  const bridge = window.AndroidNative;
  if (bridge === undefined || pending_bridge !== null) return null;

  window.androidVoiceResult ??= (event, payload): void => {
    const resolve = pending_bridge;
    pending_bridge = null;
    resolve?.({
      event,
      payload,
    });
  };

  const result = new Promise<BridgeResult>((resolve) => {
    pending_bridge = resolve;
  });
  launch(bridge);
  return result;
}

/**
 * Mirrors Settings > Voice Reminders > "Auto-create from widget voice" to
 * native storage, so VoiceQuickCreateActivity.kt can read it without a live
 * webview — the widget's mic tap can land at any moment, including while the
 * app has never been opened since install. Same reasoning and pattern as
 * registerSnoozeActions mirroring the snooze setting via
 * setNotificationActionGroup (see notifications.ts): call once at startup to
 * cover an install where the setting has never changed, then watch for
 * changes so toggling it in Settings takes effect immediately rather than on
 * the next app restart.
 */
export function syncVoiceWidgetAutoCreate(): void {
  const settings = useSettingsStore();
  const sync = (): void => {
    window.AndroidNative?.setVoiceWidgetAutoCreate(settings.voiceWidgetAutoCreate);
  };
  sync();
  watch(() => settings.voiceWidgetAutoCreate, sync);
}

/** Launch the speech recognizer and parse whatever it hears into a reminder. */
export async function captureSpokenReminder(): Promise<VoiceCaptureResult> {
  const result = bridgeCall((bridge) => {
    bridge.startVoiceCapture();
  });
  if (result === null) return { status: 'unavailable' };

  const { event, payload } = await result;
  if (event === 'voice-cancelled') return { status: 'cancelled' };
  if (event !== 'voice-result') return { status: 'unavailable' };

  return parseSpokenReminder(payload);
}

/**
 * chrono-node's own guess for a clock time with no am/pm doesn't match what
 * this feature wants: it reads the digits literally (so "at 4:00" is always
 * 4:00 AM) and, with forwardDate, rolls a full day forward once that specific
 * reading has passed — even when the PM reading is still hours away. Instead,
 * an ambiguous time should resolve to whichever of the two 12-hour readings
 * is the *next one to occur* from `now`: "at 4:00" said at 3:30 PM means
 * 4:00 PM today. AM always precedes PM on the same calendar day, so in
 * chronological order the only candidates that can possibly be "next" are
 * today's AM reading, today's PM reading, then tomorrow's AM reading (always
 * still in the future once both of today's have passed, so nothing later
 * ever needs checking) — the first one at or after `now` wins. Mirrors
 * resolveAmbiguousTime in SpokenReminderParser.kt (the widget's dependency-
 * free parser, which cannot run chrono-node) — keep the two in sync.
 *
 * The date to anchor those candidates on can't just be comp.get('day') (etc):
 * for a bare time with no date word at all, chrono's forwardDate has already
 * rolled the *day* forward to make its own (wrong) AM guess land in the
 * future, so an uncertain day is contaminated by the very guess this
 * function exists to override — verified directly against chrono-node, not
 * assumed, since it silently produced a day-late answer during development.
 * An explicitly-stated date ("on September 1st", "tomorrow") marks the day
 * certain and is unaffected, so it's used as-is.
 */
function resolveAmbiguousMeridiem(now: Date, comp: ParsedComponents): Date {
  const date_given = comp.isCertain('day') || comp.isCertain('weekday');
  const year = date_given ? comp.get('year') ?? now.getFullYear() : now.getFullYear();
  const month = date_given ? comp.get('month') ?? now.getMonth() + 1 : now.getMonth() + 1;
  const day = date_given ? comp.get('day') ?? now.getDate() : now.getDate();
  const hour = comp.get('hour') ?? 0;
  const minute = comp.get('minute') ?? 0;
  const am_hour = hour === 12 ? 0 : hour;
  const pm_hour = hour === 12 ? 12 : hour + 12;
  const candidates = [
    new Date(year, month - 1, day, am_hour, minute),
    new Date(year, month - 1, day, pm_hour, minute),
    new Date(year, month - 1, day + 1, am_hour, minute),
  ];
  return candidates.find((candidate) => candidate.getTime() >= now.getTime()) ?? candidates[candidates.length - 1];
}

/** Exported for the parser smoke-check; not otherwise called directly. */
export function parseSpokenReminder(transcript: string): VoiceCaptureResult {
  const clean = transcript.trim();
  if (clean === '') return { status: 'unparseable' };

  const now = new Date();
  // This project's tsconfig doesn't set noUncheckedIndexedAccess, so a stored
  // `matches[0]` types as always-present — checking matches.length instead
  // (rather than the element itself) is what keeps the empty-array case
  // honest.
  const matches = parseDateTime(clean, now, { forwardDate: true });

  let remainder: string;
  let date_time: Date | undefined;
  if (matches.length === 0) {
    remainder = clean;
  } else {
    const match_time = matches[0];
    date_time = match_time.start.isCertain('meridiem') ?
      match_time.start.date() :
      resolveAmbiguousMeridiem(now, match_time.start);
    const before = clean.slice(0, match_time.index).replace(TRAILING_PREPOSITION, '').trimEnd();
    const after = clean.slice(match_time.index + match_time.text.length);
    remainder = `${before} ${after}`;
  }
  remainder = remainder.replace(FILLER_PREFIX, '').replace(REMIND_ME_PREFIX, '').trim();
  remainder = remainder.replace(CONNECTOR_PREFIX, '').trim();
  // A leading filler phrase can precede the time clause ("set a reminder in
  // one hour for..."), so it may still be present after the time clause is
  // stripped out from the middle — strip it a second time.
  remainder = remainder.replace(FILLER_PREFIX, '').replace(REMIND_ME_PREFIX, '').trim();
  remainder = remainder.replace(CONNECTOR_PREFIX, '').trim();

  const details = normalizeDetails(remainder);
  if (details === null) return { status: 'unparseable' };

  return {
    status: 'ok',
    details,
    dateTime: date_time,
  };
}
