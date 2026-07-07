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
  },
});
