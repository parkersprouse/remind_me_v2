<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * Material-style time picker ("input" layout: hour/minute fields with an
 * AM/PM toggle). The Flutter app used the dial entry mode; the input mode is
 * the closest practical equivalent for mouse + touch in a webview.
 */
const props = defineProps<{
  open: boolean;
  /** 24h clock */
  hour: number;
  minute: number;
}>();

const emit = defineEmits<{
  select: [hour: number, minute: number];
  dismiss: [];
}>();

const hourText = ref('12');
const minuteText = ref('00');
const meridiem = ref<'AM' | 'PM'>('AM');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const h12 = props.hour % 12 === 0 ? 12 : props.hour % 12;
    hourText.value = String(h12);
    minuteText.value = String(props.minute).padStart(2, '0');
    meridiem.value = props.hour >= 12 ? 'PM' : 'AM';
  },
);

const parsedHour = computed(() => Number.parseInt(hourText.value, 10));
const parsedMinute = computed(() => Number.parseInt(minuteText.value, 10));

const isValid = computed(
  () =>
    Number.isInteger(parsedHour.value) &&
    parsedHour.value >= 1 &&
    parsedHour.value <= 12 &&
    Number.isInteger(parsedMinute.value) &&
    parsedMinute.value >= 0 &&
    parsedMinute.value <= 59,
);

function confirm(): void {
  if (!isValid.value) return;
  let hour24 = parsedHour.value % 12;
  if (meridiem.value === 'PM') hour24 += 12;
  emit('select', hour24, parsedMinute.value);
  emit('dismiss');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-scrim" @click.self="emit('dismiss')">
        <div class="picker-card" role="dialog" aria-modal="true">
          <div class="help text-label-medium">Select time</div>

          <div class="fields">
            <input
              v-model="hourText"
              class="time-field"
              type="text"
              inputmode="numeric"
              maxlength="2"
              aria-label="Hour"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <span class="colon">:</span>
            <input
              v-model="minuteText"
              class="time-field"
              type="text"
              inputmode="numeric"
              maxlength="2"
              aria-label="Minute"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <span class="meridiem">
              <button
                type="button"
                :class="{ selected: meridiem === 'AM' }"
                @click="meridiem = 'AM'"
              >
                AM
              </button>
              <button
                type="button"
                :class="{ selected: meridiem === 'PM' }"
                @click="meridiem = 'PM'"
              >
                PM
              </button>
            </span>
          </div>

          <div class="field-labels">
            <span class="text-label-small">Hour</span>
            <span class="text-label-small">Minute</span>
          </div>

          <div class="actions">
            <button type="button" class="btn-text" @click="emit('dismiss')">Cancel</button>
            <button type="button" class="btn-filled confirm" :disabled="!isValid" @click="confirm">
              Select
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

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
  max-width: 320px;
  padding: 20px 24px 12px;
  box-shadow: 0 8px 24px rgb(from var(--shadow) r g b / 0.35);
}

.help {
  color: var(--on-surface-variant);
  margin-bottom: 16px;
}

.fields {
  display: flex;
  align-items: center;
  gap: 8px;
}

.time-field {
  width: 80px;
  height: 68px;
  text-align: center;
  font-size: 32px;
  font-family: inherit;
  color: var(--on-surface);
  background-color: var(--surface-variant);
  border: none;
  border-radius: 8px;
  outline: 2px solid transparent;
}

.time-field:focus {
  background-color: rgb(from var(--primary) r g b / 0.15);
  outline-color: var(--primary);
  color: var(--primary);
}

.colon {
  font-size: 32px;
}

.meridiem {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--outline);
  border-radius: 8px;
  overflow: hidden;
  margin-left: 4px;
}

.meridiem button {
  padding: 6px 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--on-surface);
}

.meridiem button:first-child {
  border-bottom: 1px solid var(--outline);
}

.meridiem button.selected {
  background-color: var(--tertiary-container);
  color: var(--on-tertiary-container);
}

.field-labels {
  display: flex;
  gap: 96px;
  color: var(--on-surface-variant);
  margin-top: 6px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
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
