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
  if (details === null) return;

  const at = request.atMillis;
  const has_future_time = at !== null && at > Date.now();
  const router = useRouterStore();
  const granted = await permissions.status();

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

function normalizeDetails(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed.length > DETAILS_MAX_LENGTH ? trimmed.slice(0, DETAILS_MAX_LENGTH) : trimmed;
}
