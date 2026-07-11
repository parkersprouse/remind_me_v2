<template>
  <Transition name='toast'>
    <div v-if='toasterState.current' class='toast'>
      <i
        v-if='toasterState.current.icon'
        :class='toasterState.current.icon'
        :style="{ color: toasterState.current.iconColor ?? 'var(--dark-primary)' }"
        aria-hidden='true'
      />
      <span class='message'>{{ toasterState.current.message }}</span>
      <button type='button' class='close' aria-label='Close' @click='Toaster.dismiss()'>
        <i class='fa-solid fa-xmark' aria-hidden='true'/>
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { Toaster, toasterState } from '../lib/toaster';
</script>

<style scoped>
/* Always dark-scheme colored, matching the Flutter Toaster */
.toast {
  position: fixed;
  left: 20px;
  right: 20px;
  bottom: 20px;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 10px;
  background-color: var(--dark-surface-variant);
  color: var(--dark-on-surface);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 18px;
  box-shadow: 0 6px 20px rgb(from var(--shadow) r g b / 0.4);
}

.message {
  flex: 1;
  padding: 6px;
}

.close {
  color: rgb(from var(--dark-on-surface) r g b / 0.5);
  font-size: 16px;
  padding: 4px;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
