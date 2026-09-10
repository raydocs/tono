import type { IncomingMessage, ServerResponse } from 'node:http';
import { nowSec } from '../../src/lib/clock';
import { materializeOps } from '../../src/lib/ops-fixtures';
import { readBody, refuse, sendJson } from './customers-store';
import { worthwhileOf, type FixtureSet } from './worthwhile';


/**
 * 跟进, 下次检查, 收尾, 早报 — the write half of the workbench, served by the
 * fixture dev server.
 *
 * None of these are in the typed contract yet: the Worker is growing them at
 * the same time as the pages, so this file is where the agreed shapes are
 * actually served. Two things it deliberately does the hub's way rather than
 * the convenient way:
 *
 *  - `POST incidents/{id}/resolve` refuses a body with no `closure`. A fixture
 *    that accepted one would let the console ship a 标记已处理 which quietly
 *    writes 已恢复 over a false alarm, which is the exact bug this wave is
 *    for.
 *  - `closure` and `nextCheckAt` are held here and merged into the incident
 *    rows on the way out, rather than written into the committed JSON. The
 *    committed files are checked against the Worker's own contract checkers,
 *    which reject a key the Worker does not send yet.
 *
 * The store is per `?session=`, like the incident and customer stores beside
 * it: a test that closes an incident as 误报 must not change what the
 * screenshot run sees.
 */

const HOUR = 3_600;

export type FollowupKind = 'reply' | 'await_customer' | 'callback' | 'verified' | 'note';

