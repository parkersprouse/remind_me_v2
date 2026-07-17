import { reactive } from 'vue';

/**
 * Mirrors Toaster (SnackBar wrapper) from the Flutter app. A single floating
 * snackbar rendered by <ToasterHost> in App.vue.
 */

export interface Toast {
  message: string;
  icon?: string;
  iconColor?: string;
}

/** Shared icon/color presets so success/error/info toasts look the same everywhere. */
export const SUCCESS_TOAST = {
  icon: 'fa-solid fa-circle-check',
  iconColor: '#4caf50',
};
export const ERROR_TOAST = {
  icon: 'fa-solid fa-circle-exclamation',
  iconColor: '#f44336',
};
export const INFO_TOAST = {
  icon: 'fa-solid fa-circle-info',
  iconColor: '#2196f3',
};

interface ToasterState {
  current: Toast | null;
}

export const toaster_state = reactive<ToasterState>({ current: null });

let hide_timer: ReturnType<typeof setTimeout> | undefined;

export const toaster = {
  show(message: string, options: Omit<Toast, 'message'> = {}): void {
    toaster_state.current = {
      message,
      ...options,
    };
    if (hide_timer !== undefined) clearTimeout(hide_timer);
    // SnackBar's default visibility duration is 4 seconds
    hide_timer = setTimeout(() => {
      toaster.dismiss();
    }, 4000);
  },

  dismiss(): void {
    toaster_state.current = null;
  },
};
