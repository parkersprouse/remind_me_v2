<template>
  <div
    class='labeled-switch'
    role='switch'
    :aria-checked='modelValue'
    tabindex='0'
    @click='toggle'
    @keydown.enter.prevent='toggle'
    @keydown.space.prevent='toggle'
  >
    <span class='label'><slot /></span>
    <span class='switch' :class='{ on: modelValue }'>
      <span class='thumb'>
        <i :class="modelValue ? 'fa-solid fa-check' : 'fa-solid fa-xmark'" aria-hidden='true'/>
      </span>
    </span>
  </div>
</template>

<script setup lang="ts">
/**
 * Mirrors LabeledSwitch from the Flutter app: a row with a label on the left
 * and a Material switch (check/x thumb icons) on the right. Tapping anywhere
 * on the row toggles.
 */
const props = defineProps<{ modelValue: boolean; }>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; }>();

function toggle(): void {
  emit('update:modelValue', !props.modelValue);
}
</script>

<style scoped>
.labeled-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  cursor: pointer;
}

.label {
  flex: 1;
  min-width: 0;
}

.switch {
  flex-shrink: 0;
  position: relative;
  width: 52px;
  height: 32px;
  border-radius: 16px;
  border: 2px solid var(--outline);
  background-color: var(--surface-variant);
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.switch.on {
  background-color: var(--primary);
  border-color: var(--primary);
}

.thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: var(--outline);
  color: var(--surface-variant);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition: left 0.15s ease, background-color 0.15s ease;
}

.switch.on .thumb {
  left: 24px;
  background-color: var(--on-primary);
  color: var(--primary);
}
</style>
