// eslint-disable-next-line import-x/no-nodejs-modules -- build-time config, not shipped source
import { fileURLToPath, URL } from 'node:url';

// eslint-disable-next-line import-x/default -- this is a false positive
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Module path aliases, kept in sync with the `paths` map in tsconfig.json so
// the same `@/...` and `~lib/...` imports resolve at bundle/runtime too.
const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '~assets': fileURLToPath(new URL('./src/assets', import.meta.url)),
  '~components': fileURLToPath(new URL('./src/components', import.meta.url)),
  '~composables': fileURLToPath(new URL('./src/composables', import.meta.url)),
  '~lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
  '~stores': fileURLToPath(new URL('./src/stores', import.meta.url)),
  '~types': fileURLToPath(new URL('./src/types', import.meta.url)),
  '~views': fileURLToPath(new URL('./src/views', import.meta.url)),
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  resolve: {
    alias,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    hmr: host ?
      {
        host,
        port: 1421,
        protocol: 'ws',
      } :
      undefined,
    host: host || false,
    port: 1420,
    strictPort: true,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}));
