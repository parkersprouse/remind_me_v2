import { defineStore } from 'pinia';
import { LazyStore } from '@tauri-apps/plugin-store';
import { packageDurations } from '../lib/duration';
import { isTauri } from '../lib/tauri';

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
};

interface Persistence {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

/** Browser-dev fallback: persist to localStorage instead of the store plugin. */
const localStoragePersistence: Persistence = {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = localStorage.getItem(`settings:${key}`);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  },
  async set(key: string, value: unknown): Promise<void> {
    localStorage.setItem(`settings:${key}`, JSON.stringify(value));
  },
};

const persisted: Persistence = isTauri ? new LazyStore('settings.json') : localStoragePersistence;

// Tracks the OS color scheme so `isDarkMode` stays reactive in 'system' mode.
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    theme: Defaults.theme,
    showQuickSchedule: Defaults.quickSchedule,
    quickScheduleOptions: Defaults.quickScheduleOptions,
    showNotifSnooze: Defaults.notifSnooze,
    notifSnoozeOptions: Defaults.notifSnoozeOptions,
    systemPrefersDark: systemDarkQuery.matches,
  }),

  getters: {
    quickOptions: (state) => packageDurations(state.quickScheduleOptions),
    snoozeOptions: (state) => packageDurations(state.notifSnoozeOptions),

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
  },
});
