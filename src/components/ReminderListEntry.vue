<script setup lang="ts">
import { ref } from 'vue';
import { formatEpoch } from '../lib/format';
import type { Reminder } from '../lib/db';

/**
 * Mirrors ListEntry wrapped in a Dismissible: tap shows details, dragging
 * left (end-to-start only, like the Flutter app) reveals a delete background
 * and asks for confirmation past the threshold.
 */
const props = defineProps<{ reminder: Reminder }>();

const emit = defineEmits<{
  showDetails: [reminder: Reminder];
  requestDelete: [reminder: Reminder];
}>();

const DISMISS_THRESHOLD = 0.4;

const offsetX = ref(0);
const dragging = ref(false);

const rootEl = ref<HTMLElement | null>(null);
let startX = 0;
let startY = 0;
let pointerId: number | null = null;
let axisLocked: 'x' | 'y' | null = null;

function onPointerDown(event: PointerEvent): void {
  startX = event.clientX;
  startY = event.clientY;
  pointerId = event.pointerId;
  axisLocked = null;
  dragging.value = true;
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value || event.pointerId !== pointerId) return;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;

  if (axisLocked === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
    axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axisLocked === 'x') rootEl.value?.setPointerCapture(event.pointerId);
  }
  if (axisLocked !== 'x') return;

  // Only endToStart (leftward) swipes are allowed
  offsetX.value = Math.min(dx, 0);
}

function onPointerEnd(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  dragging.value = false;
  pointerId = null;

  const width = rootEl.value?.offsetWidth ?? 1;
  if (-offsetX.value > width * DISMISS_THRESHOLD) {
    emit('requestDelete', props.reminder);
  }
  offsetX.value = 0;
}

function onClick(): void {
  if (axisLocked === 'x') return; // Was a swipe, not a tap
  emit('showDetails', props.reminder);
}
</script>

<template>
  <div
    ref="rootEl"
    class="entry-wrap"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
  >
    <div class="delete-background" aria-hidden="true">
      <i class="fa-regular fa-trash-can"></i>
      <span>Delete</span>
    </div>
    <div
      class="entry"
      :class="{ dragging }"
      :style="{ transform: `translateX(${offsetX}px)` }"
      @click="onClick"
    >
      <div class="details-line">
        <i class="fa-regular fa-pen-to-square icon" aria-hidden="true"></i>
        <span class="details-text">{{ reminder.details }}</span>
      </div>
      <div class="meta-line">
        <i class="fa-regular fa-clock icon" aria-hidden="true"></i>
        <span>{{ formatEpoch(reminder.scheduledForEpochMillis) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entry-wrap {
  position: relative;
  overflow: hidden;
  touch-action: pan-y;
}

.delete-background {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-right: 20px;
  background-color: var(--error-container);
  color: var(--on-error-container);
  font-size: 20px;
  border-bottom: 1px solid var(--outline-variant);
}

.entry {
  position: relative;
  background-color: var(--surface);
  border-bottom: 1px solid var(--outline-variant);
  padding: 14px 16px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.entry.dragging {
  transition: none;
}

.entry:hover {
  background-color: rgb(from var(--on-surface) r g b / 0.04);
}

.details-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  min-width: 0;
}

.details-line .icon {
  font-size: 12px;
  flex-shrink: 0;
}

.details-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: rgb(from var(--on-surface) r g b / 0.66);
}

.meta-line .icon {
  font-size: 14px;
}
</style>
