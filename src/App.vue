<template>
  <div class='app-shell' :class="{ 'no-tab-bar': router.page !== Pages.Home }">
    <header class='app-bar'>
      <button
        v-if='router.on_settings_page'
        type='button'
        class='icon-button'
        aria-label='Back'
        @click='router.goTo(Pages.Home)'
      >
        <i class='fa-solid fa-arrow-left' aria-hidden='true'/>
      </button>
      <span class='title text-title-large'>{{ router.page_title }}</span>
      <span class='actions'>
        <button
          v-if='is_dev'
          type='button'
          class='icon-button'
          aria-label='Send test notification'
          @click='debugNotification'
        >
          <i class='fa-solid fa-message' aria-hidden='true'/>
        </button>
        <button
          v-if='router.on_home_page'
          type='button'
          class='icon-button'
          aria-label='Settings'
          @click='router.goTo(Pages.Settings)'
        >
          <i class='fa-solid fa-gear' aria-hidden='true'/>
        </button>
      </span>
    </header>

    <main class='content'>
      <KeepAlive>
        <component :is='page_components[router.page]' :key='router.page' class='page' />
      </KeepAlive>
    </main>

    <nav v-if='router.on_home_page' class='tab-bar'>
      <button
        type='button'
        class='tab'
        :class='{ active: router.on_new_reminder_tab }'
        @click='router.setTab(HomeTabs.NewReminder)'
      >
        <BadgedIcon
          icon='fa-solid fa-bell'
          badge='fa-solid fa-circle-plus'
          :active='router.on_new_reminder_tab'
          :size='22'
        />
        <span>New Reminder</span>
        <span class='indicator' aria-hidden='true'/>
      </button>
      <button
        type='button'
        class='tab'
        :class='{ active: router.on_scheduled_reminders_tab }'
        @click='router.setTab(HomeTabs.ScheduledReminders)'
      >
        <i class='fa-solid fa-list-ul tab-icon' aria-hidden='true'/>
        <span>Scheduled Reminders</span>
        <span class='indicator' aria-hidden='true'/>
      </button>
    </nav>

    <SnoozeDialog :request='custom_snooze_request' @save='snoozeCustom' @dismiss='dismissSnooze' />

    <ToasterHost />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

import BadgedIcon from '~components/BadgedIcon.vue';
import SnoozeDialog from '~components/SnoozeDialog.vue';
import ToasterHost from '~components/ToasterHost.vue';
import { custom_snooze_request, notification_manager, permissions } from '~lib/notifications.ts';
import { applyDynamicColor } from '~lib/theme.ts';
import { ERROR_TOAST, SUCCESS_TOAST, toaster } from '~lib/toaster.ts';
import {
  HomeTabs,
  Pages,
  useRouterStore,
} from '~stores/router.ts';
import { useSettingsStore } from '~stores/settings.ts';
import HomeView from '~views/HomeView.vue';
import LandingView from '~views/LandingView.vue';
import SettingsView from '~views/SettingsView.vue';

import type { Component } from 'vue';
import type { Page } from '~stores/router.ts';

declare global {
  interface Window {
    /**
     * Bridge target for MainActivity.kt's onResume: re-checks the notification
     * permission so returning from system settings progresses off the landing
     * page. See onResume() below.
     */
    androidResume?: () => void;
  }
}

const router = useRouterStore();
const settings = useSettingsStore();

const is_dev = import.meta.env.DEV;

const slide_direction = ref<'slide-left' | 'slide-right'>('slide-left');

/* eslint-disable sort-keys */
const page_components: Record<Page, Component> = {
  landing: LandingView,
  home: HomeView,
  settings: SettingsView,
};

/** Depth of each page in the navigation flow, used to pick a slide direction. */
const page_order: Record<Page, number> = {
  landing: 0,
  home: 1,
  settings: 2,
};
/* eslint-enable sort-keys */

/**
 * Permission gate, mirroring Home._handlePermissionCheck: route to the
 * landing page whenever notifications are not permitted, and away from it
 * once they are.
 */
