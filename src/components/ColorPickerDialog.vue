<template>
  <AppDialog :open='open' @dismiss="emit('dismiss')">
    <template #title>
      <i class='fa-solid fa-eye-dropper title-icon' aria-hidden='true'/>
      <span class='text-title-large'>Custom Color</span>
    </template>

    <div class='picker'>
      <!-- Doubles as the preview and the readout of the value being edited. -->
      <div class='preview' :style='{ backgroundColor: hex, color: ink }'>
        <span class='preview-hex'>{{ hex }}</span>
        <button
          type='button'
          class='copy'
          :style='{ color: ink }'
          aria-label='Copy hex value'
          @click='copyHex'
        >
          <i class='fa-regular fa-copy' aria-hidden='true'/>
        </button>
      </div>

      <div class='modes' role='tablist' aria-label='Color entry mode'>
        <button
          v-for='option in MODES'
          :key='option.id'
          type='button'
          role='tab'
          :aria-selected='mode === option.id'
          class='mode'
          :class='{ selected: mode === option.id }'
          @click='mode = option.id'
        >
          <i :class='option.icon' aria-hidden='true'/>
          <span>{{ option.label }}</span>
        </button>
      </div>

      <div v-if="mode === 'wheel'" class='pane'>
        <div
          ref='wheel'
          class='wheel'
          role='application'
          aria-label='Color wheel: angle sets hue, distance from center sets saturation'
          @pointerdown='startWheelDrag'
          @pointermove='continueWheelDrag'
        >
          <!-- Value is a black veil rather than a third gradient: HSV scales
               every channel by v, which is exactly what compositing black at
               1 - v alpha does. -->
          <div class='wheel-veil' :style='{ opacity: 1 - hsv.v }'/>
          <div class='wheel-thumb' :style='thumb_style'/>
        </div>

        <label class='slider-row'>
          <span class='slider-label'>Brightness</span>
          <input
            type='range'
            min='0'
            max='1'
            step='0.001'
            :value='hsv.v'
            :style='{ backgroundImage: value_track }'
            @input='setValue'
          >
        </label>
      </div>

      <div v-else-if="mode === 'rgb'" class='pane'>
        <label v-for='channel in CHANNELS' :key='channel.key' class='slider-row'>
          <span class='slider-label'>{{ channel.label }}</span>
          <input
            type='range'
            min='0'
            max='255'
            step='1'
            :value='rgb[channel.key]'
            :style='{ backgroundImage: channelTrack(channel.key) }'
            @input='setChannel(channel.key, ($event.target as HTMLInputElement).value)'
          >
          <input
            type='number'
            class='channel-value'
            inputmode='numeric'
            min='0'
            max='255'
            :value='rgb[channel.key]'
            :aria-label='channel.label'
            @input='setChannel(channel.key, ($event.target as HTMLInputElement).value)'
          >
        </label>
      </div>

      <div v-else class='pane'>
        <label class='hex-row'>
          <span class='slider-label'>Hex</span>
          <input
            type='text'
            class='hex-input'
            :class='{ invalid: !hex_draft_valid }'
            :value='hex_draft'
            maxlength='7'
            spellcheck='false'
            autocapitalize='off'
            autocomplete='off'
            aria-label='Hex color value'
            @input='setHex'
            @blur='normalizeHex'
          >
        </label>
        <p class='hex-hint'>Three or six digits, with or without the leading #.</p>
      </div>
    </div>

    <template #actions>
      <button type='button' class='btn-text' @click="emit('dismiss')">Cancel</button>
      <button type='button' class='btn-filled select' @click="emit('save', hex)">Select</button>
    </template>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import {
  clamp,
  formatHex,
  hsvToHex,
  hsvToRgb,
  parseHex,
  rgbToHsv,
} from '../lib/color.ts';
import { contrastingInk } from '../lib/theme.ts';
import { toaster } from '../lib/toaster.ts';

import AppDialog from './AppDialog.vue';

import type { Channel, HSV, RGB } from '../lib/color.ts';

/**
 * In-app accent color picker. Replaces `<input type="color">`, whose platform
 * dialog cannot be seeded with the current color and pads itself with its own
 * suggestion swatches (the preset row already plays that role).
 */
const props = defineProps<{
  open: boolean;
  initial: string;
}>();

const emit = defineEmits<{
  save: [hex: string];
  dismiss: [];
}>();

