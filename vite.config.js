import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANT: 'base' must match your repo name for GitHub Pages.
// e.g. github.com/yourname/pokemmo-tools  →  base = '/pokemmo-tools/'
// If you use a custom domain or username.github.io repo, change to '/'
export default defineConfig({
  plugins: [react()],
  base: '/pokemmo-tools/',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 3000,
  },
});
