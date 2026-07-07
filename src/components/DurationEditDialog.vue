<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import NumberPicker from './NumberPicker.vue';
import { parseDurationString, type DurationOption } from '../lib/duration';

/**
 * Mirrors the "Modify Option" dialog from the Flutter settings page: a
 * number wheel plus a minutes/hours unit selector.
 */
const props = defineProps<{
  /** The option being edited, or null when closed. */
  option: DurationOption | null;
}>();

const emit = defineEmits<{
  save: [value: number, unit: 'minutes' | 'hours'];
  dismiss: [];
}>();

const value = ref(1);
const unit = ref<'minutes' | 'hours'>('minutes');

watch(
  () => props.option,
  (option) => {
    if (option === null) return;
    // Same semantics as the Flutter dialog: hours + minutes collapse into a
    // single number, and the unit follows whichever part was set.
    const [hours, minutes] = parseDurationString(option.raw);
    value.value = hours + minutes;
    unit.value = hours > 0 ? 'hours' : 'minutes';
  },
);

const maxValue = computed(() => (unit.value === 'minutes' ? 59 : 23));

watch(unit, () => {
  value.value = Math.min(value.value, maxValue.value);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="option !== null" class="dialog-scrim" @click.self="emit('dismiss')">
        <div class="edit-card" role="dialog" aria-modal="true">
          <div class="title">
            <i class="fa-solid fa-pencil title-icon" aria-hidden="true"></i>
            <span class="text-title-large">Modify Option</span>
          </div>
          <div class="divider"></div>

          <div class="controls">
            <NumberPicker v-model="value" :min="1" :max="maxValue" />
            <div class="unit-select">
              <button
                type="button"
                :class="{ selected: unit === 'minutes' }"
                @click="unit = 'minutes'"
              >
                Minutes
              </button>
              <button
                type="button"
                :class="{ selected: unit === 'hours' }"
                @click="unit = 'hours'"
              >
                Hours
              </button>
            </div>
          </div>

          <div class="actions">
            <button type="button" class="btn-text" @click="emit('dismiss')">Close</button>
            <button type="button" class="btn-filled save" @click="emit('save', value, unit)">
              Save
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

.edit-card {
  background-color: var(--surface);
  border-radius: 28px;
  width: 100%;
  max-width: 320px;
  padding: 20px 18px 12px;
  box-shadow: 0 8px 24px rgb(from var(--shadow) r g b / 0.35);
}

.title {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px 12px;
}

.title-icon {
  color: var(--secondary);
  font-size: 17px;
}

.divider {
  border-top: 1px solid var(--divider);
  margin-bottom: 10px;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  gap: 16px;
  padding: 10px 0;
}

.unit-select {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.unit-select button {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 18px;
  font-weight: 500;
  color: var(--on-surface);
  text-align: left;
}

.unit-select button.selected {
  color: var(--primary);
  background-color: rgb(from var(--primary) r g b / 0.1);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
}

.save {
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
