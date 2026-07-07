<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import AppDialog from '../components/AppDialog.vue';
import ReminderListEntry from '../components/ReminderListEntry.vue';
import { NotificationManager, onRemindersChanged } from '../lib/notifications';
import type { Reminder } from '../lib/db';
import { DB } from '../lib/db';
import { useRouterStore } from '../stores/router';

/**
 * Mirrors ListTab: reminder list with pull/press-to-refresh, swipe-to-delete
 * with a confirmation dialog, a details dialog, and an empty state.
 */
const router = useRouterStore();

const reminders = ref<Reminder[]>([]);
const loading = ref(true);

const detailsFor = ref<Reminder | null>(null);
const deleteFor = ref<Reminder | null>(null);

async function getReminders(): Promise<void> {
  loading.value = true;
  await NotificationManager.cleanExpired();
  reminders.value = await DB.getAll();
  loading.value = false;
}

async function confirmDelete(): Promise<void> {
  const target = deleteFor.value;
  deleteFor.value = null;
  if (target === null) return;
  await NotificationManager.cancel(target.id);
  await getReminders();
}

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  void getReminders();
  // Keep the list in sync when reminders fire/snooze/cancel elsewhere
  unsubscribe = onRemindersChanged(() => {
    void (async () => {
      reminders.value = await DB.getAll();
    })();
  });
});

onUnmounted(() => unsubscribe?.());

// Stand-in for the Flutter RefreshIndicator: reload (and clean expired
// reminders) whenever this tab becomes the active one.
watch(
  () => router.homeTab,
  (tab) => {
    if (tab === 1) void getReminders();
  },
);

defineExpose({ refresh: getReminders });
</script>

<template>
  <div class="list-tab">
    <div v-if="loading" class="center-state">
      <span class="spinner" aria-label="Loading"></span>
    </div>

    <div v-else-if="reminders.length === 0" class="center-state empty">
      <i class="fa-regular fa-bell-slash empty-icon" aria-hidden="true"></i>
      <div class="empty-text text-headline-small">No Reminders Scheduled</div>
    </div>

    <div v-else class="entries">
      <ReminderListEntry
        v-for="reminder in reminders"
        :key="reminder.id"
        :reminder="reminder"
        @show-details="detailsFor = $event"
        @request-delete="deleteFor = $event"
      />
    </div>

    <!-- Reminder details dialog (tap on an entry) -->
    <AppDialog :open="detailsFor !== null" @dismiss="detailsFor = null">
      <template #title>
        <i class="fa-regular fa-pen-to-square title-icon" aria-hidden="true"></i>
        <span>Reminder Details</span>
      </template>
      <p class="details-body">{{ detailsFor?.details }}</p>
      <template #actions>
        <button type="button" class="btn-text" @click="detailsFor = null">Close</button>
      </template>
    </AppDialog>

    <!-- Confirm deletion dialog (swipe) -->
    <AppDialog :open="deleteFor !== null" @dismiss="deleteFor = null">
      <template #title>
        <i class="fa-solid fa-circle-exclamation error-icon" aria-hidden="true"></i>
        <span>Confirm Deletion</span>
      </template>
      <p>Are you sure you want to delete this Reminder?</p>
      <p class="warning">This cannot be undone!</p>
      <template #actions>
        <button type="button" class="btn-text" @click="deleteFor = null">No</button>
        <button type="button" class="btn-text delete-confirm" @click="confirmDelete">Yes</button>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
.list-tab {
  height: 100%;
  overflow-y: auto;
  border-left: 1px solid var(--outline-variant);
  /* This element is a scroll container, so HomeView's touch-action doesn't
     reach touches that start inside it: without pan-y here the webview
     claims horizontal drags (pointercancel) and tab swipes never complete. */
  touch-action: pan-y;
}

.center-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 25px;
}

.empty-icon {
  font-size: 75px;
  color: rgb(from var(--on-surface) r g b / 0.6);
}

.empty-text {
  color: rgb(from var(--on-surface) r g b / 0.6);
  text-align: center;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid transparent;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.title-icon {
  color: var(--outline);
  font-size: 20px;
}

.error-icon {
  color: var(--error);
  font-size: 22px;
}

.details-body {
  margin: 0;
  user-select: text;
  -webkit-user-select: text;
  overflow-wrap: anywhere;
}

p {
  margin: 0 0 16px;
}

.warning {
  color: var(--error);
  margin-bottom: 0;
}

.delete-confirm {
  background-color: var(--error-container);
  color: var(--on-error-container);
}
</style>
