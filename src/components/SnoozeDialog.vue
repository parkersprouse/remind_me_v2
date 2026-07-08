<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import NumberPicker from './NumberPicker.vue';

/**
 * Custom snooze picker, opened when the "Custom…" action on a delivered
 * notification is tapped: the same number wheel + unit selector as the
 * settings "Modify Option" dialog, applied to a one-off snooze.
 */
const props = defineProps<{
  /** The reminder being snoozed, or null when closed. */
  request: { id: number; details: string } | null;
}>();

const emit = defineEmits<{
  save: [minutes: number];
  dismiss: [];
}>();

const value = ref(15);
const unit = ref<'minutes' | 'hours'>('minutes');

// Reset to the default snooze whenever the dialog opens for a new request.
watch(
  () => props.request,
  (request) => {
    if (request === null) return;
    value.value = 15;
    unit.value = 'minutes';
  },
);

const maxValue = computed(() => (unit.value === 'minutes' ? 59 : 23));

watch(unit, () => {
  value.value = Math.min(value.value, maxValue.value);
});

function save(): void {
  emit('save', unit.value === 'hours' ? value.value * 60 : value.value);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="request !== null" class="dialog-scrim" @click.self="emit('dismiss')">
        <div class="snooze-card" role="dialog" aria-modal="true">
          <div class="title">
            <i class="fa-regular fa-clock title-icon" aria-hidden="true"></i>
            <span class="text-title-large">Snooze Reminder</span>
          </div>
          <div class="divider"></div>

          <p v-if="request.details" class="details">{{ request.details }}</p>

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
            <button type="button" class="btn-filled save" @click="save">Snooze</button>
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

.snooze-card {
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

.details {
  color: var(--on-surface-variant);
  font-size: 14px;
  padding: 0 2px;
  margin: 0 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
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
