<script setup lang="ts">
import { ref, watch } from 'vue';
import NewReminderTab from './NewReminderTab.vue';
import ReminderListTab from './ReminderListTab.vue';
import { useRouterStore } from '../stores/router';

/**
 * Mirrors the Home TabBarView: two tabs kept alive simultaneously
 * (KeepAlive-cached) with horizontal swipe navigation between them.
 */
const router = useRouterStore();

const tabComponents = [NewReminderTab, ReminderListTab];

const slideDirection = ref<'slide-left' | 'slide-right'>('slide-left');

// Pre-render watch: advancing to a higher tab index slides in from the right.
watch(
  () => router.homeTab,
  (to, from) => {
    slideDirection.value = to > from ? 'slide-left' : 'slide-right';
  },
);

let startX = 0;
let startY = 0;
let tracking = false;

function onPointerDown(event: PointerEvent): void {
  startX = event.clientX;
  startY = event.clientY;
  tracking = true;
}

function onPointerUp(event: PointerEvent): void {
  if (!tracking) return;
  tracking = false;
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;

  // Leftward swipe advances to the list tab, rightward returns to the form.
  if (dx < 0 && router.homeTab === 0) router.setTab(1);
  else if (dx > 0 && router.homeTab === 1) router.setTab(0);
}
</script>

<template>
  <div class="home" @pointerdown="onPointerDown" @pointerup="onPointerUp">
    <Transition :name="slideDirection">
      <KeepAlive>
        <component :is="tabComponents[router.homeTab]" :key="router.homeTab" class="tab-page" />
      </KeepAlive>
    </Transition>
  </div>
</template>

<style scoped>
.home,
.tab-page {
  height: 100%;
}

.home {
  position: relative;
  overflow: hidden;
}
</style>
