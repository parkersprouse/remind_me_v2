import '@fortawesome/fontawesome-free/css/all.min.css';
// Side-effect import: keeps --safe-area-inset-top/bottom in sync with the
// Android system bars (Android WebView never populates env(safe-area-inset-*)).
import '@saurl/tauri-plugin-safe-area-insets-css-api';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from '@/App.vue';
import { registerAndroidBackHandler } from '~lib/androidBack.ts';
import { notification_manager } from '~lib/notifications.ts';
import { useSettingsStore } from '~stores/settings.ts';

import './assets/styles/base.css';

// Mirrors the Flutter main(): mount the app first, then run the async
// initializers (settings, notifications, expired-reminder cleanup).
const app = createApp(App);
app.use(createPinia());
app.mount('#app');

// Needs the active Pinia set up by app.use() above.
registerAndroidBackHandler();

void (async () => {
  await useSettingsStore().load();
  await notification_manager.init();
  await notification_manager.cleanExpired();
})();
