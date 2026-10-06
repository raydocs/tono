import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: path.resolve('src/dev/ui'),
  plugins: [react()],
  define: { OS_PLATFORM: JSON.stringify('windows') },
  server: { host: '127.0.0.1', port: 3013 },
  resolve: {
    alias: [
      {
        find: '@/services/states',
        replacement: path.resolve('src/dev/sea-home/fixtures.ts'),
      },
      { find: '@', replacement: path.resolve('src') },
      { find: '@root', replacement: path.resolve('.') },
    ],
  },
})
