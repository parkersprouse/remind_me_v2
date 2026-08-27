import '@fortawesome/fontawesome-free/css/all.min.css';
// Side-effect import: keeps --safe-area-inset-top/bottom in sync with the
// Android system bars (Android WebView never populates env(safe-area-inset-*)).
import '@saurl/tauri-plugin-safe-area-insets-css-api';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from '@/App.vue';
import { registerAndroidBackHandler } from '~lib/androidBack.ts';
import { registerCreateRequestBridge } from '~lib/createRequest.ts';
import { notification_manager } from '~lib/notifications.ts';
import { syncVoiceWidgetAutoCreate } from '~lib/voiceReminder.ts';
import { initWidgetSnapshot } from '~lib/widget.ts';
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
  // Needs settings loaded; doesn't need notifications, so it can run
  // alongside init() below rather than waiting on it.
  syncVoiceWidgetAutoCreate();
  await notification_manager.init();
  // Needs settings (for scheduling) and notifications (for the channel)
  // ready before a fully-specified deep link is allowed to auto-create.
  registerCreateRequestBridge();
  // Before cleanExpired: a journalled reminder that already fired while the app
  // was closed needs its row present for the sweep to reason about it.
  await notification_manager.drainPendingOps();
  await notification_manager.cleanExpired();
  // Last: the first snapshot should describe the reminder list as it stands
  // after the drain and the sweep, not the rows they were about to change.
  initWidgetSnapshot();
})();
