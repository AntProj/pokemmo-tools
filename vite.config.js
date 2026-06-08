import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri sets TAURI_ENV_* in the env of its beforeBuild/beforeDev commands, so we
// can detect a desktop build and serve assets from relative paths (the desktop
// shell loads them off a local protocol, not a GitHub Pages sub-path).
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// IMPORTANT: for the GitHub Pages build, 'base' must match your repo name.
// e.g. github.com/yourname/pokemmo-tools  →  base = '/pokemmo-tools/'
// The desktop (Tauri) build overrides this to './'.
export default defineConfig({
  plugins: [react()],
  base: isTauri ? './' : '/pokemmo-tools/',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 3000,
    // Tauri's Windows WebView2 is evergreen Chromium — no need to down-level.
    target: isTauri ? 'esnext' : 'modules',
  },
  // Tauri dev expects a fixed port and no clearing of the terminal.
  ...(isTauri && {
    clearScreen: false,
    server: { port: 5173, strictPort: true },
  }),
});
