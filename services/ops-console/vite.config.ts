import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { materializeFleet, materializeLive } from './src/lib/fixture-load';
import type { FleetFixtureFile, LiveFixtureFile } from './src/lib/types';
import fleetRaw from './fixtures/fleet-nodes.json';
import liveRaw from './fixtures/live.json';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function sendJson(res: import('http').ServerResponse, body: unknown) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function fixturesPlugin(): Plugin {
  return {
    name: 'ops-fixtures',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const pathOnly = url.split('?')[0];
        if (!pathOnly.startsWith('/api/v1/ops/')) {
          next();
          return;
        }
        const route = pathOnly.slice('/api/v1/ops/'.length);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (route === 'fleet-nodes') {
          sendJson(res, materializeFleet(fleetRaw as unknown as FleetFixtureFile));
          return;
        }
        if (route === 'live') {
          sendJson(res, { live: materializeLive(liveRaw as unknown as LiveFixtureFile) });
          return;
        }
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: route } }));
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: '/ops2/',
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'fixtures' ? [fixturesPlugin()] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@legacy-lib': path.resolve(rootDir, '../control-plane/admin/src/lib'),
    },
  },
  server: {
    port: 5174,
  },
}));
