import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { materializeFleet, materializeLive } from './src/lib/fixture-load';
import { materializeOps } from './src/lib/ops-fixtures';
import { createSettingsFixtures } from './fixtures/routes/settings';
import { serveNodeRoutes } from './fixtures/routes/node-detail';
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

/**
 * The 客户 and 今天 fixtures are read from disk per set rather than imported,
 * because 今天 has write actions: 认领 / 静默 / 标记已处理 / 备注 have to
 * change something the next GET can see, or the drawer's "refetch after the
 * POST" is a test of nothing. The store below is that something — one mutable
 * copy per fixture set, thrown away when the dev server restarts.
 */
type OpsFile = {
  clock: number;
  list: { items: Array<Record<string, unknown>> };
  details: Record<string, unknown>;
  /** `releases.json` carries the adoption matrix beside the list it explains. */
  adoption?: unknown;
};

const opsCache = new Map<string, OpsFile>();

function opsFile(name: string, session: string): OpsFile | null {
  const key = `${session}/${name}`;
  const cached = opsCache.get(key);
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(path.resolve(rootDir, 'fixtures', name), 'utf8')) as OpsFile;
    opsCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Which copy of the store this request writes to; the set name by default. */
function pickSession(url: string, set: FixtureSetName): string {
  return new URLSearchParams(url.split('?')[1] ?? '').get('session') ?? set;
}

function fileNames(set: FixtureSetName): { customers: string; incidents: string; releases: string } {
  if (set === 'dense') {
    return {
      customers: 'customers.dense.json',
      incidents: 'incidents.dense.json',
      releases: 'releases.dense.json',
    };
  }
  if (set === 'empty') {
    return {
      customers: 'customers.empty.json',
      incidents: 'incidents.empty.json',
      releases: 'releases.empty.json',
    };
  }
  return { customers: 'customers.json', incidents: 'incidents.json', releases: 'releases.json' };
}

type Incident = Record<string, unknown>;

/** Apply one write to the in-memory store, in fixture time, and hand back the row. */
function writeIncident(
  file: OpsFile,
  id: string,
  action: string,
  body: Record<string, unknown>,
): Incident | null {
  const row = file.list.items.find((item) => item.id === id);
  if (!row) return null;
  const at = file.clock;
  if (action === 'ack') {
    row.status = 'acked';
    row.ackedAt = at;
  } else if (action === 'snooze') {
    const seconds = typeof body.seconds === 'number' ? body.seconds : 4 * 60 * 60;
    row.snoozedUntil = at + seconds;
  } else if (action === 'resolve') {
    row.status = 'resolved';
    row.resolvedAt = at;
  } else if (action !== 'notes') {
    return null;
  }
  const detail = file.details[id] as { incident: Incident; events: { items: unknown[] } } | undefined;
  if (detail) {
    detail.incident = { ...row };
    detail.events.items.push({
      id: `${id}-${action}-${detail.events.items.length}`,
      incidentId: id,
      at,
      type: action === 'notes' ? 'note' : action === 'ack' ? 'acked' : action === 'snooze' ? 'snoozed' : 'resolved',
      actor: 'owner',
      note: typeof body.note === 'string' ? body.note : null,
    });
  }
  return row;
}

/**
 * A release edit, in the same shape the Worker's PATCH accepts. It writes the
 * store rather than answering from the file, because the 客户端 page's whole
 * claim is that it shows what the server now believes: a 撤回 that the next
 * GET does not agree with is a test of nothing.
 */
function writeRelease(
  file: OpsFile,
  id: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const row = file.list.items.find((item) => item.id === id);
  if (!row) return null;
  const at = file.clock;
  if (body.publish === true) row.publishedAt = row.publishedAt ?? at;
  if (body.withdraw === true || body.yank === true) row.withdrawnAt = at;
  if (typeof body.minSupportedVersion === 'string') {
    row.minSupportedVersion = body.minSupportedVersion || null;
  }
  if (typeof body.notes === 'string') row.notes = body.notes;
  row.updatedAt = at;
  return row;
}

function readBody(req: import('http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    let raw = '';
    req.on('data', (chunk) => { raw += String(chunk); });
    req.on('end', () => {
      try {
        done(JSON.parse(raw || '{}') as Record<string, unknown>);
      } catch {
        done({});
      }
    });
  });
}

