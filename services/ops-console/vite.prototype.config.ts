import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The redesign prototype: same stack as the console, mock data only, no
 * Worker and no fixture middleware. `npx vite -c vite.prototype.config.ts`.
 */
export default defineConfig({
  root: path.join(here, 'prototype'),
  base: '/ops/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.join(here, 'src'),
      '@proto': path.join(here, 'prototype/src'),
    },
  },
  server: { port: 5175, strictPort: true },
  build: { outDir: path.join(here, 'dist/prototype'), emptyOutDir: true },
});
