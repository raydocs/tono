import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { nowSec } from '../../src/lib/clock';
import { materializeOps } from '../../src/lib/ops-fixtures';
import { metricsBody, qualityTextBody } from './node-legacy';

/**
 * The 节点详情 endpoints, served by the fixture dev server.
 *
 * Everything the page writes has to be visible to the next read, or the
 * confirmation dialog and the 任务 table below it are testing nothing: an
 * enqueued job lands in a per-`?session=` copy of the store, so the screenshot
 * suite and the test that actually presses 拉取报错 can share one dev server
 * without editing each other's data.
 *
 * The normal and dense sets are hand-written like the 客户 and 今天 fixtures —
 * a page whose every block reads `—` cannot be reviewed. The empty set is the
 * captured shape of a node the Worker knows nothing about, which is exactly
 * what the empty states are for.
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export type FixtureSetName = 'default' | 'dense' | 'empty' | 'error';

type ListFile<T> = { items: T[]; nextCursor: string | null; updatedAt: number };
type Measured<T> = { value: T; asOfSec: number | null; source: string };
type Job = Record<string, unknown> & { id: string; status: string };

type AcceptanceSheet = {
  items: Array<{ key: string; label: string; state: string }>;
  sellable: boolean;
  blockers: string[];
  asOfSec: number | null;
};

/**
 * 可售验收单, generated rather than hand-written, and keyed two ways.
 *
 * `nodes` names the two unlisted machines the 上架 path is reviewed against —
 * the committed 节点详情 file has only listed ones — and carries how each is
 * listed, because a sheet on a machine that is already being sold is a
 * re-check rather than a decision. Anything else falls back to `bySet`.
 */
type AcceptanceFile = {
  clock: number;
  sheets: Record<string, AcceptanceSheet>;
  nodes: Record<string, { sheet: string; lifecycle?: string; catalogListed?: boolean }>;
  bySet: Record<string, string>;
};

type NodeFile = {
  clock: number;
  detail: Record<string, unknown>;
  connections: ListFile<Record<string, unknown>>;
  errors: Record<string, Measured<unknown[]>>;
  history: ListFile<Record<string, unknown>>;
  jobs: ListFile<Job>;
  retirePreview: Record<string, unknown>;
};

const FILES: Record<'default' | 'dense', string> = {
  default: 'fixtures/node-detail.json',
  dense: 'fixtures/node-detail.dense.json',
};

const CAPTURED_EMPTY = 'fixtures/captured/normal';

const ACCEPTANCE_FILE = 'fixtures/node-acceptance.json';

const FIXTURE_ERROR = '节点没拿到';

/** Which job types the Worker refuses without the node's name typed back. */
const DESTRUCTIVE = new Set([
  'xray_restart',
  'identity_sync',
  'agent_reinstall',
  'catalog_retire',
  'catalog_relist',
]);

const WORKER_TYPES = new Set(['catalog_retire', 'catalog_relist']);

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path.resolve(rootDir, relative), 'utf8')) as T;
}

/**
 * The empty set is assembled from the captured files rather than written by
 * hand: a node with nothing behind it is the one shape the capture already
 * has, and copying it keeps the empty page honest about what a real one looks
 * like.
 */
function emptyFile(): NodeFile {
  const detail = readJson<Record<string, unknown>>(`${CAPTURED_EMPTY}/nodes-name.json`);
  const errors = readJson<Measured<unknown[]>>(`${CAPTURED_EMPTY}/nodes-name-errors.json`);
  return {
    clock: 1_725_000_000,
    detail,
    connections: readJson(`${CAPTURED_EMPTY}/nodes-name-connections.json`),
    errors: { '7d': errors, '30d': errors },
    history: readJson(`${CAPTURED_EMPTY}/nodes-name-history.json`),
    jobs: readJson(`${CAPTURED_EMPTY}/nodes-name-jobs.json`),
    retirePreview: {
      expectedRevision: 1,
      currentRevision: 1,
      affectedUsers: [],
      warnings: [],
      canRetire: false,
    },
  };
}

let acceptanceFile: AcceptanceFile | null = null;

function acceptance(): AcceptanceFile {
  acceptanceFile ??= readJson<AcceptanceFile>(ACCEPTANCE_FILE);
  return acceptanceFile;
}

/** Which sheet this machine gets: its own if it has one, else the set's. */
function sheetFor(name: string, set: FixtureSetName): AcceptanceSheet {
  const file = acceptance();
  const named = file.nodes[name];
  const key = named?.sheet ?? file.bySet[set] ?? file.bySet.default;
  return file.sheets[key] ?? file.sheets[file.bySet.default];
}

/** How the machine is listed, when the acceptance fixture says so. */
function listingFor(name: string): Record<string, unknown> {
  const named = acceptance().nodes[name];
  if (!named) return {};
  const out: Record<string, unknown> = {};
  if (named.lifecycle !== undefined) out.lifecycle = named.lifecycle;
  if (named.catalogListed !== undefined) out.catalogListed = named.catalogListed;
  return out;
}

/** One mutable copy per `?session=`, thrown away when the dev server restarts. */
const store = new Map<string, NodeFile>();

