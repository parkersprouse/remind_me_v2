/**
 * Typing for the JS → native bridge injected by MainActivity.kt as
 * `window.AndroidNative` (@JavascriptInterface). The backup methods launch
 * async system document pickers; their outcome comes back through
 * `window.androidBackupResult` (see backup.ts), not a return value.
 */
export interface AndroidNativeBridge {
  /**
   * Opens this app's Android notification settings so the user can re-enable
   * notifications after denying them (LandingView's "permanently denied" path).
   */
  openNotificationSettings: () => void;
  /**
   * Launches the system "create document" picker and writes `json` to the
   * file the user chooses.
   */
  exportBackup: (json: string, fileName: string) => void;
  /** Launches the system "open document" picker and reads the chosen file. */
  importBackup: () => void;
  /**
   * Returns (and clears) the snoozes SnoozeActionReceiver.kt performed while
   * the frontend was not running, as a JSON array string. Synchronous, unlike
   * the backup pickers — see drainSnoozeJournal in notifications.ts.
   */
  takeSnoozeJournal: () => string;
}

declare global {
  interface Window {
    AndroidNative?: AndroidNativeBridge;
  }
}
