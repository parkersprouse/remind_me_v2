<script setup lang="ts">
import { ref } from 'vue';

/**
 * Mirrors DetailsInput: outlined multiline text field with floating label,
 * prefix icon, and a 240-character counter.
 */
const MAX_LENGTH = 240;

const model = defineModel<string>({ required: true });
const focused = ref(false);
</script>

<template>
  <div class="details-input" :class="{ focused }">
    <label class="floating-label" for="reminder-details">Reminder Details</label>
    <div class="field">
      <i class="fa-regular fa-pen-to-square prefix" aria-hidden="true"></i>
      <textarea
        id="reminder-details"
        v-model="model"
        :maxlength="MAX_LENGTH"
        rows="5"
        placeholder="What would you like to be reminded of?"
        @focus="focused = true"
        @blur="focused = false"
      ></textarea>
    </div>
    <div class="counter text-label-small">{{ model.length }}/{{ MAX_LENGTH }}</div>
  </div>
</template>

<style scoped>
.details-input {
  position: relative;
}

.field {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--outline);
  border-radius: 4px;
  padding: 14px 12px;
  background-color: transparent;
  transition: border-color 0.15s ease;
}

.details-input.focused .field {
  border-color: var(--primary);
  outline: 1px solid var(--primary);
}

.floating-label {
  position: absolute;
  top: -11px;
  left: 12px;
  padding: 0 4px;
  background-color: var(--surface);
  font-size: 15px;
  color: var(--on-surface-variant);
  z-index: 1;
}

.details-input.focused .floating-label {
  color: var(--primary);
}

.prefix {
  color: var(--secondary);
  font-size: 18px;
  padding-top: 3px;
}

textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--on-surface);
  font-size: 16px;
  line-height: 1.4;
}

textarea::placeholder {
  color: rgb(from var(--on-surface) r g b / 0.5);
}

.counter {
  text-align: right;
  color: var(--on-surface-variant);
  margin-top: 4px;
  padding-right: 4px;
}
</style>
