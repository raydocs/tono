import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { materializeFleet, materializeLive } from './src/lib/fixture-load';
import type { FleetFixtureFile, LiveFixtureFile } from './src/lib/types';
import fleetRaw from './fixtures/fleet-nodes.json';
import fleetDenseRaw from './fixtures/fleet-nodes.dense.json';
import fleetEmptyRaw from './fixtures/fleet-nodes.empty.json';
import liveRaw from './fixtures/live.json';
import liveDenseRaw from './fixtures/live.dense.json';

/**
 * Fixture sets, chosen per request by `?fixtures=`. The screenshot suite needs
 * the empty list, a failing upstream and the dense variant from the same dev
 * server, and a query parameter is the only channel a static page can use to
 * ask for one.
 */
const FIXTURE_SETS = {
  default: { fleet: fleetRaw, live: liveRaw },
  dense: { fleet: fleetDenseRaw, live: liveDenseRaw },
  empty: { fleet: fleetEmptyRaw, live: liveRaw },
} as const;

type FixtureSetName = keyof typeof FIXTURE_SETS;

function pickSet(url: string): FixtureSetName | 'error' {
  const asked = new URLSearchParams(url.split('?')[1] ?? '').get('fixtures') ?? 'default';
  if (asked === 'error') return 'error';
  return asked in FIXTURE_SETS ? asked as FixtureSetName : 'default';
}

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** What the operator sees when the hub is down; matches the Worker envelope. */
const FIXTURE_ERROR = '\u8282\u70b9\u5217\u8868\u6ca1\u62ff\u5230';

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
        const set = pickSet(url);
        if (set === 'error') {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { code: 'UPSTREAM', message: FIXTURE_ERROR } }));
          return;
        }
        const chosen = FIXTURE_SETS[set];
        if (route === 'fleet-nodes') {
          sendJson(res, materializeFleet(chosen.fleet as unknown as FleetFixtureFile));
          return;
        }
        if (route === 'live') {
          sendJson(res, { live: materializeLive(chosen.live as unknown as LiveFixtureFile) });
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
      '@contract': path.resolve(rootDir, '../control-plane/src/ops/contract.ts'),
    },
  },
  server: {
    port: 5174,
  },
}));
