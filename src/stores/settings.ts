import { LazyStore } from '@tauri-apps/plugin-store';
import { defineStore } from 'pinia';

import { packageDurations } from '~lib/duration.ts';
import { DEFAULT_ACCENT } from '~lib/theme.ts';

import type { DurationOption } from '~lib/duration.ts';

// Android renders at most three notification action buttons.
const MAX_NOTIF_ACTIONS = 3;

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Mirrors Settings + SettingsProvider from the Flutter app.
 * Persistence goes through tauri-plugin-store (settings.json), the moral
 * equivalent of shared_preferences.
 */

const defaults = {
  theme: 'system' as ThemeMode,
  // Seed color the whole Material 3 palette is generated from.
  accentColor: DEFAULT_ACCENT,
  quickSchedule: true,
  quickScheduleOptions: ['0:15:00', '0:30:00', '1:00:00'],
  notifSnooze: true,
  notifSnoozeOptions: ['0:15:00', '0:30:00', '1:00:00'],
  // When true, the last of Android's three notification action slots holds the
  // "Custom…" button (opening the snooze picker) instead of a third preset.
  notifSnoozeCustomButton: true,
  // Absolute ("Apr 4, 2026, 12:50 PM") by default — matches existing
  // behavior for everyone upgrading into this setting.
  showRelativeTime: false,
};

// Persistence goes through tauri-plugin-store (settings.json), the moral
// equivalent of the Flutter app's shared_preferences.
const persisted = new LazyStore('settings.json');

// Tracks the OS color scheme so `isDarkMode` stays reactive in 'system' mode.
const system_dark_query = window.matchMedia('(prefers-color-scheme: dark)');

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    theme: defaults.theme,
    accentColor: defaults.accentColor,
    showQuickSchedule: defaults.quickSchedule,
    quickScheduleOptions: defaults.quickScheduleOptions,
    showNotifSnooze: defaults.notifSnooze,
    notifSnoozeOptions: defaults.notifSnoozeOptions,
    notifSnoozeCustomButton: defaults.notifSnoozeCustomButton,
    showRelativeTime: defaults.showRelativeTime,
    systemPrefersDark: system_dark_query.matches,
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
      this.theme = (await persisted.get<ThemeMode>('theme')) ?? defaults.theme;
      this.accentColor = (await persisted.get<string>('accent_color')) ?? defaults.accentColor;
      this.showQuickSchedule =
        (await persisted.get<boolean>('show_quick_schedule')) ?? defaults.quickSchedule;
      this.quickScheduleOptions =
        (await persisted.get<string[]>('quick_schedule_options')) ?? defaults.quickScheduleOptions;
      this.showNotifSnooze =
        (await persisted.get<boolean>('show_notif_snooze')) ?? defaults.notifSnooze;
      this.notifSnoozeOptions =
        (await persisted.get<string[]>('notif_snooze_options')) ?? defaults.notifSnoozeOptions;
      this.notifSnoozeCustomButton =
        (await persisted.get<boolean>('notif_snooze_custom_button')) ??
        defaults.notifSnoozeCustomButton;
      this.showRelativeTime =
        (await persisted.get<boolean>('show_relative_time')) ?? defaults.showRelativeTime;

      system_dark_query.addEventListener('change', (event) => {
        this.systemPrefersDark = event.matches;
      });
    },

    setTheme(mode: ThemeMode) {
      this.theme = mode;
      void persisted.set('theme', mode);
    },

    setAccentColor(hex: string) {
      this.accentColor = hex;
      void persisted.set('accent_color', hex);
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

    setShowRelativeTime(enabled: boolean) {
      this.showRelativeTime = enabled;
      void persisted.set('show_relative_time', enabled);
    },
  },
});
