/**
 * True when running inside a Tauri webview. When the frontend is served to a
 * plain browser (`pnpm dev` without Tauri), the lib modules fall back to
 * in-memory/localStorage implementations so the UI stays fully usable.
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