function fileFor(set: FixtureSetName, session: string): NodeFile {
  const key = `${session}/${set}`;
  const cached = store.get(key);
  if (cached) return cached;
  const fresh = set === 'empty' ? emptyFile() : readJson<NodeFile>(FILES[set === 'dense' ? 'dense' : 'default']);
  store.set(key, fresh);
  return fresh;
}

function send(res: ServerResponse, body: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, status: number, code: string, message: string) {
  send(res, { error: { code, message } }, status);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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

let made = 0;

function newJob(file: NodeFile, name: string, type: string): Job {
  made += 1;
  const at = file.clock;
  return {
    id: `job-new-${made}`,
    type,
    executor: WORKER_TYPES.has(type) ? 'worker' : 'hub',
    status: 'queued',
    subjectType: 'node',
    subjectId: name,
    params: {},
    attempts: 0,
    maxAttempts: 3,
    idempotencyKey: `idem-new-${made}`,
    requestedBy: 'owner@tono.example',
    incidentId: null,
    notBefore: at,
    expiresAt: at + 900,
    leasedUntil: null,
    resultSummary: null,
    createdAt: at,
    updatedAt: at,
    finishedAt: null,
  };
}

/**
 * The whole node surface, in one call site: `nodes/{name}` and its five
 * sections, the two writes, the legacy retire pair 退役 still runs on, and the
 * two pre-contract reads behind 机器负载 and 线路原文. Returns false for
 * anything it does not own, so the caller can carry on.
 */
export function serveNodeRoutes(options: {
  req: IncomingMessage;
  res: ServerResponse;
  url: string;
  route: string;
  set: FixtureSetName;
  session: string;
}): boolean {
  const { req, res, url, route, set, session } = options;
  const parts = route.split('/').map(decodeURIComponent);
  const method = req.method ?? 'GET';
  const owned = (parts[0] === 'nodes' && parts.length >= 2)
    || (parts[0] === 'metrics' && parts.length === 1)
    || (parts[0] === 'jobs' && parts.length === 3 && parts[2] === 'cancel')
    || (parts[0] === 'fleet-nodes' && parts.length === 3
      && (parts[2] === 'retire-preview' || parts[2] === 'retire' || parts[2] === 'quality-text'));
  if (!owned) return false;

  if (set === 'error') {
    fail(res, 500, 'UPSTREAM', FIXTURE_ERROR);
    return true;
  }

  // The two legacy reads answer straight from the generator: neither has a
  // store behind it, and neither may go through the clock shift below — the
  // samples are already stamped in the frozen present.
  const query = new URLSearchParams(url.split('?')[1] ?? '');
  if (parts[0] === 'metrics' || parts[2] === 'quality-text') {
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.end();
      return true;
    }
    send(res, parts[0] === 'metrics'
      ? metricsBody({
        name: query.get('node'),
        range: query.get('range'),
        fields: query.get('fields'),
        empty: set === 'empty',
        nowUnix: nowSec(),
      })
      : qualityTextBody(parts[1], set === 'empty'));
    return true;
  }

  const file = fileFor(set, session);
  const name = parts[0] === 'jobs' ? String(file.detail.name) : parts[1];

  if (method === 'POST') {
    void handleWrite(req, res, file, parts, name, set);
    return true;
  }
  if (method === 'PATCH') {
    void handleProfile(req, res, file, parts, name);
    return true;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.end();
    return true;
  }

  const range = query.get('range') ?? '7d';
  const body = readFor(file, parts, name, range, set);
  if (body === null) {
    fail(res, 404, 'NOT_FOUND', route);
    return true;
  }
  send(res, materializeOps(body, file.clock));
  return true;
}

function readFor(file: NodeFile, parts: string[], name: string, range: string, set: FixtureSetName): unknown {
  if (parts[0] === 'fleet-nodes') {
    return parts[2] === 'retire-preview' ? file.retirePreview : null;
  }
  const section = parts[2];
  if (parts.length === 2) {
    // The name in the URL wins: one committed machine stands in for the whole
    // fleet here, and a page whose heading disagrees with its own address
    // would be the first thing anyone reported as a bug.
    return { ...file.detail, name, jobs: file.jobs.items, ...listingFor(name) };
  }
  if (section === 'acceptance') return sheetFor(name, set);
  if (section === 'connections') return file.connections;
  if (section === 'history') return file.history;
  if (section === 'jobs') return file.jobs;
  if (section === 'bindings') return file.detail.bindings;
  // `?range=` is honoured rather than ignored: 最近 30 天 is the only reason
  // this endpoint is called at all — the seven-day view rides along with the
  // detail — and serving the week's rows under the month's label would make
  // the toggle look broken.
  if (section === 'errors') return file.errors[range] ?? file.errors['30d'] ?? file.errors['7d'] ?? null;
  return null;
}

/** Exactly the keys the Worker takes on the profile; anything else is refused. */
const PROFILE_KEYS = new Set([
  'provider', 'providerAccountId', 'region', 'lineTags', 'port', 'price',
  'currency', 'billingCycle', 'renewsAt', 'expiresAt', 'notes', 'quota',
]);

