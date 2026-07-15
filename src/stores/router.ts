import { defineStore } from 'pinia';

/**
 * Mirrors RouterModel from the Flutter app: a tiny page switcher over an
 * IndexedStack-style view stack (no URL routing needed).
 */

export enum Pages {
  Landing = 'landing',
  Home = 'home',
  Settings = 'settings',
};
export type Page = typeof Pages[keyof typeof Pages];

export enum HomeTabs {
  NewReminder = 0,
  ScheduledReminders = 1,
};
export type HomeTab = typeof HomeTabs[keyof typeof HomeTabs];

export const useRouterStore = defineStore('router', {
  state: () => ({
    homeTab: HomeTabs.NewReminder,
    page: Pages.Landing,
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
      if (this.page === Pages.Settings) {
        this.page = Pages.Home;
        return true;
      }
      if (this.page === Pages.Home && this.homeTab !== HomeTabs.NewReminder) {
        this.homeTab = HomeTabs.NewReminder;
        return true;
      }
      return false;
    },
  },

  getters: {
    // Current tab getters
    on_new_reminder_tab(state) {
      return state.homeTab === HomeTabs.NewReminder;
    },

    on_scheduled_reminders_tab(state) {
      return state.homeTab === HomeTabs.ScheduledReminders;
    },

    // Current page getters
    on_landing_page(state) {
      return state.page === Pages.Landing;
    },

    on_home_page(state) {
      return state.page === Pages.Home;
    },

    on_settings_page(state) {
      return state.page === Pages.Settings;
    },

    page_title(state) {
      return state.page === Pages.Settings ? 'Settings' : 'Remind Me!';
    },
  },
});
