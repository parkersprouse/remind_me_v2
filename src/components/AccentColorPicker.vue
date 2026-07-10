<script setup lang="ts">
import { computed } from 'vue';
import { contrastingInk, PRESET_ACCENTS } from '../lib/theme';
import { useSettingsStore } from '../stores/settings';

/**
 * Seed color for the generated Material palette: a row of curated presets plus
 * a free-form swatch backed by the platform color dialog.
 */
const settings = useSettingsStore();

// <input type="color"> always reports lowercase, so compare on that footing.
const selected = computed(() => settings.accentColor.toLowerCase());

const isPreset = computed(() =>
  PRESET_ACCENTS.some((preset) => preset.hex.toLowerCase() === selected.value),
);

function pick(hex: string): void {
  settings.setAccentColor(hex.toLowerCase());
}

function pickCustom(event: Event): void {
  pick((event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="accent-picker">
    <span class="label text-label-medium">Accent Color</span>

    <div class="swatches" role="radiogroup" aria-label="Accent color">
      <button
        v-for="preset in PRESET_ACCENTS"
        :key="preset.hex"
        type="button"
        role="radio"
        :aria-checked="selected === preset.hex.toLowerCase()"
        :aria-label="preset.name"
        class="swatch"
        :class="{ selected: selected === preset.hex.toLowerCase() }"
        :style="{ backgroundColor: preset.hex, color: contrastingInk(preset.hex) }"
        @click="pick(preset.hex)"
      >
        <i
          v-if="selected === preset.hex.toLowerCase()"
          class="fa-solid fa-check"
          aria-hidden="true"
        ></i>
      </button>

      <!-- The swatch itself is the control; the input is the platform dialog. -->
      <label
        class="swatch custom"
        :class="{ selected: !isPreset }"
        :style="isPreset ? undefined : { backgroundColor: selected, color: contrastingInk(selected) }"
      >
        <i v-if="isPreset" class="fa-solid fa-eye-dropper" aria-hidden="true"></i>
        <i v-else class="fa-solid fa-check" aria-hidden="true"></i>
        <input
          type="color"
          :value="selected"
          aria-label="Custom accent color"
          @input="pickCustom"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.accent-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.label {
  color: var(--on-surface-variant);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.swatch {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 15px;
  border: 1px solid var(--outline-variant);
  transition: box-shadow 0.15s ease;
}

/* Ring sits outside the swatch so it reads against the container, not the seed */
.swatch.selected {
  box-shadow: 0 0 0 2px var(--surface-variant), 0 0 0 4px var(--on-surface-variant);
}

/* Unselected custom swatch advertises itself with the rainbow it can produce */
.custom:not(.selected) {
  background: conic-gradient(
    #f44336,
    #ffeb3b,
    #4caf50,
    #00bcd4,
    #2196f3,
    #9c27b0,
    #f44336
  );
  color: #ffffff;
}

.custom i {
  text-shadow: 0 0 3px rgb(0 0 0 / 0.45);
}

.custom.selected i {
  text-shadow: none;
}

/* The native color input is the tap target, invisible over its swatch */
.custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  border: none;
  padding: 0;
}
</style>
