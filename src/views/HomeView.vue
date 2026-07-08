<script setup lang="ts">
import { computed, ref } from 'vue';
import NewReminderTab from './NewReminderTab.vue';
import ReminderListTab from './ReminderListTab.vue';
import { useRouterStore } from '../stores/router';

/**
 * Mirrors the Home TabBarView: both tabs stay mounted side by side in a
 * horizontal track that follows the finger while dragging (PageView-style).
 * Releasing inside the dead zone snaps back to the current page; dragging
 * past it commits the page change. Tab-bar taps and the Android back button
 * still drive router.homeTab directly and animate through the same track.
 */
const router = useRouterStore();

/**
 * Dead zone: fraction of the page width the drag must exceed to commit a
 * page change. Anything short of this snaps back to the current page.
 */
const SNAP_THRESHOLD = 0.3;
/**
 * Pointer travel (px) before the gesture is classified as a horizontal page
 * drag. Kept above ReminderListEntry's 10px move-cancel threshold so any
 * drag that claims the gesture has already cancelled a pending long-press.
 */
const DRAG_START_SLOP = 12;
/** Drag divisor past the first/last page (rubber-band resistance). */
const EDGE_RESISTANCE = 3;
/**
 * Minimum release velocity (px/s) for a flick to commit a page change even
 * inside the dead zone, mirroring Flutter's PageView fling. The flick
 * direction wins over drag distance, so a fast backward flick returns to the
 * original page even when the drag itself crossed the threshold.
 */
const FLICK_VELOCITY = 300;
/** Sliding window (ms) of pointer samples used to estimate release velocity. */
const VELOCITY_WINDOW_MS = 100;

const TAB_COUNT = 2;

const home = ref<HTMLElement | null>(null);

const dragOffset = ref(0);
const dragging = ref(false);

let pointerId = -1;
let startX = 0;
let startY = 0;
let tracking = false; // pointer is down but the gesture is unclassified
let didDrag = false; // suppresses the click that follows a drag

/** Recent pointer positions inside VELOCITY_WINDOW_MS, oldest first. */
let samples: { t: number; x: number }[] = [];

function pushSample(event: PointerEvent): void {
  samples.push({ t: event.timeStamp, x: event.clientX });
  while (samples.length > 1 && event.timeStamp - samples[0].t > VELOCITY_WINDOW_MS) {
    samples.shift();
  }
}

/**
 * Horizontal release velocity (px/s) over the sample window. A pointer that
 * paused before lifting reads as zero: its last move predates the window.
 */
function releaseVelocity(event: PointerEvent): number {
  const last = samples[samples.length - 1];
  if (last === undefined || event.timeStamp - last.t > VELOCITY_WINDOW_MS) return 0;
  const first = samples[0];
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return ((last.x - first.x) / dt) * 1000;
}

function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary) return;
  pointerId = event.pointerId;
  startX = event.clientX;
  startY = event.clientY;
  tracking = true;
  didDrag = false;
  samples = [{ t: event.timeStamp, x: event.clientX }];
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  pushSample(event);
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;

  if (!dragging.value) {
    if (!tracking) return;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_START_SLOP) return;
    // Direction lock: mostly-vertical movement belongs to native scrolling.
    if (Math.abs(dy) > Math.abs(dx)) {
      tracking = false;
      return;
    }
    dragging.value = true;
    didDrag = true;
    // Keep receiving moves when the finger leaves the element, and stop
    // routing them to children mid-drag.
    home.value?.setPointerCapture(pointerId);
  }

  const atStart = router.homeTab === 0 && dx > 0;
  const atEnd = router.homeTab === TAB_COUNT - 1 && dx < 0;
  dragOffset.value = atStart || atEnd ? dx / EDGE_RESISTANCE : dx;
}

function settle(commit: boolean, velocity = 0): void {
  if (commit) {
    const width = home.value?.clientWidth ?? window.innerWidth;
    let target = router.homeTab;
    if (Math.abs(velocity) >= FLICK_VELOCITY) {
      // Flick: velocity direction decides, regardless of distance dragged.
      target += velocity < 0 ? 1 : -1;
    } else if (Math.abs(dragOffset.value) >= width * SNAP_THRESHOLD) {
      target += dragOffset.value < 0 ? 1 : -1;
    }
    if (target !== router.homeTab && target >= 0 && target < TAB_COUNT) {
      router.setTab(target);
    }
  }
  // homeTab and dragOffset change in the same render, so the track's CSS
  // transition animates from the released position to the settled page.
  dragging.value = false;
  tracking = false;
  dragOffset.value = 0;
  pointerId = -1;
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  settle(dragging.value, releaseVelocity(event));
}

// The webview cancels the pointer stream when it claims the gesture for
// native scrolling; snap back rather than acting on a stale drag.
function onPointerCancel(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  settle(false);
}

// A drag released over a button would otherwise register as a tap on it.
function onClickCapture(event: MouseEvent): void {
  if (!didDrag) return;
  didDrag = false;
  event.preventDefault();
  event.stopPropagation();
}

const trackStyle = computed(() => ({
  transform: `translateX(calc(${-router.homeTab * 100}% + ${dragOffset.value}px))`,
}));
</script>

<template>
  <div
    ref="home"
    class="home"
    :class="{ dragging }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @click.capture="onClickCapture"
  >
    <div class="track" :style="trackStyle">
      <NewReminderTab class="tab-page" />
      <ReminderListTab class="tab-page" />
    </div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  overflow: hidden;
  /* Keep horizontal drags in the pointer-event stream (the Android webview
     would otherwise claim them and fire pointercancel before pointerup),
     while still allowing native vertical scrolling of the reminder list. */
  touch-action: pan-y;
}

.home.dragging {
  user-select: none;
  -webkit-user-select: none;
}

.track {
  display: flex;
  height: 100%;
  width: 100%;
  transition: transform 300ms cubic-bezier(0.2, 0, 0, 1);
  will-change: transform;
}

.home.dragging .track {
  transition: none;
}

.tab-page {
  flex: 0 0 100%;
  min-width: 0;
  height: 100%;
}
</style>
