import { ref } from 'vue';

import { notification_manager, permissions } from '~lib/notifications.ts';
import { ERROR_TOAST, SUCCESS_TOAST, toaster } from '~lib/toaster.ts';
import { HomeTabs, Pages, useRouterStore } from '~stores/router.ts';

/**
 * External reminder creation: a deep link (`remindme://create`) or a
 * share-sheet hand-off (`ACTION_SEND` text/plain) delivered by
 * MainActivity.kt through `window.androidCreateRequest`, using the same
 * cold-start retry mechanism as the notification-action bridge (see there for
 * why one is needed) and the same replay guard, generalized on the Kotlin
 * side (PLAN.md, phase 1).
 */

// Mirrors DetailsInput.vue's MAX_LENGTH — keep the two in sync. A request
// from outside the app is untrusted input in the same sense phase 3's
// broadcast receiver is (any installed app, or a URL, can send one), so it's
// capped here rather than trusting the caller to have respected the field.
const DETAILS_MAX_LENGTH = 240;

/** Raw payload handed over by MainActivity.kt; mirrors its CreateRequest. */
interface RawCreateRequest {
  details: string | null;
  atMillis: number | null;
  source: 'deeplink' | 'share';
  /**
   * Which surface the request is asking for: the New Reminder form
   * (`remindme://create`, a share, the launcher shortcut) or the reminder
   * list (`remindme://reminders`, the phase-5 widget's rows). 'list' is
   * navigation only and never creates anything.
   */
  target: 'new' | 'list';
  /**
   * Which reminder the list request wants opened, from `?id=` on the
   * `reminders` host (PLAN.md, phase 6 — a widget row asking for *its own*
   * reminder). Null for the plain list, and for every other target.
   */
  reminderId: number | null;
}

/** A create request that couldn't be auto-created and needs the user's input. */
export interface PrefillRequest {
  details: string;
  dateTime?: Date;
}

/**
 * Set whenever a create request needs the user to confirm it.
 * NewReminderTab.vue applies this to the form (on mount and via watch, since
 * a request can arrive before the tab has ever been rendered) and clears it.
 */
export const prefill_request = ref<PrefillRequest | null>(null);

/**
 * Reminder id a `remindme://reminders?id=N` request wants the details dialog
 * opened for (PLAN.md, phase 6). Consumed by ReminderListTab.vue the same way
 * prefill_request reaches NewReminderTab: on mount as well as via watch, since
 * the request can arrive before that tab has ever been rendered. An id that no
 * longer resolves is the expected miss path, not an error — the tab just shows
 * the list.
 */
export const details_request = ref<number | null>(null);

declare global {
  interface Window {
    /**
     * Bridge target for MainActivity.kt's create-request delivery. Returns
     * true so Kotlin knows the frontend accepted delivery and can stop
     * retrying — mirrors androidNotificationAction in notifications.ts.
     */
    androidCreateRequest?: (request: RawCreateRequest) => boolean;
  }
}

export function registerCreateRequestBridge(): void {
  window.androidCreateRequest = (request): boolean => {
    void handleCreateRequest(request);
    return true;
  };
}

/**
 * Route an incoming request: per PLAN.md's design, share-sheet text always
 * waits for the user to confirm it (shared text is rarely a well-formed
 * reminder), while a fully-specified deep link — details plus a still-future
 * time — schedules outright. Anything short of that (missing time, missing
 * notification permission, or a schedule failure) falls back to prefilling
 * the New Reminder form instead of silently dropping the request.
 */
async function handleCreateRequest(request: RawCreateRequest): Promise<void> {
  const details = normalizeDetails(request.details);
  const at = request.atMillis;
  const has_future_time = at !== null && at > Date.now();
  const router = useRouterStore();
  const granted = await permissions.status();

  // `remindme://reminders` only asks for the list, optionally for one
  // reminder's details dialog (PLAN.md, phases 5 and 6). It reads exactly one
  // query parameter — `id`, a positive integer — and `details`/`at` stay
  // unread on both sides (MainActivity.kt mirrors this). The deep-link filter
  // is BROWSABLE, so any web page can send one: reading an id opens a dialog
  // over text the user already wrote, while letting details/at ride along
  // would turn a host documented as navigate-only into a second create
  // surface, outside the replay guard that create requests are covered by.
  if (request.target === 'list') {
    // Set unconditionally, like prefill_request below: the id is a request
    // waiting for ReminderListTab whenever it mounts, so it must survive an
    // ungranted-permission start where routing is left to the landing gate.
    details_request.value = request.reminderId;
    if (granted) {
      router.goTo(Pages.Home);
      router.setTab(HomeTabs.ScheduledReminders);
    }
    return;
  }

  // A deep link with no details isn't a create request at all — it's the
  // launcher shortcut's bare `remindme://create` (PLAN.md, phase 2) asking
  // for the New Reminder form. Just navigate: deliberately no prefill and no
  // reset, so a half-typed reminder survives the trip (the launcher icon
  // doesn't clear the form either). Details-less shares are meaningless, so
  // they're dropped. MainActivity.kt's isCreate mirrors this split — keep the
  // two in sync.
  if (details === null) {
    if (request.source === 'deeplink' && granted) {
      router.goTo(Pages.Home);
      router.setTab(HomeTabs.NewReminder);
    }
    return;
  }

  if (request.source === 'deeplink' && has_future_time && granted) {
    try {
      await notification_manager.schedule(new Date(at), details);
      router.goTo(Pages.Home);
      router.setTab(HomeTabs.ScheduledReminders);
      toaster.show('Reminder Scheduled', SUCCESS_TOAST);
      return;
    } catch (err) {
      console.error('Failed to schedule reminder from create request', err);
      toaster.show('Failed to Schedule Reminder', ERROR_TOAST);
      // Fall through to prefill rather than dropping the request entirely.
    }
  }

  // Notifications not yet granted: leave routing to the landing gate
  // (App.vue's checkPermission) instead of forcing Home out from under it —
  // it lands on the New Reminder tab by default once the gate opens, and the
  // prefill below is still waiting for NewReminderTab whenever it mounts.
  if (granted) {
    router.goTo(Pages.Home);
    router.setTab(HomeTabs.NewReminder);
  }
  prefill_request.value = {
    dateTime: has_future_time ? new Date(at) : undefined,
    details,
  };
}

/**
 * Trims, blank-checks, and caps details text to DetailsInput.vue's limit.
 * Exported so other untrusted-text entry points (see src/lib/voiceReminder.ts)
 * share this instead of a third copy alongside the Kotlin mirror.
 */
export function normalizeDetails(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed.length > DETAILS_MAX_LENGTH ? trimmed.slice(0, DETAILS_MAX_LENGTH) : trimmed;
}
