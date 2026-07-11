<template>
  <div class='new-reminder'>
    <ReminderForm ref='formRef' mode='create' @submit='schedule' />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

import ReminderForm from '../components/ReminderForm.vue';
import { NotificationManager } from '../lib/notifications';
import { Toaster } from '../lib/toaster';

import type { RepeatSpec } from '../lib/repeat';

/**
 * Mirrors IndexTab: renders the shared reminder form in create mode and
 * schedules a fresh reminder on submit.
 */
const formRef = ref<InstanceType<typeof ReminderForm> | null>(null);

async function schedule(details: string, dateTime: Date, repeat: RepeatSpec | null): Promise<void> {
  try {
    await NotificationManager.schedule(dateTime, details, undefined, repeat);
  } catch (err) {
    console.error('Failed to schedule reminder', err);
    Toaster.show('Failed to Schedule Reminder', {
      icon: 'fa-solid fa-circle-exclamation',
      iconColor: '#f44336',
    });
    return;
  }
  formRef.value?.reset();
  Toaster.show('Reminder Scheduled', {
    icon: 'fa-solid fa-circle-check',
    iconColor: '#4caf50',
  });
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
