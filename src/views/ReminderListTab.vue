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
        @showDetails='details_for = $event'
        @longPress='menu_for = $event'
      />
    </div>

    <!-- Reminder details dialog (tap on an entry) -->
    <AppDialog :open='details_for !== null' @dismiss='details_for = null'>
      <template #title>
        <i class='fa-regular fa-pen-to-square title-icon' aria-hidden='true'/>
        <span>Reminder Details</span>
      </template>
      <p class='details-body'>{{ details_for?.details }}</p>
      <template #actions>
        <button
          type='button'
          class='icon-btn'
          aria-label='Edit Reminder'
          @click='openEdit(details_for!)'
        >
          <i class='fa-regular fa-pen-to-square' aria-hidden='true'/>
        </button>
        <button
          type='button'
          class='icon-btn icon-btn-delete'
          aria-label='Delete Reminder'
          @click='requestDelete(details_for!)'
        >
          <i class='fa-regular fa-trash-can' aria-hidden='true'/>
        </button>
        <span class='actions-spacer'/>
        <button type='button' class='btn-text' @click='details_for = null'>Close</button>
      </template>
    </AppDialog>

    <!-- Context menu (long-press on an entry) -->
    <AppDialog :open='menu_for !== null' @dismiss='menu_for = null'>
      <template #title>
        <span class='menu-title'>{{ menu_for?.details }}</span>
      </template>
      <div class='menu-items'>
        <button type='button' class='menu-item' @click='openEdit(menu_for!)'>
          <i class='fa-regular fa-pen-to-square' aria-hidden='true'/>
          <span>Edit</span>
        </button>
        <button type='button' class='menu-item menu-item-delete' @click='requestDelete(menu_for!)'>
          <i class='fa-regular fa-trash-can' aria-hidden='true'/>
          <span>Delete</span>
        </button>
      </div>
    </AppDialog>

    <!-- Edit reminder dialog -->
    <EditReminderDialog :reminder='edit_for' @dismiss='edit_for = null' />

    <!-- Confirm deletion dialog -->
    <AppDialog :open='delete_for !== null' @dismiss='delete_for = null'>
      <template #title>
        <i class='fa-solid fa-circle-exclamation error-icon' aria-hidden='true'/>
        <span>Confirm Deletion</span>
      </template>
      <p>Are you sure you want to delete this Reminder?</p>
      <p class='warning'>This cannot be undone!</p>
      <template #actions>
        <button type='button' class='btn-text' @click='delete_for = null'>No</button>
        <button type='button' class='btn-text delete-confirm' @click='confirmDelete'>Yes</button>
      </template>
    </AppDialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

import AppDialog from '~components/AppDialog.vue';
import EditReminderDialog from '~components/EditReminderDialog.vue';
import ReminderListEntry from '~components/ReminderListEntry.vue';
import { details_request } from '~lib/createRequest.ts';
import { DB } from '~lib/db.ts';
import { notification_manager, onRemindersChanged } from '~lib/notifications.ts';
import { HomeTabs, useRouterStore } from '~stores/router.ts';

import type { Reminder } from '~lib/db.ts';

/**
 * Mirrors ListTab: reminder list with pull/press-to-refresh, a details dialog
 * (tap), a long-press context menu with edit/delete, an edit dialog, a delete
 * confirmation dialog, and an empty state.
 */
const router = useRouterStore();

const reminders = ref<Reminder[]>([]);
const loading = ref(true);

const details_for = ref<Reminder | null>(null);
const menu_for = ref<Reminder | null>(null);
const edit_for = ref<Reminder | null>(null);
const delete_for = ref<Reminder | null>(null);

/**
 * The in-flight reload, so a widget's details request can wait for it — see
 * applyDetailsRequest.
 */
let refreshing: Promise<void> | null = null;

async function getReminders(): Promise<void> {
  loading.value = true;
  refreshing = (async (): Promise<void> => {
    await notification_manager.cleanExpired();
    reminders.value = await DB.getAll();
  })();
  await refreshing;
  loading.value = false;
}

/**
 * Open the details dialog for the reminder a widget row asked for
 * (`remindme://reminders?id=N`, PLAN.md phase 6) — in-app parity with tapping
 * the same row inside the app.
 *
 * Resolved only once the launch reload settles, so a row cleanExpired() is
 * about to sweep isn't shown as though it were still scheduled. A miss is the
 * expected path and not an error: the reminder was deleted while the app was
 * closed, or it was a one-shot snoozed from a notification, which mints a
 * fresh id (repeating reminders keep theirs across fires). Landing on the
 * plain list is the right answer for that, the same as for an id Kotlin
 * refused to parse — which arrives here as no request at all.
 */
async function applyDetailsRequest(id: number | null): Promise<void> {
  if (id === null) return;
  details_request.value = null;
  await refreshing;
  details_for.value = await DB.getById(id);
}

// The context menu and the details dialog both route here.
function openEdit(reminder: Reminder): void {
  menu_for.value = null;
  details_for.value = null;
  edit_for.value = reminder;
}

function requestDelete(reminder: Reminder): void {
  menu_for.value = null;
  details_for.value = null;
  delete_for.value = reminder;
}

async function confirmDelete(): Promise<void> {
  const target = delete_for.value;
  delete_for.value = null;
  if (target === null) return;
  await notification_manager.cancel(target.id);
  await getReminders();
}

let unsubscribe: (() => void) | undefined;

async function syncReminders(): Promise<void> {
  reminders.value = await DB.getAll();
}

onMounted(() => {
  void getReminders();
  // Checked on mount, not just watched: a request delivered before this tab
  // was ever rendered (a cold start on the landing page, say) would otherwise
  // never be picked up — same reason NewReminderTab checks its prefill.
  void applyDetailsRequest(details_request.value);
  // Keep the list in sync when reminders fire/snooze/cancel/update elsewhere
  unsubscribe = onRemindersChanged(() => void syncReminders());
});

onUnmounted(() => unsubscribe?.());

// Stand-in for the Flutter RefreshIndicator: reload (and clean expired
// reminders) whenever this tab becomes the active one.
watch(
  () => router.homeTab,
  (tab) => {
    if (tab === HomeTabs.ScheduledReminders) void getReminders();
  },
);

// Deliberately registered after the tab watcher above: a warm deep link sets
// the id and *then* switches tabs, and watchers run in creation order, so the
// reload is already in flight by the time applyDetailsRequest awaits it.
watch(details_request, (id) => void applyDetailsRequest(id));

defineExpose({ refresh: getReminders });
</script>

<style scoped>
.list-tab {
  height: 100%;
  overflow-y: auto;
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
