import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.resolve('src/dev/sea-home')
// Actual dashboard and SWR/status-push path, only native IO and live feeds simulated.
// Separate development entry; never a production build input.
export default defineConfig({
  root,
  plugins: [react()],
  define: { OS_PLATFORM: JSON.stringify('windows') },
  server: { host: '127.0.0.1', port: 3012 },
  resolve: {
    alias: [
      ...[
        'services/tono',
        'services/cmds',
        'services/states',
        'hooks/use-traffic-data',
        'hooks/use-connection-data',
      ].map((name) => ({
        find: `@/${name}`,
        replacement: `${root}/fixtures.ts`,
      })),
      { find: '@tauri-apps/api/window', replacement: `${root}/fixtures.ts` },
      { find: '@', replacement: path.resolve('src') },
      { find: '@root', replacement: path.resolve('.') },
    ],
  },
})
