<template>
  <Teleport to='body'>
    <Transition name='dialog'>
      <div v-if='open' class='dialog-scrim' @click.self="emit('dismiss')">
        <div class='picker-card' role='dialog' aria-modal='true'>
          <div class='help text-label-medium'>Select time</div>

          <div v-if="mode === 'dial'" class='fields'>
            <button
              type='button'
              class='time-display'
              :class="{ active: stage === 'hour' }"
              aria-label='Select hour'
              @click="stage = 'hour'"
            >
              {{ dialHour }}
            </button>
            <span class='colon'>:</span>
            <button
              type='button'
              class='time-display'
              :class="{ active: stage === 'minute' }"
              aria-label='Select minute'
              @click="stage = 'minute'"
            >
              {{ String(dialMinute).padStart(2, '0') }}
            </button>
            <span class='meridiem'>
              <button
                type='button'
                :class="{ selected: meridiem === 'AM' }"
                @click="meridiem = 'AM'"
              >
                AM
              </button>
              <button
                type='button'
                :class="{ selected: meridiem === 'PM' }"
                @click="meridiem = 'PM'"
              >
                PM
              </button>
            </span>
          </div>

          <div v-else class='fields'>
            <input
              v-model='hourText'
              class='time-field'
              type='text'
              inputmode='numeric'
              maxlength='2'
              aria-label='Hour'
              @focus='($event.target as HTMLInputElement).select()'
            >
            <span class='colon'>:</span>
            <input
              v-model='minuteText'
              class='time-field'
              type='text'
              inputmode='numeric'
              maxlength='2'
              aria-label='Minute'
              @focus='($event.target as HTMLInputElement).select()'
            >
            <span class='meridiem'>
              <button
                type='button'
                :class="{ selected: meridiem === 'AM' }"
                @click="meridiem = 'AM'"
              >
                AM
              </button>
              <button
                type='button'
                :class="{ selected: meridiem === 'PM' }"
                @click="meridiem = 'PM'"
              >
                PM
              </button>
            </span>
          </div>

          <div v-if="mode === 'input'" class='field-labels'>
            <span class='text-label-small'>Hour</span>
            <span class='text-label-small'>Minute</span>
          </div>

          <svg
            v-if="mode === 'dial'"
            ref='dialEl'
            class='dial'
            :viewBox='`0 0 ${SIZE} ${SIZE}`'
            xmlns='http://www.w3.org/2000/svg'
            @pointerdown='onDialPointerDown'
            @pointermove='onDialPointerMove'
            @pointerup='onDialPointerUp'
            @pointercancel='onDialPointerCancel'
          >
            <circle class='dial-face' :cx='CENTER' :cy='CENTER' :r='CENTER' />
            <circle class='dial-hand' :cx='CENTER' :cy='CENTER' r='4' />
            <line
              class='dial-hand-line'
              :x1='CENTER'
              :y1='CENTER'
              :x2='knob.x'
              :y2='knob.y'
            />
            <circle class='dial-hand' :cx='knob.x' :cy='knob.y' :r='KNOB_R' />
            <circle v-if='knobDot' class='dial-knob-dot' :cx='knob.x' :cy='knob.y' r='2' />
            <template v-if="stage === 'hour'">
              <text
                v-for='cell in hourCells'
                :key='cell.value'
                class='dial-num'
                :class='{ selected: cell.value === dialHour }'
                :x='cell.x'
                :y='cell.y'
              >
                {{ cell.label }}
              </text>
            </template>
            <template v-else>
              <text
                v-for='cell in minuteCells'
                :key='cell.value'
                class='dial-num'
                :class='{ selected: cell.value === dialMinute }'
                :x='cell.x'
                :y='cell.y'
              >
                {{ cell.label }}
              </text>
            </template>
          </svg>

          <div class='actions'>
            <button
              type='button'
              class='mode-toggle'
              :aria-label="mode === 'dial' ? 'Switch to text input' : 'Switch to dial'"
              @click='toggleMode'
            >
              <i
                :class="mode === 'dial' ? 'fa-regular fa-keyboard' : 'fa-regular fa-clock'"
                aria-hidden='true'
              />
            </button>
            <button type='button' class='btn-text' @click="emit('dismiss')">Cancel</button>
            <button type='button' class='btn-filled confirm' :disabled='!isValid' @click='confirm'>
              Select
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * Material-style time picker. Defaults to the dial entry mode (matching the
 * Flutter app): a two-stage clock face (hour, then minute) with a digital
 * hour/minute display and AM/PM toggle. The keyboard button in the bottom-left
 * swaps to the input layout (hour/minute text fields) and back.
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

const mode = ref<'dial' | 'input'>('dial');
const stage = ref<'hour' | 'minute'>('hour');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const h12 = props.hour % 12 === 0 ? 12 : props.hour % 12;
    hourText.value = String(h12);
    minuteText.value = String(props.minute).padStart(2, '0');
    meridiem.value = props.hour >= 12 ? 'PM' : 'AM';
    mode.value = 'dial';
    stage.value = 'hour';
  },
);

