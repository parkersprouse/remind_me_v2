import { parse as parseDateTime } from 'chrono-node';

import { normalizeDetails } from '~lib/createRequest.ts';

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

/** Exported for the parser smoke-check; not otherwise called directly. */
export function parseSpokenReminder(transcript: string): VoiceCaptureResult {
  const clean = transcript.trim();
  if (clean === '') return { status: 'unparseable' };

  // This project's tsconfig doesn't set noUncheckedIndexedAccess, so a stored
  // `matches[0]` types as always-present — checking matches.length instead
  // (rather than the element itself) is what keeps the empty-array case
  // honest.
  const matches = parseDateTime(clean, new Date(), { forwardDate: true });

  let remainder: string;
  let date_time: Date | undefined;
  if (matches.length === 0) {
    remainder = clean;
  } else {
    const match_time = matches[0];
    date_time = match_time.start.date();
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
