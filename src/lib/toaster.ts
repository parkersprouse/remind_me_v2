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

export const toaster_state = reactive<ToasterState>({ current: null });

let hide_timer: ReturnType<typeof setTimeout> | undefined;

export const toaster = {
  show(message: string, options: {
    icon?: string;
    iconColor?: string;
  } = {}): void {
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
