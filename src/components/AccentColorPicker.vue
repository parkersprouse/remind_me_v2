<template>
  <div class='accent-picker'>
    <span class='label text-label-medium'>Accent Color</span>

    <div class='swatches' role='radiogroup' aria-label='Accent color'>
      <button
        v-for='preset in PRESET_ACCENTS'
        :key='preset.hex'
        type='button'
        role='radio'
        :aria-checked='selected === preset.hex.toLowerCase()'
        :aria-label='preset.name'
        class='swatch'
        :class='{ selected: selected === preset.hex.toLowerCase() }'
        :style='{ backgroundColor: preset.hex, color: contrastingInk(preset.hex) }'
        @click='pick(preset.hex)'
      >
        <i
          v-if='selected === preset.hex.toLowerCase()'
          class='fa-solid fa-check'
          aria-hidden='true'
        />
      </button>

      <button
        type='button'
        role='radio'
        :aria-checked='!is_preset'
        aria-label='Custom accent color'
        class='swatch custom'
        :class='{ selected: !is_preset }'
        :style='is_preset ? undefined : { backgroundColor: selected, color: contrastingInk(selected) }'
        @click='custom_open = true'
      >
        <i v-if='is_preset' class='fa-solid fa-eye-dropper' aria-hidden='true'/>
        <i v-else class='fa-solid fa-check' aria-hidden='true'/>
      </button>
    </div>

    <ColorPickerDialog
      :open='custom_open'
      :initial='selected'
      @save='saveCustom'
      @dismiss='custom_open = false'
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import ColorPickerDialog from '~components/ColorPickerDialog.vue';
import { contrastingInk, PRESET_ACCENTS } from '~lib/theme.ts';
import { useSettingsStore } from '~stores/settings.ts';


/**
 * Seed color for the generated Material palette: a row of curated presets plus
 * a free-form swatch backed by <ColorPickerDialog>. The presets are the only
 * suggestions on offer -- the custom swatch opens straight onto the accent
 * currently in use, so nudging it is a short drag rather than a hunt.
 */
const settings = useSettingsStore();

// Hexes are compared lowercased; the picker and the presets agree on that form.
const selected = computed(() => settings.accentColor.toLowerCase());

const is_preset = computed(() =>
  PRESET_ACCENTS.some((preset) => preset.hex.toLowerCase() === selected.value));

const custom_open = ref(false);

function pick(hex: string): void {
  settings.setAccentColor(hex.toLowerCase());
}

function saveCustom(hex: string): void {
  pick(hex);
  custom_open.value = false;
}
</script>

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
</style>
