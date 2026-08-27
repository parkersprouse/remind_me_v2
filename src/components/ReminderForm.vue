<template>
  <div class='reminder-form'>
    <button
      v-if="mode === 'create'"
      type='button'
      class='chip chip-pill voice-chip'
      :disabled='listening'
      @click='captureVoice'
    >
      <i class='fa-solid fa-microphone chip-avatar' aria-hidden='true'/>
      {{ listening ? 'Listening…' : 'Speak Reminder' }}
    </button>

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
import { ERROR_TOAST, toaster } from '~lib/toaster.ts';
import { captureSpokenReminder } from '~lib/voiceReminder.ts';
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
const listening = ref(false);

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

/**
 * Speak-a-reminder: launches the system speech recognizer and applies the
 * parsed result the same way an external prefill request would (see
 * captureSpokenReminder in voiceReminder.ts). A deliberate cancel (the user
 * backed out of the recognizer dialog) is silent; anything else that didn't
 * produce a usable reminder gets an error toast so the user knows to retry or
 * type it themselves, per the reason chrono-node runs in this app and not in
 * the widget's headless Kotlin path.
 *
 * Settings > Voice Reminders > "Auto-create from in-app voice" schedules the
 * parsed reminder immediately instead of leaving it for the user to review
 * and tap Schedule — but only when a time was actually recognized: without
 * one, submit() would schedule against whatever date/time the form already
 * had (usually "now"), which is not what the user asked for, so it always
 * falls back to prefill-and-wait in that case regardless of the setting.
 */
async function captureVoice(): Promise<void> {
  listening.value = true;
  try {
    const result = await captureSpokenReminder();
    if (result.status === 'ok') {
      prefill(result.details, result.dateTime);
      if (settings.voiceInAppAutoCreate && result.dateTime !== undefined) submit();
    } else if (result.status !== 'cancelled') {
      toaster.show('Couldn’t Understand That', ERROR_TOAST);
    }
  } finally {
    listening.value = false;
  }
}

/**
 * Applies an externally-supplied create request (see src/lib/createRequest.ts):
 * fills details and, when a time came with it, the date/time chips too. Always
 * clears any in-progress repeat rule — an external request can't express one.
 */
function prefill(details: string, dateTime?: Date): void {
  form.details = details;
  if (dateTime !== undefined) {
    form.date = new Date(dateTime);
    form.hour = dateTime.getHours();
    form.minute = dateTime.getMinutes();
  }
  repeat.value = null;
}

defineExpose({
  prefill,
  reset,
});
</script>

<style scoped>
.reminder-form {
  display: flex;
  flex-direction: column;
}

.voice-chip {
  align-self: center;
  margin-bottom: 16px;
}

.voice-chip:disabled {
  opacity: 0.6;
  pointer-events: none;
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
