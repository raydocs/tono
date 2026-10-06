import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
const root = path.resolve('src/dev/sea-shell')
export default defineConfig({
  root,
  plugins: [react()],
  define: { OS_PLATFORM: JSON.stringify('win32') },
  server: { host: '127.0.0.1', port: 3015 },
  resolve: {
    alias: [
      ...[
        'services/tono',
        'services/cmds',
        'services/states',
        'hooks/use-traffic-data',
        'hooks/use-connection-data',
        'hooks/use-tono-preferences',
        'hooks/use-i18n',
        'hooks/use-update',
        'hooks/use-window',
        'pages/_layout/hooks',
      ].map((name) => ({
        find: `@/${name}`,
        replacement: `${root}/fixtures.ts`,
      })),
      { find: '@tauri-apps/api/window', replacement: `${root}/fixtures.ts` },
      { find: '@/utils/get-system', replacement: `${root}/system.ts` },
      { find: '@tauri-apps/api/core', replacement: `${root}/native.ts` },
      { find: '@', replacement: path.resolve('src') },
      { find: '@root', replacement: path.resolve('.') },
    ],
  },
})