async function checkPermission(): Promise<void> {
  const granted = await permissions.status();
  if (!granted && router.page !== Pages.Landing) {
    router.goTo(Pages.Landing);
  } else if (granted && router.on_landing_page) {
    router.goTo(Pages.Home);
  }
}

/**
 * Mirrors didChangeAppLifecycleState: re-check permission on resume. Driven by
 * the native onResume bridge (MainActivity.kt) rather than the DOM `window`
 * "focus" event, which does not fire when the Android Activity resumes — so
 * granting the permission in system settings and returning now progresses the
 * user off the landing page automatically.
 */
function onResume(): void {
  void checkPermission();
  // Picks up snoozes taken from the drawer while the app sat in the background
  // (they never reached the webview — see drainSnoozeJournal).
  void notification_manager.drainSnoozeJournal();
  if (router.on_home_page) router.setTab(HomeTabs.NewReminder);
}

function debugNotification(): void {
  void notification_manager.schedule(new Date(Date.now() + 1000), 'Debug Mode Test');
}

/** Custom snooze flow: the "Custom…" notification action set this request. */
function dismissSnooze(): void {
  custom_snooze_request.value = null;
}

async function snoozeCustom(minutes: number): Promise<void> {
  const request = custom_snooze_request.value;
  custom_snooze_request.value = null;
  if (request === null) return;

  try {
    await notification_manager.snooze(request.id, minutes);
  } catch (err) {
    console.error('Failed to snooze reminder', err);
    toaster.show('Failed to Snooze Reminder', ERROR_TOAST);
    return;
  }

  toaster.show('Reminder Snoozed', SUCCESS_TOAST);
}

// Runs pre-render, so the transition name is set before the page swap happens:
// navigating deeper slides the new page in from the right, going back reverses it.
watch(
  () => router.page,
  (to, from) => {
    slide_direction.value = page_order[to] > page_order[from] ? 'slide-left' : 'slide-right';
  },
);

// Theme handling: data-theme drives color-scheme and the static fallback in
// theme.css, while the accent seed regenerates the Material palette on top of
// it. Runs immediately with the defaults, then again once settings.load()
// hydrates the persisted accent.
watch(
  () => [settings.resolvedTheme, settings.accentColor] as const,
  ([theme, accent]) => {
    document.documentElement.dataset.theme = theme;
    applyDynamicColor(accent, theme);
  },
  { immediate: true },
);

onMounted(() => {
  void checkPermission();
  window.androidResume = onResume;
});

onUnmounted(() => {
  delete window.androidResume;
});
</script>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Without the tab bar the content itself borders the Android navigation bar,
   so the shell absorbs the bottom inset instead. */
.app-shell.no-tab-bar {
  padding-bottom: var(--safe-area-inset-bottom);
}

/* The Flutter app bar was hardcoded black with dark-scheme foreground */
.app-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  background-color: #000000;
  color: var(--dark-on-surface-variant);
  /* Extend the black bar behind the Android status bar / camera cutout */
  padding: var(--safe-area-inset-top) 8px 0 16px;
  height: calc(56px + var(--safe-area-inset-top));
}

.title {
  flex: 1;
  color: var(--dark-on-surface-variant);
}

.icon-button {
  color: var(--dark-on-surface-variant);
  font-size: 18px;
  padding: 10px 12px;
  border-radius: 50%;
}

.app-bar .icon-button:hover {
  background-color: rgb(from var(--dark-on-surface-variant) r g b / 0.12);
}

.actions {
  display: flex;
  align-items: center;
}

.content {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.page {
  height: 100%;
}

.tab-bar {
  flex-shrink: 0;
  display: flex;
  border-top: 1px solid var(--outline-variant);
  background-color: var(--surface);
  /* Extend the bar's surface behind the Android navigation bar */
  padding-bottom: var(--safe-area-inset-bottom);
}

.tab {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 8px 14px;
  font-size: 14px;
  font-weight: 500;
  color: var(--on-surface-variant);
}

.tab-icon {
  font-size: 22px;
}

.tab.active {
  color: var(--primary);
}

.indicator {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background-color: transparent;
}

.tab.active .indicator {
  background-color: var(--primary);
}
</style>
