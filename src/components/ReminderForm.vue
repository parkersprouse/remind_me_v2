<template>
  <div class='reminder-form'>
    <DetailsInput v-model='form.details' />

    <template v-if='repeat === null'>
      <div class='datetime-row'>
        <button type='button' class='chip' title='Reminder Date' @click='show_date_picker = true'>
          <i class='fa-solid fa-calendar-day chip-avatar' aria-hidden='true'/>
          {{ formatDate(form.date) }}
        </button>
        <button type='button' class='chip' title='Reminder Time' @click='show_time_picker = true'>
          <i class='fa-regular fa-clock chip-avatar' aria-hidden='true'/>
          {{ formatTimeOfDay(form.hour, form.minute) }}
        </button>
      </div>

      <template v-if="mode === 'create'">
        <div v-if='settings.showQuickSchedule' class='quick-row'>
          <button
            v-for='option in settings.quickOptions'
            :key='option.raw'
            type='button'
            class='chip chip-pill quick-chip'
            @click='applyQuickOption(option)'
          >
            {{ option.label }}
          </button>
        </div>
        <div v-else class='quick-row-spacer'/>
      </template>
    </template>

    <div v-else class='quick-row-spacer'/>

    <RepeatEditor v-model='repeat' />

    <div class='quick-row-spacer'/>

    <button type='button' class='btn-filled submit-btn' :disabled='!is_reminder_valid' @click='submit'>
      <i
        :class="mode === 'create' ? 'fa-solid fa-bell' : 'fa-solid fa-floppy-disk'"
        aria-hidden='true'
      />
      {{ mode === 'create' ? 'Schedule Reminder' : 'Save Reminder' }}
    </button>

    <DatePickerDialog v-model='form.date' :open='show_date_picker' @dismiss='show_date_picker = false' />
    <TimePickerDialog
      :open='show_time_picker'
      :hour='form.hour'
      :minute='form.minute'
      @select='(h, m) => { form.hour = h; form.minute = m; }'
      @dismiss='show_time_picker = false'
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';


import DatePickerDialog from '~components/DatePickerDialog.vue';
import DetailsInput from '~components/DetailsInput.vue';
import RepeatEditor from '~components/RepeatEditor.vue';
import TimePickerDialog from '~components/TimePickerDialog.vue';
import { durationToMinutes } from '~lib/duration.ts';
import { formatDate, formatTimeOfDay } from '~lib/format.ts';
import { useSettingsStore } from '~stores/settings.ts';

import type { DurationOption } from '~lib/duration.ts';
import type { RepeatSpec } from '~lib/repeat.ts';


/**
 * Mirrors ReminderFormModel: reminder details, date, and time with validity
 * checks, plus an optional repeat rule. Shared between the New Reminder tab
 * (create mode, with the quick schedule chips) and the edit dialog (edit
 * mode, pre-filled). With a repeat rule active the date/time chips hide —
 * the rule itself determines when the reminder fires.
 */
const props = withDefaults(
  defineProps<{
    mode: 'create' | 'edit';
    initialDetails?: string;
    initialDateTime?: Date;
    initialRepeat?: RepeatSpec | null;
  }>(),
  {
    initialDetails: '',
    initialDateTime: undefined,
    initialRepeat: null,
  },
);

const emit = defineEmits<{
  submit: [details: string, date_time: Date, repeat: RepeatSpec | null];
}>();

const settings = useSettingsStore();

const initial = props.initialDateTime ?? new Date();
const form = reactive({
  details: props.initialDetails,
  date: new Date(initial),
  hour: initial.getHours(),
  minute: initial.getMinutes(),
});

const repeat = ref<RepeatSpec | null>(props.initialRepeat);

const show_date_picker = ref(false);
const show_time_picker = ref(false);

const date_time = computed(() => {
  const dt = new Date(form.date);
  dt.setHours(form.hour, form.minute, 0, 0);
  return dt;
});

// Validity mirrors ReminderFormModel: details present, date today-or-later,
// full timestamp strictly in the future.
const is_date_valid = computed(() => {
  const end_of_day = new Date(form.date);
  end_of_day.setHours(23, 59, 59, 999);
  return end_of_day.getTime() >= Date.now();
});
const is_time_valid = computed(() => date_time.value.getTime() > Date.now());
// A repeat rule replaces the one-shot date/time, so only details matter then.
const is_reminder_valid = computed(() =>
  repeat.value !== null ?
    form.details.length > 0 :
    form.details.length > 0 && is_date_valid.value && is_time_valid.value);

function applyQuickOption(option: DurationOption): void {
  const target = new Date(Date.now() + durationToMinutes(option) * 60000);
  form.date = target;
  form.hour = target.getHours();
  form.minute = target.getMinutes();
}

function reset(): void {
  const now = new Date();
  form.details = '';
  form.date = now;
  form.hour = now.getHours();
  form.minute = now.getMinutes();
  repeat.value = null;
}

function submit(): void {
  if (!is_reminder_valid.value) return;
  emit('submit', form.details, date_time.value, repeat.value);
}

defineExpose({ reset });
</script>

<style scoped>
.reminder-form {
  display: flex;
  flex-direction: column;
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
  height: 16px;
}

.quick-chip {
  font-size: 12px;
  padding: 6px 10px;
}

.submit-btn {
  width: 100%;
  padding: 12px 20px;
}
</style>