const DATE_KEYS = new Set(['renewsAt', 'expiresAt']);

type QuotaBody = {
  quotaBytes?: unknown;
  cycleKind?: unknown;
  cycleAnchorDay?: unknown;
  counts?: unknown;
};

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * 这台机器, written back.
 *
 * The dates go into the store one clock-shift early on purpose: every read
 * here is materialised from the file's recorded clock to now, so a date stored
 * as the operator typed it would come back two years late — and a form whose
 * own answer disagrees with what was typed is worse than no form.
 */
async function handleProfile(
  req: IncomingMessage,
  res: ServerResponse,
  file: NodeFile,
  parts: string[],
  name: string,
) {
  if (parts[2] !== 'profile' || parts.length !== 3) {
    fail(res, 404, 'NOT_FOUND', parts.join('/'));
    return;
  }
  const body = await readBody(req);
  const unknown = Object.keys(body).filter((key) => !PROFILE_KEYS.has(key));
  if (unknown.length > 0) {
    fail(res, 400, 'UNKNOWN_FIELD', unknown.join(', '));
    return;
  }

  const facts = file.detail.facts as Record<string, unknown>;
  const back = nowSec() - file.clock;
  for (const [key, value] of Object.entries(body)) {
    if (key === 'quota') continue;
    if (key === 'lineTags') {
      facts.lineTags = Array.isArray(value) ? value.map((tag) => String(tag)) : [];
      continue;
    }
    if (DATE_KEYS.has(key)) {
      const at = nullableInt(value);
      facts[key] = at === null ? null : at - back;
      continue;
    }
    if (key === 'port' || key === 'billingCycle') {
      facts[key] = nullableInt(value);
      continue;
    }
    if (key === 'price') {
      facts.price = value === null || value === '' ? null : Number(value);
      continue;
    }
    facts[key] = value === null || value === '' ? null : String(value);
  }
  if ('quota' in body) applyQuota(file, body.quota as QuotaBody | null);
  facts.updatedAt = file.clock;
  file.detail.updatedAt = file.clock;

  send(res, materializeOps({ ...file.detail, name, jobs: file.jobs.items, ...listingFor(name) }, file.clock));
}

/** The allowance the 商家 sold, and the share of it the meter has already seen. */
function applyQuota(file: NodeFile, body: QuotaBody | null) {
  const measured = file.detail.quota as Measured<Record<string, unknown>>;
  const row = measured.value;
  if (body === null) {
    row.quota = null;
    row.pct = null;
    row.projectedExhaustAt = null;
    row.level = 'ok';
    return;
  }
  const quota = nullableInt(body.quotaBytes);
  row.quota = quota;
  if (body.cycleKind) row.cycleKind = String(body.cycleKind);
  if (body.counts) row.counts = String(body.counts);
  const used = typeof row.used === 'number' ? row.used : null;
  row.pct = quota && quota > 0 && used !== null ? used / quota : null;
  measured.asOfSec = file.clock;
}

async function handleWrite(
  req: IncomingMessage,
  res: ServerResponse,
  file: NodeFile,
  parts: string[],
  name: string,
  set: FixtureSetName,
) {
  const body = await readBody(req);

  if (parts[0] === 'jobs') {
    const row = file.jobs.items.find((item) => item.id === parts[1]);
    if (!row) {
      fail(res, 404, 'NOT_FOUND', parts[1]);
      return;
    }
    if (row.status !== 'queued' && row.status !== 'leased') {
      fail(res, 409, 'JOB_NOT_CANCELLABLE', FIXTURE_ERROR);
      return;
    }
    row.status = 'cancelled';
    row.finishedAt = file.clock;
    row.updatedAt = file.clock;
    send(res, materializeOps(row, file.clock));
    return;
  }

  if (parts[0] === 'fleet-nodes') {
    if (body.confirmation !== name) {
      fail(res, 400, 'RETIRE_CONFIRMATION_REQUIRED', FIXTURE_ERROR);
      return;
    }
    file.detail.lifecycle = 'retired';
    file.detail.catalogListed = false;
    send(res, { ok: true });
    return;
  }

  if (parts[2] !== 'jobs') {
    fail(res, 404, 'NOT_FOUND', parts.join('/'));
    return;
  }
  const type = String(body.type ?? '');
  if (DESTRUCTIVE.has(type) && body.confirmName !== name) {
    fail(res, 400, 'JOB_CONFIRMATION_REQUIRED', FIXTURE_ERROR);
    return;
  }
  // The same refusal the Worker makes, for the same reason: 上架 reads the
  // 可售验收单 first, and only `override: true` gets past it.
  if (type === 'catalog_relist') {
    const sheet = sheetFor(name, set);
    if (!sheet.sellable && body.override !== true) {
      send(res, {
        error: { code: 'NOT_SELLABLE', message: `${name} 还差 ${sheet.blockers.length} 项验收，不能上架` },
        blockers: sheet.blockers,
      }, 409);
      return;
    }
  }
  const job = newJob(file, name, type);
  file.jobs.items.unshift(job);
  file.jobs.updatedAt = file.clock;
  send(res, materializeOps(job, file.clock));
}
