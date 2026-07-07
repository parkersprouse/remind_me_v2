import { platform } from '@tauri-apps/plugin-os';
import { isTauri } from './tauri';

/**
 * Platform detection. Mobile platforms get true OS-level notification
 * scheduling; desktop platforms fall back to an in-app scheduler (see
 * notifications.ts).
 */
export const currentPlatform = isTauri ? platform() : 'browser';

export const isMobile = currentPlatform === 'android' || currentPlatform === 'ios';