export type Followup = {
  id: string;
  subjectType: 'user' | 'incident' | 'node';
  subjectId: string;
  kind: FollowupKind;
  body: string;
  dueAt: number | null;
  doneAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Closure = 'verified' | 'false_positive' | 'manual';

type Handling = { closure: Closure | null; nextCheckAt: number | null };

type Store = {
  followups: Followup[];
  handling: Map<string, Handling>;
};

export type OpsFile = {
  clock: number;
  list: { items: Array<Record<string, unknown>> };
  details: Record<string, unknown>;
};

let counter = 0;

function newId(): string {
  counter += 1;
  return `fu_fixture${String(counter).padStart(6, '0')}`;
}

const KINDS: FollowupKind[] = ['reply', 'await_customer', 'callback', 'verified', 'note'];
const CLOSURES: Closure[] = ['verified', 'false_positive', 'manual'];

/**
 * One customer waiting on a verification and one incident already re-measured:
 * enough that the 跟进 column, the 处理记录 block and the digest's 今天必须做
 * line all have something true to show on first load.
 */
function seed(empty: boolean): Store {
  const at = nowSec();
  if (empty) return { followups: [], handling: new Map() };
  return {
    // The one opening of the flapping night somebody has already called wrong.
    handling: new Map([[FLAP_MISTAKEN, { closure: 'false_positive' as Closure, nextCheckAt: null }]]),
    followups: [
      {
        id: 'fu_seed_01',
        subjectType: 'user',
        subjectId: 'u-04',
        kind: 'reply',
        body: '已回复客户，先让他换到香港试试',
        dueAt: null,
        doneAt: at - 4 * HOUR,
        createdBy: 'ops.rui',
        createdAt: at - 5 * HOUR,
        updatedAt: at - 4 * HOUR,
      },
      {
        id: 'fu_seed_02',
        subjectType: 'user',
        subjectId: 'u-04',
        kind: 'await_customer',
        body: '等客户确认换节点之后还连不连得上',
        dueAt: at + 6 * HOUR,
        doneAt: null,
        createdBy: 'ops.rui',
        createdAt: at - 3 * HOUR,
        updatedAt: at - 3 * HOUR,
      },
      {
        id: 'fu_seed_03',
        subjectType: 'incident',
        subjectId: 'inc-node-la',
        kind: 'note',
        body: '已经从大陆重测过一轮，还是不通',
        dueAt: null,
        doneAt: null,
        createdBy: 'ops.rui',
        createdAt: at - 2 * HOUR,
        updatedAt: at - 2 * HOUR,
      },
    ],
  };
}

function endOfDay(at: number): number {
  const date = new Date(at * 1_000);
  date.setHours(23, 59, 59, 0);
  return Math.floor(date.getTime() / 1_000);
}

function startOfDay(at: number): number {
  const date = new Date(at * 1_000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1_000);
}

/** 昨夜 runs from six last evening: an incident at 23:40 belongs to the morning read. */
function overnightFrom(at: number): number {
  return startOfDay(at) - 6 * HOUR;
}

function listOf(rows: readonly Followup[]): unknown {
  return { items: [...rows], nextCursor: null, total: rows.length, updatedAt: nowSec() };
}

/* ------------------------------------------------------------ 抖动之夜 */

/**
 * The night the engine flapped, on the dense set.
 *
 * 劣化 opened ten times on one machine with lives of about a minute, and the
 * morning read printed all ten — which is the bad night the grouped digest is
 * built for, so the dense set has to contain one.
 *
 * They are generated rather than committed to `incidents.dense.json` because
 * 昨夜 is computed from the clock at read time: rows pinned to fixed offsets
 * from the file's own clock fall in or out of the window depending on what
 * hour the suite runs at, and a group that is sometimes nine rows is not a
 * baseline. Here they are laid out inside the window that this read computed.
 */
const FLAP_NODE = 'Tokyo · Fuji';
const FLAP_ID = 'inc-flap-';
/** Lives in seconds. Fifty-nine of them is the shortest, and is not a fault. */
const FLAP_LIVES = [59, 71, 96, 62, 143, 88, 67, 205, 74, 61];
/** Only the dense set is dense; the other two are counted in single figures. */
const DENSE_ENOUGH = 12;
/**
 * One of the ten was judged a mistake afterwards, so the group ends two
 * different ways: a line that says 已恢复 ×10 over nine repairs and one false
 * alarm is the lie this whole card exists to stop, at group scale.
 */
const FLAP_MISTAKEN = `${FLAP_ID}09`;

function flapRow(index: number, openedAt: number, life: number): Record<string, unknown> {
  const id = `${FLAP_ID}${String(index + 1).padStart(2, '0')}`;
  const resolvedAt = openedAt + life;
  return {
    id,
    dedupeKey: `node:${FLAP_NODE}:node_degraded:${id}`,
    kind: 'node_degraded',
    subjectType: 'node',
    subjectId: FLAP_NODE,
    severity: 'warn',
    status: 'resolved',
    tone: 'warn',
    title: `${FLAP_NODE} 回程丢包，2 人在用`,
    summary: '判定来回跳，两分钟不到又自己好了。',
    parentIncidentId: null,
    rulesVersion: 3,
    impactCount: 2,
    evidence: [
      { label: 'loss', value: '[{"key":"unicom","lossPct":9.8}]', asOfSec: resolvedAt, source: 'engine' },
      { label: 'occupancy', value: '2', asOfSec: resolvedAt, source: 'engine' },
    ],
    openedAt,
    lastSeenAt: resolvedAt,
    ackedAt: null,
    snoozedUntil: null,
    resolvedAt,
    nextCheckAt: null,
    closure: null,
  };
}

function flapDetail(row: Record<string, unknown>): unknown {
  const id = String(row.id);
  const events = [
    { id: `iev-${id}-01`, incidentId: id, at: row.openedAt, type: 'opened', actor: 'system', note: row.title },
    { id: `iev-${id}-02`, incidentId: id, at: row.resolvedAt, type: 'resolved', actor: 'system', note: '判定又回到正常' },
  ];
  const empty = { items: [], nextCursor: null, total: 0, updatedAt: row.resolvedAt };
  return {
    incident: { ...row },
    events: { items: events, nextCursor: null, total: events.length, updatedAt: row.resolvedAt },
    jobs: empty,
    deliveries: empty,
  };
}

/**
 * Lay the flapping night into the dense file, once. It is written into the
 * file rather than into the digest response so the ten openings are real rows
 * everywhere: the group line opens a drawer that exists, and the 最近恢复 tab
 * behind 还有 N 组 lists the same incidents the block counted.
 */
function withFlapping(file: OpsFile | null): OpsFile | null {
  if (file !== null) seedFlapping(file);
  return file;
}

function seedFlapping(file: OpsFile): void {
  if (file.list.items.length < DENSE_ENOUGH) return;
  if (file.list.items.some((row) => String(row.id).startsWith(FLAP_ID))) return;
  const shift = nowSec() - file.clock;
  const nightStart = overnightFrom(nowSec()) - shift;
  const step = Math.floor((file.clock - nightStart) / (FLAP_LIVES.length + 1));
  for (const [index, life] of FLAP_LIVES.entries()) {
    const row = flapRow(index, nightStart + step * (index + 1), life);
    file.list.items.push(row);
    file.details[String(row.id)] = flapDetail(row);
  }
}

function readKind(value: unknown): FollowupKind | null {
  return KINDS.includes(value as FollowupKind) ? value as FollowupKind : null;
}

function readDue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

/** The incident rows, already shifted to now, with this session's handling merged in. */
function incidentsNow(file: OpsFile, store: Store): Array<Record<string, unknown>> {
  const list = materializeOps(file.list, file.clock);
  return list.items.map((row) => withHandling(row, store));
}

function withHandling(row: Record<string, unknown>, store: Store): Record<string, unknown> {
  const found = store.handling.get(String(row.id));
  return {
    ...row,
    closure: found?.closure ?? null,
    nextCheckAt: found?.nextCheckAt ?? null,
  };
}

function digestOf(file: OpsFile | null, store: Store, set: FixtureSet = 'default'): unknown {
  const at = nowSec();
  const since = overnightFrom(at);
  const rows = file === null ? [] : incidentsNow(file, store);
  const resolved = rows.filter((row) => (
    row.status === 'resolved' && typeof row.resolvedAt === 'number' && row.resolvedAt >= since
  ));
  // Something that both started and recovered in the night is one line, not
  // two: it belongs under what recovered, which is the half that says it is over.
  const opened = rows.filter((row) => (
    row.status !== 'resolved' && typeof row.openedAt === 'number' && row.openedAt >= since
  ));
  const live = rows.filter((row) => row.status !== 'resolved');
  const end = endOfDay(at);
  return {
    day: new Date(at * 1000).toISOString().slice(0, 10),
    overnight: { resolved, opened },
    open: live,
    due: {
      followups: store.followups.filter(
        (row) => row.doneAt === null && row.dueAt !== null && row.dueAt <= end,
      ),
      checks: live.filter(
        (row) => typeof row.nextCheckAt === 'number' && row.nextCheckAt <= end,
      ),
    },
    worthwhile: worthwhileOf(set, at),
    updatedAt: at,
  };
}

type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  parts: string[];
  query: URLSearchParams;
  store: Store;
  file: OpsFile | null;
};