const parsedHour = computed(() => Number.parseInt(hourText.value, 10));
const parsedMinute = computed(() => Number.parseInt(minuteText.value, 10));

const isValid = computed(() =>
  Number.isInteger(parsedHour.value) &&
  parsedHour.value >= 1 &&
  parsedHour.value <= 12 &&
  Number.isInteger(parsedMinute.value) &&
  parsedMinute.value >= 0 &&
  parsedMinute.value <= 59);

function confirm(): void {
  if (!isValid.value) return;
  let hour24 = parsedHour.value % 12;
  if (meridiem.value === 'PM') hour24 += 12;
  emit('select', hour24, parsedMinute.value);
  emit('dismiss');
}

// ---- Dial ----

const SIZE = 256;
const CENTER = SIZE / 2;
const NUMBER_R = 100;
const KNOB_R = 18;

function pos(angleDeg: number, radius: number): {
  x: number;
  y: number;
} {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.sin(rad),
    y: CENTER - radius * Math.cos(rad),
  };
}

const hourCells = Array.from({ length: 12 }, (_, i) => {
  const value = i + 1;
  return {
    value,
    label: String(value),
    ...pos(value * 30, NUMBER_R),
  };
});

const minuteCells = Array.from({ length: 12 }, (_, i) => {
  const value = i * 5;
  return {
    value,
    label: String(value).padStart(2, '0'),
    ...pos(value * 6, NUMBER_R),
  };
});

// The dial always needs a renderable value, even while the text fields hold
// garbage in input mode; fall back to 12:00.
const dialHour = computed(() => {
  const h = parsedHour.value;
  return Number.isInteger(h) && h >= 1 && h <= 12 ? h : 12;
});
const dialMinute = computed(() => {
  const m = parsedMinute.value;
  return Number.isInteger(m) && m >= 0 && m <= 59 ? m : 0;
});

const handAngle = computed(() =>
  stage.value === 'hour' ? (dialHour.value % 12) * 30 : dialMinute.value * 6);
const knob = computed(() => pos(handAngle.value, NUMBER_R));
// A minute off the 5-minute marks gets a small dot inside the knob instead of
// covering a number (standard Material behavior).
const knobDot = computed(() => stage.value === 'minute' && dialMinute.value % 5 !== 0);

const dialEl = ref<SVGSVGElement | null>(null);
let dialDragging = false;

function applyFromEvent(event: PointerEvent): void {
  const rect = dialEl.value?.getBoundingClientRect();
  if (!rect) return;
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  const angle = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360;

  if (stage.value === 'hour') {
    const h = Math.round(angle / 30) % 12;
    hourText.value = String(h === 0 ? 12 : h);
  } else {
    const m = Math.round(angle / 6) % 60;
    minuteText.value = String(m).padStart(2, '0');
  }
}

function onDialPointerDown(event: PointerEvent): void {
  dialDragging = true;
  dialEl.value?.setPointerCapture(event.pointerId);
  applyFromEvent(event);
}

function onDialPointerMove(event: PointerEvent): void {
  if (!dialDragging) return;
  applyFromEvent(event);
}

function onDialPointerUp(): void {
  if (!dialDragging) return;
  dialDragging = false;
  // Material dials auto-advance from hour to minute selection
  if (stage.value === 'hour') stage.value = 'minute';
}

function onDialPointerCancel(): void {
  dialDragging = false;
}

function toggleMode(): void {
  if (mode.value === 'dial') {
    mode.value = 'input';
    return;
  }
  // Entering the dial: normalize whatever the text fields hold into values
  // the dial can render.
  hourText.value = String(dialHour.value);
  minuteText.value = String(dialMinute.value).padStart(2, '0');
  mode.value = 'dial';
  stage.value = 'hour';
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

.time-display {
  width: 80px;
  height: 68px;
  text-align: center;
  font-size: 32px;
  font-family: inherit;
  color: var(--on-surface);
  background-color: var(--surface-variant);
  border-radius: 8px;
  outline: 2px solid transparent;
}

.time-display.active {
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

.dial {
  display: block;
  width: 100%;
  max-width: 256px;
  margin: 20px auto 4px;
  touch-action: none;
  cursor: pointer;
}

.dial-face {
  fill: var(--surface-variant);
}

.dial-hand {
  fill: var(--primary);
}

.dial-hand-line {
  stroke: var(--primary);
  stroke-width: 2;
}

.dial-knob-dot {
  fill: var(--on-primary);
}

.dial-num {
  fill: var(--on-surface);
  font-size: 15px;
  text-anchor: middle;
  dominant-baseline: central;
  user-select: none;
  pointer-events: none;
}

.dial-num.selected {
  fill: var(--on-primary);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
}

.mode-toggle {
  margin-right: auto;
  padding: 8px 10px;
  border-radius: 50%;
  font-size: 18px;
  color: var(--on-surface-variant);
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
