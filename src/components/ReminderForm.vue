<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import DatePickerDialog from './DatePickerDialog.vue';
import DetailsInput from './DetailsInput.vue';
import RepeatEditor from './RepeatEditor.vue';
import TimePickerDialog from './TimePickerDialog.vue';
import { formatDate, formatTimeOfDay } from '../lib/format';
import { durationToMinutes, type DurationOption } from '../lib/duration';
import type { RepeatSpec } from '../lib/repeat';
import { useSettingsStore } from '../stores/settings';

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
  { initialDetails: '', initialDateTime: undefined, initialRepeat: null },
);

const emit = defineEmits<{
  submit: [details: string, dateTime: Date, repeat: RepeatSpec | null];
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
// A repeat rule replaces the one-shot date/time, so only details matter then.
const isReminderValid = computed(() =>
  repeat.value !== null
    ? form.details.length > 0
    : form.details.length > 0 && isDateValid.value && isTimeValid.value,
);

function applyQuickOption(option: DurationOption): void {
  const target = new Date(Date.now() + durationToMinutes(option) * 60_000);
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
  if (!isReminderValid.value) return;
  emit('submit', form.details, dateTime.value, repeat.value);
}

defineExpose({ reset });
</script>

<template>
  <div class="reminder-form">
    <DetailsInput v-model="form.details" />

    <div v-if="repeat === null" class="datetime-row">
      <button type="button" class="chip" title="Reminder Date" @click="showDatePicker = true">
        <i class="fa-solid fa-calendar-day chip-avatar" aria-hidden="true"></i>
        {{ formatDate(form.date) }}
      </button>
      <button type="button" class="chip" title="Reminder Time" @click="showTimePicker = true">
        <i class="fa-regular fa-clock chip-avatar" aria-hidden="true"></i>
        {{ formatTimeOfDay(form.hour, form.minute) }}
      </button>
    </div>

    <RepeatEditor v-model="repeat" />

    <template v-if="mode === 'create' && repeat === null">
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
    </template>
    <div v-else class="quick-row-spacer"></div>

    <button type="button" class="btn-filled submit-btn" :disabled="!isReminderValid" @click="submit">
      <i
        :class="mode === 'create' ? 'fa-solid fa-bell' : 'fa-solid fa-floppy-disk'"
        aria-hidden="true"
      ></i>
      {{ mode === 'create' ? 'Schedule Reminder' : 'Save Reminder' }}
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
  height: 24px;
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
