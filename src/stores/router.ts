import { defineStore } from 'pinia';

/**
 * Mirrors RouterModel from the Flutter app: a tiny page switcher over an
 * IndexedStack-style view stack (no URL routing needed).
 */

export type Page = 'landing' | 'home' | 'settings';

export const useRouterStore = defineStore('router', {
  state: () => ({
    page: 'landing' as Page,
    /** Active tab on the Home page: 0 = New Reminder, 1 = Scheduled Reminders */
    homeTab: 0,
  }),

  actions: {
    goTo(page: Page) {
      this.page = page;
    },

    setTab(index: number) {
      this.homeTab = index;
    },

    /**
     * Android back-button policy. Returns true when the press was consumed by
     * in-app navigation, false when the app should be sent to the background.
     * Settings only opens from Home and never touches homeTab, so going back
     * to 'home' lands on whichever tab the user left.
     */
    back(): boolean {
      if (this.page === 'settings') {
        this.page = 'home';
        return true;
      }
      if (this.page === 'home' && this.homeTab !== 0) {
        this.homeTab = 0;
        return true;
      }
      return false;
    },
  },
});
