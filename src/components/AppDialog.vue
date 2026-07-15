<template>
  <Teleport to='body'>
    <Transition name='dialog'>
      <div v-if='open' class='dialog-scrim' @click.self="emit('dismiss')">
        <div class='dialog-card' role='dialog' aria-modal='true'>
          <div v-if='$slots.title' class='dialog-title'>
            <slot name='title' />
          </div>
          <div class='dialog-divider'/>
          <div class='dialog-content'>
            <slot />
          </div>
          <div v-if='$slots.actions' class='dialog-actions'>
            <slot name='actions' />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Material AlertDialog equivalent: centered card over a scrim, dismissed by
 * clicking the scrim (barrierDismissible: true in the Flutter app).
 */
defineProps<{ open: boolean; }>();

const emit = defineEmits<{ dismiss: []; }>();
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

.dialog-card {
  background-color: var(--surface);
  border-radius: 28px;
  min-width: 280px;
  max-width: 420px;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgb(from var(--shadow) r g b / 0.35);
}

.dialog-title {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 20px 12px;
  font-size: 22px;
}

.dialog-divider {
  border-top: 1px solid var(--divider);
  margin: 0 18px;
}

.dialog-content {
  padding: 18px 18px 12px;
  overflow-y: auto;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
}

.actions-spacer {
  flex: 1;
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
