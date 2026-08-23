<template>
  <div
    class='entry'
    @pointerdown='onPointerDown'
    @pointermove='onPointerMove'
    @pointerup='onPointerEnd'
    @pointercancel='onPointerEnd'
    @click='onClick'
    @contextmenu.prevent
  >
    <div class='details-line'>
      <i class='fa-regular fa-pen-to-square icon' aria-hidden='true'/>
      <span class='details-text'>{{ reminder.details }}</span>
    </div>
    <div class='meta-line'>
      <i
        :class="repeat_spec ? 'fa-solid fa-repeat icon' : 'fa-regular fa-clock icon'"
        aria-hidden='true'
      />
      <span>{{ meta_text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { formatEpoch, formatRelative, relative_clock } from '~lib/format.ts';
import { describeRepeat, parseRepeat } from '~lib/repeat.ts';
import { useSettingsStore } from '~stores/settings.ts';

import type { Reminder } from '~lib/db.ts';

/**
 * List entry: tap shows details, long-press (~500ms hold) opens the entry's
 * context menu (edit/delete). Movement past a small threshold — a scroll or
 * tab swipe — cancels the pending long-press.
 */
const props = defineProps<{ reminder: Reminder; }>();

const emit = defineEmits<{
  showDetails: [reminder: Reminder];
  longPress: [reminder: Reminder];
}>();

const settings = useSettingsStore();

// Repeating reminders show their rule instead of a timestamp: the OS keeps
// re-firing them, so a stored one-shot date would immediately go stale.
const repeat_spec = computed(() => parseRepeat(props.reminder.repeat));

// relative_clock.value is read only so this recomputes as time passes when
// the relative-time setting is on; formatEpoch never goes stale, so the
// absolute branch has no such dependency.
const meta_text = computed(() => {
  if (repeat_spec.value) return describeRepeat(repeat_spec.value);
  if (settings.showRelativeTime) {
    return formatRelative(props.reminder.scheduledForEpochMillis, relative_clock.value);
  }
  return formatEpoch(props.reminder.scheduledForEpochMillis);
});

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

let start_x = 0;
let start_y = 0;
let press_timer: ReturnType<typeof setTimeout> | null = null;
let long_press_fired = false;

function clearPressTimer(): void {
  if (press_timer !== null) {
    clearTimeout(press_timer);
    press_timer = null;
  }
}

function onPointerDown(event: PointerEvent): void {
  start_x = event.clientX;
  start_y = event.clientY;
  long_press_fired = false;
  clearPressTimer();
  press_timer = setTimeout(() => {
    press_timer = null;
    long_press_fired = true;
    emit('longPress', props.reminder);
  }, LONG_PRESS_MS);
}

function onPointerMove(event: PointerEvent): void {
  if (press_timer === null) return;
  if (
    Math.abs(event.clientX - start_x) > MOVE_CANCEL_PX ||
    Math.abs(event.clientY - start_y) > MOVE_CANCEL_PX
  ) {
    clearPressTimer();
  }
}

function onPointerEnd(): void {
  clearPressTimer();
}

function onClick(): void {
  // The release after a long-press still produces a click; swallow it.
  if (long_press_fired) return;
  emit('showDetails', props.reminder);
}
</script>

<style scoped>
.entry {
  background-color: var(--surface);
  border-bottom: 1px solid var(--outline-variant);
  padding: 14px 16px;
  cursor: pointer;
  touch-action: pan-y;
  /* Long-press must open the context menu, not start a text selection */
  -webkit-user-select: none;
  user-select: none;
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
