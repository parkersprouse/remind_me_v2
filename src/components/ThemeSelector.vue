<template>
  <div class='theme-selector' role='radiogroup' aria-label='Theme'>
    <button
      v-for='segment in segments'
      :key='segment.value'
      type='button'
      role='radio'
      :aria-checked='settings.theme === segment.value'
      class='segment'
      :class='{ selected: settings.theme === segment.value }'
      @click='settings.setTheme(segment.value)'
    >
      <i :class='segment.icon' aria-hidden='true'/>
      {{ segment.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useSettingsStore } from '../stores/settings';

import type { ThemeMode } from '../stores/settings';

/**
 * Mirrors ThemeSelector: a Material segmented button for Light/Dark/System.
 * Icon fill flips with the active scheme like the Flutter version did.
 */
const settings = useSettingsStore();

const segments = computed<{
  value: ThemeMode;
  label: string;
  icon: string;
}[]>(() => [
  {
    value: 'light',
    label: 'Light',
    icon: settings.isDarkMode ? 'fa-solid fa-sun' : 'fa-regular fa-sun',
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: settings.isDarkMode ? 'fa-regular fa-moon' : 'fa-solid fa-moon',
  },
  {
    value: 'system',
    label: 'System',
    icon: 'fa-solid fa-circle-half-stroke',
  },
]);
</script>

<style scoped>
.theme-selector {
  display: flex;
  width: 100%;
  border: 1px solid var(--outline);
  border-radius: 100px;
  overflow: hidden;
}

.segment {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 4px;
  font-size: 15px;
  font-weight: 500;
  color: var(--on-surface);
  background-color: var(--surface);
  transition: background-color 0.15s ease;
}

.segment + .segment {
  border-left: 1px solid var(--outline);
}

.segment i {
  font-size: 12px;
}

.segment.selected {
  background-color: var(--secondary-container);
  color: var(--on-secondary-container);
}
</style>
