<template>
  <div class='list-tab'>
    <div v-if='loading' class='center-state'>
      <span class='spinner' aria-label='Loading'/>
    </div>

    <div v-else-if='reminders.length === 0' class='center-state empty'>
      <i class='fa-regular fa-bell-slash empty-icon' aria-hidden='true'/>
      <div class='empty-text text-headline-small'>No Reminders Scheduled</div>
    </div>

    <div v-else class='entries'>
      <ReminderListEntry
        v-for='reminder in reminders'
        :key='reminder.id'
        :reminder='reminder'
        @show-details='detailsFor = $event'
        @long-press='menuFor = $event'
      />
    </div>

    <!-- Reminder details dialog (tap on an entry) -->
    <AppDialog :open='detailsFor !== null' @dismiss='detailsFor = null'>
      <template #title>
        <i class='fa-regular fa-pen-to-square title-icon' aria-hidden='true'/>
        <span>Reminder Details</span>
      </template>
      <p class='details-body'>{{ detailsFor?.details }}</p>
      <template #actions>
        <button
          type='button'
          class='icon-btn'
          aria-label='Edit Reminder'
          @click='openEdit(detailsFor!)'
        >
          <i class='fa-regular fa-pen-to-square' aria-hidden='true'/>
        </button>
        <button
          type='button'
          class='icon-btn icon-btn-delete'
          aria-label='Delete Reminder'
          @click='requestDelete(detailsFor!)'
        >
          <i class='fa-regular fa-trash-can' aria-hidden='true'/>
        </button>
        <span class='actions-spacer'/>
        <button type='button' class='btn-text' @click='detailsFor = null'>Close</button>
      </template>
    </AppDialog>

    <!-- Context menu (long-press on an entry) -->
    <AppDialog :open='menuFor !== null' @dismiss='menuFor = null'>
      <template #title>
        <span class='menu-title'>{{ menuFor?.details }}</span>
      </template>
      <div class='menu-items'>
        <button type='button' class='menu-item' @click='openEdit(menuFor!)'>
          <i class='fa-regular fa-pen-to-square' aria-hidden='true'/>
          <span>Edit</span>
        </button>
        <button type='button' class='menu-item menu-item-delete' @click='requestDelete(menuFor!)'>
          <i class='fa-regular fa-trash-can' aria-hidden='true'/>
          <span>Delete</span>
        </button>
      </div>
    </AppDialog>

    <!-- Edit reminder dialog -->
    <EditReminderDialog :reminder='editFor' @dismiss='editFor = null' />

    <!-- Confirm deletion dialog -->
    <AppDialog :open='deleteFor !== null' @dismiss='deleteFor = null'>
      <template #title>
        <i class='fa-solid fa-circle-exclamation error-icon' aria-hidden='true'/>
        <span>Confirm Deletion</span>
      </template>
      <p>Are you sure you want to delete this Reminder?</p>
      <p class='warning'>This cannot be undone!</p>
      <template #actions>
        <button type='button' class='btn-text' @click='deleteFor = null'>No</button>
        <button type='button' class='btn-text delete-confirm' @click='confirmDelete'>Yes</button>
      </template>
    </AppDialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

import AppDialog from '../components/AppDialog.vue';
import EditReminderDialog from '../components/EditReminderDialog.vue';
import ReminderListEntry from '../components/ReminderListEntry.vue';
import { DB } from '../lib/db';
import { NotificationManager, onRemindersChanged } from '../lib/notifications';
import { useRouterStore } from '../stores/router';

import type { Reminder } from '../lib/db';

/**
 * Mirrors ListTab: reminder list with pull/press-to-refresh, a details dialog
 * (tap), a long-press context menu with edit/delete, an edit dialog, a delete
 * confirmation dialog, and an empty state.
 */
const router = useRouterStore();

const reminders = ref<Reminder[]>([]);
const loading = ref(true);

const detailsFor = ref<Reminder | null>(null);
const menuFor = ref<Reminder | null>(null);
const editFor = ref<Reminder | null>(null);
const deleteFor = ref<Reminder | null>(null);

async function getReminders(): Promise<void> {
  loading.value = true;
  await NotificationManager.cleanExpired();
  reminders.value = await DB.getAll();
  loading.value = false;
}

// The context menu and the details dialog both route here.
function openEdit(reminder: Reminder): void {
  menuFor.value = null;
  detailsFor.value = null;
  editFor.value = reminder;
}

function requestDelete(reminder: Reminder): void {
  menuFor.value = null;
  detailsFor.value = null;
  deleteFor.value = reminder;
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
  // Keep the list in sync when reminders fire/snooze/cancel/update elsewhere
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

.icon-btn {
  padding: 8px 12px;
  border-radius: 50%;
  font-size: 18px;
  color: var(--on-surface-variant);
}

.icon-btn-delete {
  color: var(--error);
}

.actions-spacer {
  flex: 1;
}

.menu-title {
  font-size: 16px;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 16px;
  color: var(--on-surface);
  text-align: left;
}

.menu-item:hover {
  background-color: rgb(from var(--on-surface) r g b / 0.06);
}

.menu-item-delete {
  color: var(--error);
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