type Mode = 'wheel' | 'rgb' | 'hex';

const MODES: {
  id: Mode;
  label: string;
  icon: string;
}[] = [
  {
    id: 'wheel',
    label: 'Wheel',
    icon: 'fa-solid fa-circle-half-stroke',
  },
  {
    id: 'rgb',
    label: 'RGB',
    icon: 'fa-solid fa-sliders',
  },
  {
    id: 'hex',
    label: 'Hex',
    icon: 'fa-solid fa-hashtag',
  },
];

const CHANNELS: {
  key: Channel;
  label: string;
}[] = [
  {
    key: 'r',
    label: 'R',
  },
  {
    key: 'g',
    label: 'G',
  },
  {
    key: 'b',
    label: 'B',
  },
];

const mode = ref<Mode>('wheel');

/**
 * `rgb` is the canonical value; `hsv` is the wheel's own state. Every
 * interaction writes one and derives the other, rather than syncing both ways.
 * Re-deriving `hsv` from `rgb` on each render would drop the hue of any
 * neutral color (chroma 0 has no angle), and re-deriving `rgb` from a rounded
 * `hsv` would drift the value away from the color the dialog opened on.
 */
const rgb = reactive<RGB>({
  r: 0,
  g: 0,
  b: 0,
});
const hsv = reactive<HSV>({
  h: 0,
  s: 0,
  v: 0,
});

/** Free-text buffer, so a half-typed hex is not rewritten mid-keystroke. */
const hex_draft = ref('');

const hex = computed(() => formatHex(rgb));
const ink = computed(() => contrastingInk(hex.value));
const hex_draft_valid = computed(() => parseHex(hex_draft.value) !== null);

/** Full-brightness twin of the current color: the top end of the value slider. */
const value_track = computed(() => `linear-gradient(to right, #000000, ${hsvToHex({
  h: hsv.h,
  s: hsv.s,
  v: 1,
})})`);

/** Where the wheel thumb sits, in percent of the wheel box. */
const thumb_style = computed(() => {
  const radians = (hsv.h * Math.PI) / 180;
  return {
    left: `${50 + Math.cos(radians) * hsv.s * 50}%`,
    top: `${50 + Math.sin(radians) * hsv.s * 50}%`,
    backgroundColor: hex.value,
  };
});

function commitRgb(next: RGB): void {
  Object.assign(rgb, next);
  Object.assign(hsv, rgbToHsv(next));
  hex_draft.value = formatHex(next);
}

function commitHsv(next: HSV): void {
  Object.assign(hsv, next);
  Object.assign(rgb, hsvToRgb(next));
  hex_draft.value = formatHex(rgb);
}

// Seed from the accent in use, whichever swatch it came from.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    commitRgb(parseHex(props.initial) ?? {
      r: 0,
      g: 0,
      b: 0,
    });
    mode.value = 'wheel';
  },
  { immediate: true },
);

const wheel = ref<HTMLElement | null>(null);

function trackPointer(event: PointerEvent): void {
  const element = wheel.value;
  if (element === null) return;

  const bounds = element.getBoundingClientRect();
  const radius = bounds.width / 2;
  const x = event.clientX - bounds.left - radius;
  const y = event.clientY - bounds.top - radius;

  commitHsv({
    // Screen y grows downward, so atan2 grows clockwise -- the same direction
    // the `from 90deg` conic gradient paints, with hue 0 at 3 o'clock.
    h: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
    s: clamp(Math.hypot(x, y) / radius, 0, 1),
    v: hsv.v,
  });
}

function startWheelDrag(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  trackPointer(event);
}

function continueWheelDrag(event: PointerEvent): void {
  // `buttons` is 0 unless a contact is down, which filters plain hover moves.
  if (event.buttons !== 0) trackPointer(event);
}

function setValue(event: Event): void {
  commitHsv({
    h: hsv.h,
    s: hsv.s,
    v: Number((event.target as HTMLInputElement).value),
  });
}

function setChannel(key: Channel, raw: string): void {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return;

  const next: RGB = { ...rgb };
  next[key] = clamp(Math.round(parsed), 0, 255);
  commitRgb(next);
}

/** The gradient a channel slider sweeps: this color with that channel 0 -> 255. */
function channelTrack(key: Channel): string {
  const low: RGB = {
    ...rgb,
    [key]: 0,
  };
  const high: RGB = {
    ...rgb,
    [key]: 255,
  };
  return `linear-gradient(to right, ${formatHex(low)}, ${formatHex(high)})`;
}

