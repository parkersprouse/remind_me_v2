<template>
  <div class='new-reminder'>
    <ReminderForm ref='form_ref' mode='create' @submit='schedule' />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

import ReminderForm from '~components/ReminderForm.vue';
import { prefill_request } from '~lib/createRequest.ts';
import { notification_manager } from '~lib/notifications.ts';
import { ERROR_TOAST, SUCCESS_TOAST, toaster } from '~lib/toaster.ts';

import type { PrefillRequest } from '~lib/createRequest.ts';
import type { RepeatSpec } from '~lib/repeat.ts';

/**
 * Mirrors IndexTab: renders the shared reminder form in create mode and
 * schedules a fresh reminder on submit.
 */
const form_ref = ref<InstanceType<typeof ReminderForm> | null>(null);

/**
 * Applies a pending external create request (deep link / share, see
 * createRequest.ts) to the form. Checked on mount, not just watched — a
 * request set before this tab was ever rendered (e.g. the app cold-started
 * on the landing page) would otherwise never be picked up.
 */
function applyPrefill(request: PrefillRequest | null): void {
  if (request === null) return;
  form_ref.value?.prefill(request.details, request.dateTime);
  prefill_request.value = null;
}

onMounted(() => {
  applyPrefill(prefill_request.value);
});
watch(prefill_request, applyPrefill);

async function schedule(details: string, dateTime: Date, repeat: RepeatSpec | null): Promise<void> {
  try {
    await notification_manager.schedule(dateTime, details, undefined, repeat);
  } catch (err) {
    console.error('Failed to schedule reminder', err);
    toaster.show('Failed to Schedule Reminder', ERROR_TOAST);
    return;
  }
  form_ref.value?.reset();
  toaster.show('Reminder Scheduled', SUCCESS_TOAST);
}
</script>

<style scoped>
.new-reminder {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  padding: 16px;
}
</style>
