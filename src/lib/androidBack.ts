import { useRouterStore } from '../stores/router';

/**
 * Bridge for the Android hardware/gesture back action. MainActivity.kt
 * intercepts back presses and synchronously evaluates
 * `window.androidBackHandler()` in the webview: a `true` result means the
 * frontend consumed the press (in-app navigation happened), anything else
 * tells the activity to move the app to the background.
 */

declare global {
  interface Window {
    androidBackHandler?: () => boolean;
  }
}

export function registerAndroidBackHandler(): void {
  window.androidBackHandler = () => useRouterStore().back();
}
