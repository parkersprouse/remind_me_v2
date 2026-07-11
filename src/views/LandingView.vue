<template>
  <div class='landing'>
    <p class='text-body-large'>
      Remind Me! requires permission to send you notifications in order to help you schedule your
      reminders.
    </p>
    <p class='text-body-large second'>
      You may either allow Remind Me! to send you notifications, or exit the app.
    </p>

    <button v-if='denied' type='button' class='btn-filled' @click='openSettings'>
      Open Notification Settings
    </button>
    <button v-else type='button' class='btn-filled' @click='requestPermission'>
      Allow Notifications
    </button>

    <button type='button' class='btn-text exit' @click='exitApp'>Exit App</button>
  </div>
</template>

<script setup lang="ts">
import { exit } from '@tauri-apps/plugin-process';
import { ref } from 'vue';

import { permissions } from '~lib/notifications.ts';
import { useRouterStore } from '~stores/router.ts';

/**
 * Mirrors LandingPage: shown until notification permission is granted.
 * If the user denies the request, we offer the OS notification settings
 * instead (Flutter's "permanently denied" path).
 */
const router = useRouterStore();
const denied = ref(false);

declare global {
  interface Window {
    /**
     * Native bridge injected by MainActivity.kt (@JavascriptInterface): opens
     * this app's Android notification settings so the user can re-enable
     * notifications after denying them.
     */
    AndroidNative?: { openNotificationSettings: () => void; };
  }
}

async function requestPermission(): Promise<void> {
  if (await permissions.request()) {
    router.goTo('home');
  } else {
    denied.value = true;
  }
}

function openSettings(): void {
  window.AndroidNative?.openNotificationSettings();
}

async function exitApp(): Promise<void> {
  await exit(0);
}
</script>

<style scoped>
.landing {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  text-align: left;
}

p {
  margin: 0 0 20px;
  width: 100%;
}

p.second {
  margin-bottom: 30px;
}

.exit {
  margin-top: 12px;
}
</style>
