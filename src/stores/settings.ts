import { defineStore } from 'pinia';
import { LazyStore } from '@tauri-apps/plugin-store';
import { packageDurations, type DurationOption } from '../lib/duration';

// Android renders at most three notification action buttons.
const MAX_NOTIF_ACTIONS = 3;

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Mirrors Settings + SettingsProvider from the Flutter app.
 * Persistence goes through tauri-plugin-store (settings.json), the moral
 * equivalent of shared_preferences.
 */

const Defaults = {
  theme: 'system' as ThemeMode,
  quickSchedule: true,
  quickScheduleOptions: ['0:15:00', '0:30:00', '1:00:00'],
  notifSnooze: true,
  notifSnoozeOptions: ['0:15:00', '0:30:00', '1:00:00'],
  // When true, the last of Android's three notification action slots holds the
  // "Custom…" button (opening the snooze picker) instead of a third preset.
  notifSnoozeCustomButton: true,
  // Slide animation between top-level pages (landing/home/settings); the
  // swipeable Home tab pager is unaffected. Off by default — page changes
  // swap instantly.
  pageTransitions: false,
};

// Persistence goes through tauri-plugin-store (settings.json), the moral
// equivalent of the Flutter app's shared_preferences.
const persisted = new LazyStore('settings.json');

// Tracks the OS color scheme so `isDarkMode` stays reactive in 'system' mode.
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    theme: Defaults.theme,
    showQuickSchedule: Defaults.quickSchedule,
    quickScheduleOptions: Defaults.quickScheduleOptions,
    showNotifSnooze: Defaults.notifSnooze,
    notifSnoozeOptions: Defaults.notifSnoozeOptions,
    notifSnoozeCustomButton: Defaults.notifSnoozeCustomButton,
    pageTransitions: Defaults.pageTransitions,
    systemPrefersDark: systemDarkQuery.matches,
  }),

  getters: {
    quickOptions: (state) => packageDurations(state.quickScheduleOptions),
    snoozeOptions: (state) => packageDurations(state.notifSnoozeOptions),

    /**
     * How many preset snooze durations appear on the notification: the custom
     * button, when enabled, claims one of the three action slots.
     */
    snoozePresetCount: (state): number =>
      state.notifSnoozeCustomButton ? MAX_NOTIF_ACTIONS - 1 : MAX_NOTIF_ACTIONS,

    /** The preset chips actually shown on the notification. */
    visibleSnoozeOptions(): DurationOption[] {
      return this.snoozeOptions.slice(0, this.snoozePresetCount);
    },

    isDarkMode(state): boolean {
      return state.theme === 'dark' || (state.theme === 'system' && state.systemPrefersDark);
    },

    resolvedTheme(): 'light' | 'dark' {
      return this.isDarkMode ? 'dark' : 'light';
    },
  },

  actions: {
    async load() {
      this.theme = (await persisted.get<ThemeMode>('theme')) ?? Defaults.theme;
      this.showQuickSchedule =
        (await persisted.get<boolean>('show_quick_schedule')) ?? Defaults.quickSchedule;
      this.quickScheduleOptions =
        (await persisted.get<string[]>('quick_schedule_options')) ?? Defaults.quickScheduleOptions;
      this.showNotifSnooze =
        (await persisted.get<boolean>('show_notif_snooze')) ?? Defaults.notifSnooze;
      this.notifSnoozeOptions =
        (await persisted.get<string[]>('notif_snooze_options')) ?? Defaults.notifSnoozeOptions;
      this.notifSnoozeCustomButton =
        (await persisted.get<boolean>('notif_snooze_custom_button')) ??
        Defaults.notifSnoozeCustomButton;
      this.pageTransitions =
        (await persisted.get<boolean>('page_transitions')) ?? Defaults.pageTransitions;

      systemDarkQuery.addEventListener('change', (event) => {
        this.systemPrefersDark = event.matches;
      });
    },

    setTheme(mode: ThemeMode) {
      this.theme = mode;
      void persisted.set('theme', mode);
    },

    setShowQuickSchedule(show: boolean) {
      this.showQuickSchedule = show;
      void persisted.set('show_quick_schedule', show);
    },

    setQuickScheduleOptions(options: string[]) {
      this.quickScheduleOptions = options;
      void persisted.set('quick_schedule_options', options);
    },

    setShowNotifSnooze(show: boolean) {
      this.showNotifSnooze = show;
      void persisted.set('show_notif_snooze', show);
    },

    setNotifSnoozeOptions(options: string[]) {
      this.notifSnoozeOptions = options;
      void persisted.set('notif_snooze_options', options);
    },

    setNotifSnoozeCustomButton(enabled: boolean) {
      this.notifSnoozeCustomButton = enabled;
      void persisted.set('notif_snooze_custom_button', enabled);
    },

    setPageTransitions(enabled: boolean) {
      this.pageTransitions = enabled;
      void persisted.set('page_transitions', enabled);
    },
  },
});
