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

interface ToasterState {
  current: Toast | null;
}

export const toasterState = reactive<ToasterState>({ current: null });

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export const Toaster = {
  show(message: string, options: {
    icon?: string;
    iconColor?: string;
  } = {}): void {
    toasterState.current = {
      message,
      ...options,
    };
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    // SnackBar's default visibility duration is 4 seconds
    hideTimer = setTimeout(() => { Toaster.dismiss(); }, 4000);
  },

  dismiss(): void {
    toasterState.current = null;
  },
};
