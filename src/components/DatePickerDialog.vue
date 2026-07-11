<template>
  <Teleport to='body'>
    <Transition name='dialog'>
      <div v-if='open' class='dialog-scrim' @click.self="emit('dismiss')">
        <div class='picker-card' role='dialog' aria-modal='true'>
          <div class='header'>
            <div class='help text-label-medium'>Select date</div>
            <div class='selected-date'>{{ formatDate(selected) }}</div>
          </div>

          <div class='month-nav'>
            <span class='month-label text-label-medium'>{{ MONTHS[view_month] }} {{ view_year }}</span>
            <span class='nav-buttons'>
              <button type='button' :disabled='!can_go_back' aria-label='Previous month' @click='changeMonth(-1)'>
                <i class='fa-solid fa-chevron-left' aria-hidden='true'/>
              </button>
              <button type='button' :disabled='!can_go_forward' aria-label='Next month' @click='changeMonth(1)'>
                <i class='fa-solid fa-chevron-right' aria-hidden='true'/>
              </button>
            </span>
          </div>

          <div class='calendar'>
            <span v-for='(weekday, i) in WEEKDAYS' :key='`wd-${i}`' class='weekday'>{{ weekday }}</span>
            <template v-for='(cell, i) in grid' :key='i'>
              <span v-if='cell === null'/>
              <button
                v-else
                type='button'
                class='day'
                :class='{ selected: cell.isSelected, today: cell.isToday }'
                :disabled='cell.disabled'
                @click='selected = cell.date'
              >
                {{ cell.day }}
              </button>
            </template>
          </div>

          <div class='actions'>
            <button type='button' class='btn-text' @click="emit('dismiss')">Cancel</button>
            <button type='button' class='btn-filled confirm' @click='confirm'>Select</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { formatDate } from '~lib/format.ts';

/**
 * Material-style calendar date picker. Selection is constrained to
 * [today, today + 1 year], matching the Flutter DatePickerDialog config.
 */
const props = defineProps<{
  open: boolean;
  modelValue: Date;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: Date];
  dismiss: [];
}>();

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const first_date = computed(() => today());
const last_date = computed(() => {
  const d = today();
  d.setFullYear(d.getFullYear() + 1);
  return d;
});

const selected = ref(new Date(props.modelValue));
const view_year = ref(selected.value.getFullYear());
const view_month = ref(selected.value.getMonth());

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selected.value = new Date(props.modelValue);
    view_year.value = selected.value.getFullYear();
    view_month.value = selected.value.getMonth();
  },
);

interface DayCell {
  day: number;
  date: Date;
  disabled: boolean;
  isSelected: boolean;
  isToday: boolean;
}

const grid = computed<(DayCell | null)[]>(() => {
  const first = new Date(view_year.value, view_month.value, 1);
  const days_in_month = new Date(view_year.value, view_month.value + 1, 0).getDate();
  const cells: (DayCell | null)[] = Array.from({ length: first.getDay() }, () => null);

  const sel = selected.value;
  const now = today();
  for (let day = 1; day <= days_in_month; day += 1) {
    const date = new Date(view_year.value, view_month.value, day);
    cells.push({
      day,
      date,
      disabled: date < first_date.value || date > last_date.value,
      isSelected:
        sel.getFullYear() === date.getFullYear() &&
        sel.getMonth() === date.getMonth() &&
        sel.getDate() === day,
      isToday: now.getTime() === date.getTime(),
    });
  }
  return cells;
});

const can_go_back = computed(() =>
  new Date(view_year.value, view_month.value, 1) >
    new Date(first_date.value.getFullYear(), first_date.value.getMonth(), 1));
const can_go_forward = computed(() =>
  new Date(view_year.value, view_month.value, 1) <
    new Date(last_date.value.getFullYear(), last_date.value.getMonth(), 1));

function changeMonth(delta: number): void {
  const next = new Date(view_year.value, view_month.value + delta, 1);
  view_year.value = next.getFullYear();
  view_month.value = next.getMonth();
}

function confirm(): void {
  emit('update:modelValue', new Date(selected.value));
  emit('dismiss');
}
</script>

<style scoped>
.dialog-scrim {
  position: fixed;
  inset: 0;
  background-color: rgb(from var(--scrim) r g b / 0.54);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}

.picker-card {
  background-color: var(--surface);
  border-radius: 28px;
  width: 100%;
  max-width: 340px;
  box-shadow: 0 8px 24px rgb(from var(--shadow) r g b / 0.35);
}

.header {
  padding: 16px 24px 12px;
  border-bottom: 1px solid var(--divider);
}

.help {
  color: var(--on-surface-variant);
  margin-bottom: 20px;
}

.selected-date {
  font-size: 28px;
  font-weight: 400;
}

.month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 0 24px;
  color: var(--on-surface-variant);
}

.nav-buttons button {
  color: var(--on-surface-variant);
  padding: 8px 10px;
  border-radius: 50%;
}

.nav-buttons button:disabled {
  color: rgb(from var(--on-surface) r g b / 0.3);
}

.calendar {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  padding: 8px 16px;
}

.weekday {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  color: var(--tertiary);
  font-weight: 700;
  font-size: 14px;
}

.day {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  border-radius: 50%;
  font-size: 14px;
  color: var(--on-surface);
}

.day:hover:not(:disabled):not(.selected) {
  background-color: rgb(from var(--on-surface) r g b / 0.08);
}

.day:disabled {
  color: rgb(from var(--on-surface) r g b / 0.35);
}

.day.today {
  border: 1px solid var(--primary);
  color: var(--primary);
}

.day.selected {
  background-color: var(--primary);
  color: var(--on-primary);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 16px 16px;
}

.confirm {
  font-size: 15px;
  padding: 8px 16px;
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.15s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
