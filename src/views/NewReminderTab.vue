<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import DatePickerDialog from '../components/DatePickerDialog.vue';
import DetailsInput from '../components/DetailsInput.vue';
import TimePickerDialog from '../components/TimePickerDialog.vue';
import { formatDate, formatTimeOfDay } from '../lib/format';
import { NotificationManager } from '../lib/notifications';
import { Toaster } from '../lib/toaster';
import { durationToMinutes, type DurationOption } from '../lib/duration';
import { useSettingsStore } from '../stores/settings';

/**
 * Mirrors IndexTab + ReminderFormModel: reminder details, date, time, quick
 * schedule options, and the schedule button.
 */
const settings = useSettingsStore();

const form = reactive({
  details: '',
  date: new Date(),
  hour: new Date().getHours(),
  minute: new Date().getMinutes(),
});

const showDatePicker = ref(false);
const showTimePicker = ref(false);

const dateTime = computed(() => {
  const dt = new Date(form.date);
  dt.setHours(form.hour, form.minute, 0, 0);
  return dt;
});

// Validity mirrors ReminderFormModel: details present, date today-or-later,
// full timestamp strictly in the future.
const isDateValid = computed(() => {
  const endOfDay = new Date(form.date);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.getTime() >= Date.now();
});
const isTimeValid = computed(() => dateTime.value.getTime() > Date.now());
const isReminderValid = computed(
  () => form.details.length > 0 && isDateValid.value && isTimeValid.value,
);

function applyQuickOption(option: DurationOption): void {
  const target = new Date(Date.now() + durationToMinutes(option) * 60_000);
  form.date = target;
  form.hour = target.getHours();
  form.minute = target.getMinutes();
}

function resetForm(): void {
  const now = new Date();
  form.details = '';
  form.date = now;
  form.hour = now.getHours();
  form.minute = now.getMinutes();
}

async function schedule(): Promise<void> {
  await NotificationManager.schedule(dateTime.value, form.details);
  resetForm();
  Toaster.show('Reminder Scheduled', {
    icon: 'fa-solid fa-circle-check',
    iconColor: '#4caf50',
  });
}
</script>

<template>
  <div class="new-reminder">
    <DetailsInput v-model="form.details" />

    <div class="datetime-row">
      <button type="button" class="chip" title="Reminder Date" @click="showDatePicker = true">
        <i class="fa-solid fa-calendar-day chip-avatar" aria-hidden="true"></i>
        {{ formatDate(form.date) }}
      </button>
      <button type="button" class="chip" title="Reminder Time" @click="showTimePicker = true">
        <i class="fa-regular fa-clock chip-avatar" aria-hidden="true"></i>
        {{ formatTimeOfDay(form.hour, form.minute) }}
      </button>
    </div>

    <div v-if="settings.showQuickSchedule" class="quick-row">
      <button
        v-for="option in settings.quickOptions"
        :key="option.raw"
        type="button"
        class="chip chip-pill quick-chip"
        @click="applyQuickOption(option)"
      >
        {{ option.label }}
      </button>
    </div>
    <div v-else class="quick-row-spacer"></div>

    <button type="button" class="btn-filled schedule-btn" :disabled="!isReminderValid" @click="schedule">
      <i class="fa-solid fa-bell" aria-hidden="true"></i>
      Schedule Reminder
    </button>

    <DatePickerDialog v-model="form.date" :open="showDatePicker" @dismiss="showDatePicker = false" />
    <TimePickerDialog
      :open="showTimePicker"
      :hour="form.hour"
      :minute="form.minute"
      @select="(h, m) => { form.hour = h; form.minute = m; }"
      @dismiss="showTimePicker = false"
    />
  </div>
</template>

<style scoped>
.new-reminder {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  padding: 16px;
}

.datetime-row {
  display: flex;
  justify-content: space-evenly;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
}

.quick-row {
  display: flex;
  justify-content: space-evenly;
  align-items: center;
  gap: 8px;
  padding: 12px 0 24px;
}

.quick-row-spacer {
  height: 24px;
}

.quick-chip {
  font-size: 12px;
  padding: 6px 10px;
}

.schedule-btn {
  width: 100%;
  padding: 12px 20px;
}
</style>