/** `GET followups?due=` — every followup, or the ones that fall due. */
function dueRoute({ res, query, store }: Context): boolean {
  const asked = query.get('due') ?? 'open';
  const at = nowSec();
  const open = store.followups.filter((row) => row.doneAt === null);
  if (asked === 'today') {
    const end = endOfDay(at);
    sendJson(res, listOf(open.filter((row) => row.dueAt !== null && row.dueAt <= end)));
    return true;
  }
  if (asked === 'overdue') {
    sendJson(res, listOf(open.filter((row) => row.dueAt !== null && row.dueAt < at)));
    return true;
  }
  sendJson(res, listOf(open));
  return true;
}

function subjectRoutes(context: Context, subjectType: 'user' | 'incident'): boolean {
  const { req, res, parts, store } = context;
  const subjectId = parts[1];
  if (req.method === 'GET') {
    sendJson(res, listOf(store.followups.filter(
      (row) => row.subjectType === subjectType && row.subjectId === subjectId,
    )));
    return true;
  }
  if (req.method !== 'POST') return false;
  void readBody(req).then((body) => {
    const kind = readKind(body.kind);
    const text = String(body.body ?? '').trim();
    if (kind === null || text === '') {
      refuse(res, 400, 'VALIDATION_ERROR', 'Followup needs a kind and a body');
      return;
    }
    const at = nowSec();
    const row: Followup = {
      id: newId(),
      subjectType,
      subjectId,
      kind,
      body: text,
      dueAt: readDue(body.dueAt),
      doneAt: null,
      createdBy: 'owner',
      createdAt: at,
      updatedAt: at,
    };
    store.followups.unshift(row);
    sendJson(res, row, 201);
  });
  return true;
}

function patchRoute({ req, res, parts, store }: Context): boolean {
  if (req.method !== 'PATCH') return false;
  const row = store.followups.find((entry) => entry.id === parts[1]);
  if (!row) {
    refuse(res, 404, 'NOT_FOUND', 'Followup not found');
    return true;
  }
  void readBody(req).then((body) => {
    const at = nowSec();
    if (body.done === true) row.doneAt = at;
    if (body.done === false) row.doneAt = null;
    if (typeof body.body === 'string' && body.body.trim() !== '') row.body = body.body.trim();
    if (body.dueAt !== undefined) row.dueAt = readDue(body.dueAt);
    row.updatedAt = at;
    sendJson(res, row);
  });
  return true;
}

/**
 * `POST incidents/{id}/resolve`. The closure is not optional: the whole point
 * of the card is that an operator says which of the three things happened, and
 * a fixture that let the console skip it would test nothing.
 */
