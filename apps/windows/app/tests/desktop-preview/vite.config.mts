import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.resolve('tests/desktop-preview')
export default defineConfig({
  root,
  plugins: [react()],
  define: { OS_PLATFORM: JSON.stringify('windows') },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 3010),
    allowedHosts: ['.onamp.dev'],
  },
  resolve: {
    alias: [
      ...[
        'hooks/use-tono',
        'hooks/use-connection-data',
        'hooks/use-traffic-data',
        'hooks/use-update',
        'services/states',
        'services/tono',
        'services/cmds',
        'services/update',
        'tono-ui/SupportContact',
        'pages/_navigation',
      ].map((name) => ({
        find: `@/${name}`,
        replacement: `${root}/fixtures.tsx`,
      })),
      { find: '@', replacement: path.resolve('src') },
      { find: '@root', replacement: path.resolve('.') },
    ],
  },
})
