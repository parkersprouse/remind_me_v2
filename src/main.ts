import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { registerAndroidBackHandler } from './lib/androidBack';
import { NotificationManager } from './lib/notifications';
import { useSettingsStore } from './stores/settings';

import '@fortawesome/fontawesome-free/css/all.min.css';

import './assets/styles/base.css';

// Side-effect import: keeps --safe-area-inset-top/bottom in sync with the
// Android system bars (Android WebView never populates env(safe-area-inset-*)).
import '@saurl/tauri-plugin-safe-area-insets-css-api';

// Mirrors the Flutter main(): mount the app first, then run the async
// initializers (settings, notifications, expired-reminder cleanup).
const app = createApp(App);
app.use(createPinia());
app.mount('#app');

// Needs the active Pinia set up by app.use() above.
registerAndroidBackHandler();

void (async () => {
  await useSettingsStore().load();
  await NotificationManager.init();
  await NotificationManager.cleanExpired();
})();
