<template>
  <div class='new-reminder'>
    <ReminderForm ref='form_ref' mode='create' @submit='schedule' />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

import ReminderForm from '~components/ReminderForm.vue';
import { notification_manager } from '~lib/notifications.ts';
import { ERROR_TOAST, SUCCESS_TOAST, toaster } from '~lib/toaster.ts';

import type { RepeatSpec } from '~lib/repeat.ts';

/**
 * Mirrors IndexTab: renders the shared reminder form in create mode and
 * schedules a fresh reminder on submit.
 */
const form_ref = ref<InstanceType<typeof ReminderForm> | null>(null);

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
