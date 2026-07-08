<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue';
import BadgedIcon from './components/BadgedIcon.vue';
import ToasterHost from './components/ToasterHost.vue';
import LandingView from './views/LandingView.vue';
import HomeView from './views/HomeView.vue';
import SettingsView from './views/SettingsView.vue';
import { NotificationManager, Permissions } from './lib/notifications';
import { useRouterStore, type Page } from './stores/router';
import { useSettingsStore } from './stores/settings';

const router = useRouterStore();
const settings = useSettingsStore();

const isDev = import.meta.env.DEV;

const pageTitle = computed(() => (router.page === 'settings' ? 'Settings' : 'Remind Me!'));

const pageComponents: Record<Page, Component> = {
  landing: LandingView,
  home: HomeView,
  settings: SettingsView,
};

/** Depth of each page in the navigation flow, used to pick a slide direction. */
const pageOrder: Record<Page, number> = { landing: 0, home: 1, settings: 2 };

const slideDirection = ref<'slide-left' | 'slide-right'>('slide-left');

// Runs pre-render, so the transition name is set before the page swap happens:
// navigating deeper slides the new page in from the right, going back reverses it.
watch(
  () => router.page,
  (to, from) => {
    slideDirection.value = pageOrder[to] > pageOrder[from] ? 'slide-left' : 'slide-right';
  },
);

// With page transitions disabled, fall back to a name with no CSS rules:
// Vue finds no transition styles and swaps the pages instantly.
const pageTransitionName = computed(() =>
  settings.pageTransitions ? slideDirection.value : 'page-swap-off',
);

// Theme handling: settings drive the data-theme attribute the CSS reads.
watch(
  () => settings.resolvedTheme,
  (theme) => {
    document.documentElement.dataset.theme = theme;
  },
  { immediate: true },
);

/**
 * Permission gate, mirroring Home._handlePermissionCheck: route to the
 * landing page whenever notifications are not permitted, and away from it
 * once they are.
 */
async function checkPermission(): Promise<void> {
  const granted = await Permissions.status();
  if (!granted && router.page !== 'landing') {
    router.goTo('landing');
  } else if (granted && router.page === 'landing') {
    router.goTo('home');
  }
}

/** Mirrors didChangeAppLifecycleState: re-check permission on resume. */
function onFocus(): void {
  void checkPermission();
  if (router.page === 'home') router.setTab(0);
}

onMounted(() => {
  void checkPermission();
  window.addEventListener('focus', onFocus);
});

onUnmounted(() => window.removeEventListener('focus', onFocus));

function debugNotification(): void {
  void NotificationManager.schedule(new Date(Date.now() + 1000), 'Debug Mode Test');
}
</script>

<template>
  <div class="app-shell" :class="{ 'no-tab-bar': router.page !== 'home' }">
    <header class="app-bar">
      <button
        v-if="router.page === 'settings'"
        type="button"
        class="icon-button"
        aria-label="Back"
        @click="router.goTo('home')"
      >
        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
      </button>
      <span class="title text-title-large">{{ pageTitle }}</span>
      <span class="actions">
        <button
          v-if="isDev"
          type="button"
          class="icon-button"
          aria-label="Send test notification"
          @click="debugNotification"
        >
          <i class="fa-solid fa-message" aria-hidden="true"></i>
        </button>
        <button
          v-if="router.page === 'home'"
          type="button"
          class="icon-button"
          aria-label="Settings"
          @click="router.goTo('settings')"
        >
          <i class="fa-solid fa-gear" aria-hidden="true"></i>
        </button>
      </span>
    </header>

    <!-- IndexedStack equivalent: KeepAlive caches every page's state while
         Transition slides the outgoing and incoming pages past each other -->
    <main class="content">
      <Transition :name="pageTransitionName">
        <KeepAlive>
          <component :is="pageComponents[router.page]" :key="router.page" class="page" />
        </KeepAlive>
      </Transition>
    </main>

    <nav v-if="router.page === 'home'" class="tab-bar">
      <button
        type="button"
        class="tab"
        :class="{ active: router.homeTab === 0 }"
        @click="router.setTab(0)"
      >
        <BadgedIcon icon="fa-solid fa-bell" badge="fa-solid fa-circle-plus" :size="22" />
        <span>New Reminder</span>
        <span class="indicator" aria-hidden="true"></span>
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: router.homeTab === 1 }"
        @click="router.setTab(1)"
      >
        <i class="fa-solid fa-list-ul tab-icon" aria-hidden="true"></i>
        <span>Scheduled Reminders</span>
        <span class="indicator" aria-hidden="true"></span>
      </button>
    </nav>

    <ToasterHost />
  </div>
</template>

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
