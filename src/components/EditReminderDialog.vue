<template>
  <AppDialog :open='reminder !== null' @dismiss="emit('dismiss')">
    <template #title>
      <i class='fa-regular fa-pen-to-square title-icon' aria-hidden='true'/>
      <span>Edit Reminder</span>
    </template>
    <ReminderForm
      v-if='reminder'
      mode='edit'
      :initial-details='reminder.details'
      :initial-date-time='new Date(reminder.scheduledForEpochMillis)'
      :initial-repeat='parseRepeat(reminder.repeat)'
      @submit='save'
    />
  </AppDialog>
</template>

<script setup lang="ts">
import { notification_manager } from '../lib/notifications.ts';
import { parseRepeat } from '../lib/repeat.ts';
import { toaster } from '../lib/toaster.ts';

import AppDialog from './AppDialog.vue';
import ReminderForm from './ReminderForm.vue';

import type { Reminder } from '../lib/db.ts';
import type { RepeatSpec } from '../lib/repeat.ts';

/**
 * Edit dialog for a not-yet-fired reminder: the shared form pre-filled from
 * the reminder, saved in place under the same id (the pending notification is
 * cancelled and re-armed at the new time).
 */
const props = defineProps<{ reminder: Reminder | null; }>();

const emit = defineEmits<{ dismiss: []; }>();

async function save(details: string, dateTime: Date, repeat: RepeatSpec | null): Promise<void> {
  const target = props.reminder;
  if (target === null) return;

  try {
    await notification_manager.update(target.id, dateTime, details, target.timezone, repeat);
  } catch (err) {
    console.error('Failed to update reminder', err);
    toaster.show('Failed to Update Reminder', {
      icon: 'fa-solid fa-circle-exclamation',
      iconColor: '#f44336',
    });
    return;
  }

  toaster.show('Reminder Updated', {
    icon: 'fa-solid fa-circle-check',
    iconColor: '#4caf50',
  });
  emit('dismiss');
}
</script>

<style scoped>
.title-icon {
  color: var(--outline);
  font-size: 20px;
}
</style>