function resolveRoute({ req, res, parts, store, file }: Context): boolean {
  if (req.method !== 'POST') return false;
  const id = parts[1];
  void readBody(req).then((body) => {
    const closure = CLOSURES.includes(body.closure as Closure) ? body.closure as Closure : null;
    if (closure === null) {
      refuse(res, 400, 'VALIDATION_ERROR', 'resolve needs a closure');
      return;
    }
    const row = file?.list.items.find((item) => item.id === id) ?? null;
    if (!row || !file) {
      refuse(res, 404, 'NOT_FOUND', 'Incident not found');
      return;
    }
    row.status = 'resolved';
    row.resolvedAt = file.clock;
    const found = store.handling.get(id) ?? { closure: null, nextCheckAt: null };
    store.handling.set(id, { ...found, closure });
    const detail = file.details[id] as { incident: Record<string, unknown>; events: { items: unknown[] } } | undefined;
    if (detail) {
      detail.incident = { ...row };
      detail.events.items.push({
        id: `${id}-resolve-${detail.events.items.length}`,
        incidentId: id,
        at: file.clock,
        type: 'resolved',
        actor: 'owner',
        note: typeof body.note === 'string' ? body.note : null,
      });
    }
    sendJson(res, withHandling(materializeOps(row, file.clock), store));
  });
  return true;
}

/** `PATCH incidents/{id}` — the only field the console sends is 下次检查. */
function nextCheckRoute({ req, res, parts, store, file }: Context): boolean {
  if (req.method !== 'PATCH') return false;
  const id = parts[1];
  const row = file?.list.items.find((item) => item.id === id) ?? null;
  if (!row || !file) {
    refuse(res, 404, 'NOT_FOUND', 'Incident not found');
    return true;
  }
  void readBody(req).then((body) => {
    const at = readDue(body.nextCheckAt);
    if (at === null) {
      refuse(res, 400, 'VALIDATION_ERROR', 'nextCheckAt must be a moment');
      return;
    }
    const found = store.handling.get(id) ?? { closure: null, nextCheckAt: null };
    store.handling.set(id, { ...found, nextCheckAt: at });
    sendJson(res, withHandling(materializeOps(row, file.clock), store));
  });
  return true;
}

/**
 * The incident reads, decorated.
 *
 * They are claimed here rather than left to the generic branch because the two
 * new fields live in this store: a `nextCheckAt` the operator just set has to
 * come back on the next read, or the preset buttons are a test of nothing.
 */
function readRoutes({ req, res, parts, store, file }: Context): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!file) return false;
  if (parts.length === 1) {
    const list = materializeOps(file.list, file.clock) as { items: Array<Record<string, unknown>> };
    sendJson(res, { ...list, items: list.items.map((row) => withHandling(row, store)) });
    return true;
  }
  if (parts.length !== 2) return false;
  const entry = file.details[parts[1]] as { incident: Record<string, unknown> } | undefined;
  if (!entry) return false;
  const shifted = materializeOps(entry, file.clock) as { incident: Record<string, unknown> };
  sendJson(res, { ...shifted, incident: withHandling(shifted.incident, store) });
  return true;
}

export function createFollowupFixtures() {
  const stores = new Map<string, Store>();

  function storeFor(session: string, empty: boolean): Store {
    const key = `${session}/${empty ? 'empty' : 'normal'}`;
    const found = stores.get(key);
    if (found) return found;
    const made = seed(empty);
    stores.set(key, made);
    return made;
  }

  return function followupFixtures(options: {
    req: IncomingMessage;
    res: ServerResponse;
    route: string;
    url: string;
    session: string;
    empty: boolean;
    incidents: () => OpsFile | null;
  }): boolean {
    const parts = options.route.split('/').map(decodeURIComponent);
    const context: Context = {
      req: options.req,
      res: options.res,
      parts,
      query: new URLSearchParams(options.url.split('?')[1] ?? ''),
      store: storeFor(options.session, options.empty),
      file: withFlapping(options.incidents()),
    };
    if (parts[0] === 'digest' && parts.length === 1) {
      sendJson(options.res, digestOf(context.file, context.store, options.empty ? 'empty' : 'default'));
      return true;
    }

    if (parts[0] === 'followups') {
      return parts.length === 1 ? dueRoute(context) : patchRoute(context);
    }
    if (parts[0] === 'customers' && parts.length === 3 && parts[2] === 'followups') {
      return subjectRoutes(context, 'user');
    }
    if (parts[0] !== 'incidents') return false;
    if (parts.length === 3 && parts[2] === 'followups') return subjectRoutes(context, 'incident');
    if (parts.length === 3 && parts[2] === 'resolve') return resolveRoute(context);
    if (parts.length === 2 && options.req.method === 'PATCH') return nextCheckRoute(context);
    return readRoutes(context);
  };
}