/**
 * Typing goes to the draft first and only lands once it parses, so `#abc` is
 * not expanded to `#aabbcc` under the caret while it is still being typed.
 */
function setHex(event: Event): void {
  hex_draft.value = (event.target as HTMLInputElement).value;

  const parsed = parseHex(hex_draft.value);
  if (parsed === null) return;

  Object.assign(rgb, parsed);
  Object.assign(hsv, rgbToHsv(parsed));
}

function normalizeHex(): void {
  hex_draft.value = hex.value;
}

async function copyHex(): Promise<void> {
  try {
    await navigator.clipboard.writeText(hex.value);
    toaster.show(`Copied ${hex.value}`, {
      icon: 'fa-solid fa-circle-check',
      iconColor: '#4caf50',
    });
  } catch (err) {
    console.error('Failed to copy accent color', err);
    toaster.show('Failed to Copy Color', {
      icon: 'fa-solid fa-circle-exclamation',
      iconColor: '#f44336',
    });
  }
}
</script>

<style scoped>
.title-icon {
  color: var(--secondary);
  font-size: 17px;
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-radius: 12px;
  border: 1px solid var(--outline-variant);
  padding: 10px 8px 10px 16px;
}

.preview-hex {
  font-family: ui-monospace, 'SF Mono', 'Roboto Mono', monospace;
  font-size: 18px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  user-select: text;
  -webkit-user-select: text;
}

.copy {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  font-size: 16px;
  transition: background-color 0.15s ease;
}

.copy:active {
  background-color: rgb(from currentcolor r g b / 0.14);
}

.modes {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 32px;
  background-color: rgb(from var(--on-surface) r g b / 0.05);
}

.mode {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 4px;
  border-radius: 32px;
  font-size: 14px;
  font-weight: 500;
  color: var(--on-surface-variant);
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.mode.selected {
  background-color: var(--secondary-container);
  color: var(--on-secondary-container);
}

/* Every pane occupies the same box, so switching modes never resizes the card */
.pane {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  min-height: 280px;
}

.wheel {
  position: relative;
  width: min(240px, 100%);
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 50%;
  border: 1px solid var(--outline-variant);
  /* Saturation is a white veil over the hue ring: at radius r the white alpha
     is 1 - r/R, so the composite is hue*s + white*(1-s) -- HSV's own
     definition. Hue 0 sits at 3 o'clock to match atan2. */
  background-image:
    radial-gradient(circle closest-side, #ffffff, rgb(255 255 255 / 0)),
    conic-gradient(from 90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
  /* Without this the WebView claims the drag for its own pan gesture. */
  touch-action: none;
}

.wheel-veil {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background-color: #000000;
  pointer-events: none;
}

.wheel-thumb {
  position: absolute;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 3px solid #ffffff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.slider-row,
.hex-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.slider-label {
  flex: none;
  width: 76px;
  color: var(--on-surface-variant);
  font-size: 14px;
  font-weight: 500;
}

.slider-row input[type='range'] {
  flex: 1;
  min-width: 0;
  height: 20px;
  margin: 0;
  border-radius: 10px;
  border: 1px solid var(--outline-variant);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  appearance: none;
  -webkit-appearance: none;
  touch-action: none;
}

.slider-row input[type='range']::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: transparent;
  border: 3px solid #ffffff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
}

.channel-value {
  flex: none;
  width: 60px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: transparent;
  color: var(--on-surface);
  font-size: 15px;
  text-align: center;
  appearance: textfield;
  -moz-appearance: textfield;
}

.channel-value::-webkit-inner-spin-button,
.channel-value::-webkit-outer-spin-button {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
}

.channel-value:focus,
.hex-input:focus {
  outline: none;
  border-color: var(--primary);
}

.hex-input {
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: transparent;
  color: var(--on-surface);
  font-family: ui-monospace, 'SF Mono', 'Roboto Mono', monospace;
  font-size: 18px;
  letter-spacing: 0.06em;
  user-select: text;
  -webkit-user-select: text;
}

.hex-input.invalid {
  border-color: var(--error);
  color: var(--error);
}

.hex-hint {
  margin: 0;
  color: var(--on-surface-variant);
  font-size: 13px;
}

.select {
  font-size: 15px;
  padding: 8px 16px;
}
</style>
