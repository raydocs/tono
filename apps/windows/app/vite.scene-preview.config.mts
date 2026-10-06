import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Explicitly separate from production inputs. Classic IIFE + inline PNGs work on file://.
export default defineConfig({
  root: 'src',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SEA_SCENE_PREVIEW': 'true',
    'process.env.NODE_ENV': '"production"',
  },
  resolve: { alias: { '@': path.resolve('./src') } },
  build: {
    outDir: '../sea-preview',
    emptyOutDir: true,
    target: 'edge109',
    cssCodeSplit: false,
    assetsInlineLimit: Infinity,
    lib: {
      entry: path.resolve('./src/dev/sea-scene/main.tsx'),
      name: 'TonoSeaPreview',
      formats: ['iife'],
      fileName: () => 'scene.js',
      cssFileName: 'scene',
    },
  },
})