/**
 * The read half of the ops routes, in the shape `docs/ops/api-contract.md`
 * promises: a list envelope for the collections, the bare object for a detail.
 * `?range=` is accepted and ignored — the committed fixtures are seven days,
 * and pretending to slice them would test the slicing, not the page.
 */
function opsBody(file: OpsFile, parts: string[]): unknown {
  const [head, id, section] = parts;
  if (parts.length === 1) return file.list;
  const entry = file.details[id] as Record<string, unknown> | undefined;
  if (!entry) return null;
  if (head === 'incidents') return parts.length === 2 ? entry : null;
  if (parts.length === 2) return (entry as { detail: unknown }).detail;
  const sections = ['connections', 'activity', 'destinations', 'services'];
  if (!sections.includes(section)) return null;
  return entry[section] ?? null;
}

function fixturesPlugin(): Plugin {
  /** The six 设置 resources, mutable, with their own store per session. */
  const settingsFixtures = createSettingsFixtures(rootDir);
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
        const set = pickSet(url);
        // 节点详情 owns its own reads, its two writes and the mutable store
        // behind them; everything else falls through to the branches below.
        if (serveNodeRoutes({ req, res, url, route, set, session: pickSession(url, set === 'error' ? 'default' : set) })) return;
        if (set !== 'error' && settingsFixtures({
          req, res, route, url, session: pickSession(url, set), empty: set === 'empty',
        })) return;
        if (req.method === 'PATCH') {
          const parts = route.split('/').map(decodeURIComponent);
          const file = set !== 'error' && parts[0] === 'releases' && parts.length === 2
            ? opsFile(fileNames(set).releases, pickSession(url, set))
            : null;
          if (!file) {
            res.statusCode = set === 'error' ? 500 : 404;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: { code: 'UPSTREAM', message: FIXTURE_ERROR } }));
            return;
          }
          void readBody(req).then((body) => {
            const row = writeRelease(file, parts[1], body);
            if (!row) {
              res.statusCode = 404;
              res.end();
              return;
            }
            sendJson(res, materializeOps(row, file.clock));
          });
          return;
        }
        if (req.method === 'POST') {
          if (set === 'error') {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: { code: 'UPSTREAM', message: FIXTURE_ERROR } }));
            return;
          }
          const parts = route.split('/').map(decodeURIComponent);
          const file = parts[0] === 'incidents' && parts.length === 3
            ? opsFile(fileNames(set).incidents, pickSession(url, set))
            : null;
          if (!file) {
            res.statusCode = 404;
            res.end();
            return;
          }
          void readBody(req).then((body) => {
            const row = writeIncident(file, parts[1], parts[2], body);
            if (!row) {
              res.statusCode = 404;
              res.end();
              return;
            }
            sendJson(res, materializeOps(row, file.clock));
          });
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end();
          return;
        }
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
        const parts = route.split('/').map(decodeURIComponent);
        const names = fileNames(set);
        if (parts[0] === 'releases') {
          const file = opsFile(names.releases, pickSession(url, set));
          const body = !file
            ? null
            : parts.length === 1
              ? file.list
              : parts[1] === 'adoption' && parts.length === 2
                ? file.adoption
                : null;
          if (body == null) {
            res.statusCode = file ? 404 : 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: route } }));
            return;
          }
          sendJson(res, materializeOps(body, file!.clock));
          return;
        }
        if (parts[0] === 'customers' || parts[0] === 'incidents') {
          const file = opsFile(
            parts[0] === 'customers' ? names.customers : names.incidents,
            pickSession(url, set),
          );
          if (!file) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: { code: 'UPSTREAM', message: FIXTURE_ERROR } }));
            return;
          }
          const body = opsBody(file, parts);
          if (body === null) {
            res.statusCode = 404;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: route } }));
            return;
          }
          sendJson(res, materializeOps(body, file.clock));
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
    fs: {
      /**
       * `node_modules` is a symlink into the primary checkout in every git
       * worktree here, and the webfonts live behind it. Without its real path
       * on the allow list Vite refuses to serve them, the pages render in a
       * fallback face, and every screenshot baseline captured in a worktree
       * disagrees with every one captured in the main checkout.
       */
      allow: [
        path.resolve(rootDir, '..', '..'),
        realpathSync(path.resolve(rootDir, 'node_modules')),
      ],
    },
  },
}));
