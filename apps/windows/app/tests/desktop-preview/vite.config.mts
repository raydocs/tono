import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.resolve('tests/desktop-preview')
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 3010),
    allowedHosts: ['.onamp.dev'],
  },
  resolve: {
    alias: [
      ...[
        'hooks/use-tono',
        'services/states',
        'services/tono',
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
