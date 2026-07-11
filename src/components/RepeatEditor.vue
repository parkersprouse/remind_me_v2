<template>
  <div class='repeat-editor'>
    <LabeledSwitch v-model='enabled'>
      <span class='switch-label'>
        <i class='fa-solid fa-repeat' aria-hidden='true'/>
        Repeat
      </span>
    </LabeledSwitch>

    <div v-if='enabled' class='controls'>
      <div class='type-select'>
        <button
          type='button'
          class='chip chip-pill'
          :class="{ selected: type === 'interval' }"
          @click="type = 'interval'"
        >
          Every…
        </button>
        <button
          type='button'
          class='chip chip-pill'
          :class="{ selected: type === 'calendar' }"
          @click="type = 'calendar'"
        >
          On a schedule
        </button>
      </div>

      <div v-if="type === 'interval'" class='interval-controls'>
        <NumberPicker v-model='count' :min='1' :max='99' />
        <div class='unit-select'>
          <button
            v-for='u in UNITS'
            :key='u'
            type='button'
            :class='{ selected: unit === u }'
            @click='unit = u'
          >
            {{ u.charAt(0).toUpperCase() + u.slice(1) }}
          </button>
        </div>
      </div>

      <div v-else class='calendar-controls'>
        <div class='row-select'>
          <button
            type='button'
            class='chip chip-pill'
            :class="{ selected: cal_kind === 'weekly' }"
            @click="cal_kind = 'weekly'"
          >
            Weekly
          </button>
          <button
            type='button'
            class='chip chip-pill'
            :class="{ selected: cal_kind === 'monthly' }"
            @click="cal_kind = 'monthly'"
          >
            Monthly
          </button>
        </div>

        <div class='row-select multiplier-row' role='group' aria-label='Repeat cycle'>
          <button
            v-for='m in MULTIPLIERS'
            :key='m'
            type='button'
            class='cycle'
            :class='{ selected: every === m }'
            @click='every = m'
          >
            {{ m === 1 ? 'Every' : ordinal(m) }}
          </button>
        </div>

        <div v-if="cal_kind === 'weekly'" class='row-select weekday-row' role='group' aria-label='Weekday'>
          <button
            v-for='(letter, i) in WEEKDAY_LETTERS'
            :key='i'
            type='button'
            class='weekday'
            :class='{ selected: weekday === i + 1 }'
            :aria-label='`Weekday ${i + 1}`'
            @click='weekday = i + 1'
          >
            {{ letter }}
          </button>
        </div>

        <div v-else class='day-row'>
          <span class='day-label'>Day of month</span>
          <NumberPicker v-model='day' :min='1' :max='28' />
        </div>

        <div class='time-row'>
          <button type='button' class='chip' title='Repeat Time' @click='show_time_picker = true'>
            <i class='fa-regular fa-clock chip-avatar' aria-hidden='true'/>
            {{ formatTimeOfDay(hour, minute) }}
          </button>
        </div>
      </div>

      <div class='summary text-label-small'>{{ summary }}</div>
    </div>

    <TimePickerDialog
      :open='show_time_picker'
      :hour='hour'
      :minute='minute'
      @select='(h, m) => { hour = h; minute = m; }'
      @dismiss='show_time_picker = false'
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';


import LabeledSwitch from '~components/LabeledSwitch.vue';
import NumberPicker from '~components/NumberPicker.vue';
import TimePickerDialog from '~components/TimePickerDialog.vue';
import { formatTimeOfDay } from '~lib/format.ts';
import { describeRepeat, ordinal } from '~lib/repeat.ts';

import type { IntervalUnit, RepeatSpec } from '~lib/repeat.ts';

/**
 * Repeat rule editor embedded in ReminderForm. Off/on switch; when on, the
 * rule is either "Every N units" (interval) or "On a schedule" (weekly /
 * monthly calendar rule with an every-Nth multiplier and a time of day).
 */
const model = defineModel<RepeatSpec | null>({ required: true });

const UNITS: IntervalUnit[] = ['minutes', 'hours', 'days', 'weeks', 'months'];
const MULTIPLIERS = [1, 2, 3, 4, 5, 6];
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Editing state survives toggling the switch off and on; the model is
// rebuilt from it on every change while enabled.
const now = new Date();
const type = ref<'interval' | 'calendar'>('interval');
const count = ref(1);
const unit = ref<IntervalUnit>('days');
const cal_kind = ref<'weekly' | 'monthly'>('weekly');
const every = ref(1);
const weekday = ref(now.getDay() + 1); // 1=Sunday, matching the spec
const day = ref(Math.min(now.getDate(), 28));
const hour = ref(now.getHours());
const minute = ref(now.getMinutes());

const show_time_picker = ref(false);

// Pre-fill from an existing spec (edit mode mounts this component fresh).
const initial = model.value;
if (initial !== null) {
  if (initial.kind === 'interval') {
    type.value = 'interval';
    count.value = initial.count;
    unit.value = initial.unit;
  } else {
    type.value = 'calendar';
    cal_kind.value = initial.kind;
    every.value = initial.every;
    hour.value = initial.hour;
    minute.value = initial.minute;
    if (initial.kind === 'weekly') weekday.value = initial.weekday;
    else day.value = initial.day;
  }
}

function buildSpec(): RepeatSpec {
  if (type.value === 'interval') {
    return {
      kind: 'interval',
      count: count.value,
      unit: unit.value,
    };
  }
  if (cal_kind.value === 'weekly') {
    return {
      kind: 'weekly',
      every: every.value,
      weekday: weekday.value,
      hour: hour.value,
      minute: minute.value,
    };
  }
  return {
    kind: 'monthly',
    every: every.value,
    day: day.value,
    hour: hour.value,
    minute: minute.value,
  };
}

const enabled = computed({
  get: () => model.value !== null,
  set: (on: boolean) => {
    model.value = on ? buildSpec() : null;
  },
});

watch([type, count, unit, cal_kind, every, weekday, day, hour, minute], () => {
  if (model.value !== null) model.value = buildSpec();
});

const summary = computed(() => (model.value === null ? '' : describeRepeat(model.value)));
</script>

<style scoped>
.repeat-editor {
  margin-top: 16px;
}

.switch-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--on-surface);
}

.switch-label i {
  color: var(--secondary);
  font-size: 14px;
}

.controls {
  padding: 12px 4px 0;
}

.type-select,
.row-select {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.chip.selected {
  background-color: var(--secondary-container);
  color: var(--on-secondary-container);
  border-color: var(--secondary-container);
}

.interval-controls {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  gap: 16px;
}

.unit-select {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.unit-select button {
  padding: 5px 16px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--on-surface);
  text-align: left;
}

.unit-select button.selected {
  color: var(--primary);
  background-color: rgb(from var(--primary) r g b / 0.1);
}

.cycle {
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--on-surface);
  border: 1px solid var(--outline-variant);
}

.cycle.selected {
  background-color: var(--secondary-container);
  color: var(--on-secondary-container);
  border-color: var(--secondary-container);
}

.weekday {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
  border: 1px solid var(--outline-variant);
}

.weekday.selected {
  background-color: var(--primary);
  color: var(--on-primary);
  border-color: var(--primary);
}

.day-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 12px;
}

.day-label {
  color: var(--on-surface-variant);
  font-size: 14px;
}

.time-row {
  display: flex;
  justify-content: center;
}

.summary {
  text-align: center;
  color: var(--tertiary);
  margin-top: 12px;
}
</style>
