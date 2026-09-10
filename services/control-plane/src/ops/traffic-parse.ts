// Parse a gzip/JSONL traffic-audit segment into daily destination, service,
// and DIRECT-candidate aggregates. Pure: no import from index, no network.

import {
  etld1,
  familyForHost,
  isLikelyDomestic,
  normalizeHost,
  type FamilyId,
} from './service-families';

export const MAX_SEGMENT_LINES = 20_000;
export const MAX_DISTINCT_ETLD1 = 2_000;
export const MAX_PROCESS_CHARS = 40;
export const UPSERT_BATCH = 50;
export const OTHER_ETLD1 = '__other__';
export const IP_ETLD1 = '__ip__';

const HOME_SOCKS5_OUTBOUND_NAME = 'Tono-Home-Residential';
const CLAUDE_HOME_GROUP_NAME = 'Tono-Claude-Home';
const DIRECT_GROUP_NAMES = [
  'DIRECT',
  'Tono-China-Direct',
  'Tono-China-Web-Direct',
  'Tono-China-App',
  'Tono-China-Web',
];

export type Route = 'cloud' | 'residential' | 'direct' | 'reject' | 'unknown';

export type ParseContext = {
  userId: string;
  deviceId: string | null;
  receivedAt: number;
  gunzip?: boolean;
};

export type DestinationAgg = {
  connections: number;
  bytesUp: number;
  bytesDown: number;
  processes: Map<string, number>;
};

export type ServiceAgg = {
  bytes: number;
  sessions: number;
  lastSeenAt: number;
};

export type CandidateAgg = {
  firstSeen: number;
  lastSeen: number;
  bytes: number;
  connections: number;
};

export type ParsedSegment = {
  userId: string;
  deviceId: string;
  receivedAt: number;
  lines: number;
  connectionRows: number;
  truncatedLine: boolean;
  etld1Overflow: number;
  destinations: Map<string, DestinationAgg>;
  services: Map<string, ServiceAgg>;
  candidates: Map<string, CandidateAgg>;
};

export type NormalizedConnection = {
  tsMs: number;
  host: string;
  etld1: string;
  port: number;
  process: string;
  route: Route;
  node: string;
  bytesUp: number;
  bytesDown: number;
};

const CONNECTION_KINDS = new Set(['connection', 'connection_opened', 'directDial']);
const ROUTES = new Set<Route>(['cloud', 'residential', 'direct', 'reject', 'unknown']);
const SKIP_HOSTS = new Set(['', 'unknown', '*', '-']);

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function str(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function intField(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (value == null || value === '') continue;
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

function dayAt(tsMs: number): number {
  return Math.floor(tsMs / 86_400_000) * 86_400;
}

function tsMsOf(row: Record<string, unknown>, receivedAt: number): number {
  const iso = str(row, 'timestamp', 'started_at', 'startedAt');
  if (iso) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) return parsed;
  }
  const n = intField(row, 'ts', 'time', 'tsMs');
  if (n > 0) return n < 1e12 ? n * 1000 : n;
  return receivedAt < 1e12 ? receivedAt * 1000 : receivedAt;
}

function hopText(row: Record<string, unknown>): string {
  return [
    str(row, 'route'),
    str(row, 'proxy', 'outbound', 'chain'),
    str(row, 'route_classification', 'routeClassification'),
    str(row, 'rule'),
  ].filter(Boolean).join(' ');
}

// DIRECT / REJECT / the residential group names from tono-core config.rs.
// China-direct group names are treated as DIRECT because that is what the
// writers actually emit (Tono-China-App does not contain the substring
// "DIRECT"). Empty hops on a Windows `directDial` row are direct: that
// event is only recorded for the DIRECT overlay.
export function deriveRoute(row: Record<string, unknown>, kind: string): Route {
  const raw = hopText(row);
  const exact = raw.trim().toLowerCase();
  if (ROUTES.has(exact as Route) && !exact.includes(' ')) return exact as Route;
  const upper = raw.toUpperCase();
  if (!upper) return kind === 'directDial' ? 'direct' : 'unknown';
  if (upper.includes('REJECT') || upper.includes('BLOCKED')) return 'reject';
  if (
    upper.includes(HOME_SOCKS5_OUTBOUND_NAME.toUpperCase())
    || upper.includes(CLAUDE_HOME_GROUP_NAME.toUpperCase())
    || /\bRESIDENTIAL\b/.test(upper)
  ) return 'residential';
  if (DIRECT_GROUP_NAMES.some((name) => upper.includes(name.toUpperCase()))) {
    return 'direct';
  }
  return 'cloud';
}

function processName(row: Record<string, unknown>): string {
  const raw = str(row, 'process') || str(row, 'process_path', 'processPath');
  if (!raw || raw.toLowerCase() === 'unknown') return '';
  const base = raw.split(/[/\\]/).pop() ?? raw;
  return base.slice(0, MAX_PROCESS_CHARS);
}

function nodeName(row: Record<string, unknown>): string {
  return str(row, 'node', 'selected_exit', 'selectedExit').slice(0, 120);
}

function destKey(day: number, e: string, route: Route, node: string): string {
  return `${day}\t${e}\t${route}\t${node}`;
}

function serviceKey(day: number, family: FamilyId, route: Route): string {
  return `${day}\t${family}\t${route}`;
}

function bumpProcess(agg: DestinationAgg, process: string): void {
  if (!process) return;
  agg.processes.set(process, (agg.processes.get(process) ?? 0) + 1);
}

function topProcess(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [name, count] of counts) {
    if (count > n || (count === n && (best === null || name < best))) {
      best = name;
      n = count;
    }
  }
  return best;
}

async function decodeSegment(
  bytes: Uint8Array | string,
  gunzip: boolean,
): Promise<string> {
  if (!gunzip) {
    return typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
  }
  const raw: Uint8Array = typeof bytes === 'string'
    ? new TextEncoder().encode(bytes)
    : bytes;
  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export function normalizeConnection(
  row: Record<string, unknown>,
  kind: string,
  receivedAt: number,
): NormalizedConnection | null {
  const hostRaw = str(row, 'host') || str(row, 'destination_ip', 'destinationIp', 'address');
  const host = normalizeHost(hostRaw);
  if (!host || SKIP_HOSTS.has(host)) return null;
  const e = etld1(host);
  if (!e) return null;
  return {
    tsMs: tsMsOf(row, receivedAt),
    host,
    etld1: e,
    port: intField(row, 'destination_port', 'destinationPort', 'port'),
    process: processName(row),
    route: deriveRoute(row, kind),
    node: nodeName(row),
    bytesUp: intField(row, 'bytes_up', 'bytesUp', 'upload', 'upBytes', 'up_bytes'),
    bytesDown: intField(row, 'bytes_down', 'bytesDown', 'download', 'downBytes', 'down_bytes'),
  };
}

export async function parseAuditSegment(
  bytes: Uint8Array | string,
  ctx: ParseContext,
): Promise<ParsedSegment> {
  const text = await decodeSegment(bytes, ctx.gunzip === true);
  const deviceId = ctx.deviceId ?? '';
  const parsed: ParsedSegment = {
    userId: ctx.userId,
    deviceId,
    receivedAt: ctx.receivedAt,
    lines: 0,
    connectionRows: 0,
    truncatedLine: false,
    etld1Overflow: 0,
    destinations: new Map(),
    services: new Map(),
    candidates: new Map(),
  };
  const seenEtld = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (parsed.lines >= MAX_SEGMENT_LINES) break;
    parsed.lines += 1;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      if (i === lines.length - 1) parsed.truncatedLine = true;
      continue;
    }
    if (typeof row !== 'object' || row === null) continue;
    const kind = str(row, 'kind');
    if (!CONNECTION_KINDS.has(kind)) continue;
    const conn = normalizeConnection(row, kind, ctx.receivedAt);
    if (!conn) continue;
    parsed.connectionRows += 1;
    let e = conn.etld1;
    if (e !== OTHER_ETLD1 && !seenEtld.has(e)) {
      if (seenEtld.size >= MAX_DISTINCT_ETLD1) {
        e = OTHER_ETLD1;
        parsed.etld1Overflow += 1;
      } else {
        seenEtld.add(e);
      }
    }
    const day = dayAt(conn.tsMs);
    const seenSec = Math.floor(conn.tsMs / 1000);
    const dKey = destKey(day, e, conn.route, conn.node);
    let dest = parsed.destinations.get(dKey);
    if (!dest) {
      dest = { connections: 0, bytesUp: 0, bytesDown: 0, processes: new Map() };
      parsed.destinations.set(dKey, dest);
    }
    dest.connections += 1;
    dest.bytesUp += conn.bytesUp;
    dest.bytesDown += conn.bytesDown;
    bumpProcess(dest, conn.process);

    const family = e === OTHER_ETLD1 || e === IP_ETLD1 ? null : familyForHost(conn.host);
    if (family) {
      const sKey = serviceKey(day, family, conn.route);
      let svc = parsed.services.get(sKey);
      if (!svc) {
        svc = { bytes: 0, sessions: 0, lastSeenAt: 0 };
        parsed.services.set(sKey, svc);
      }
      svc.bytes += conn.bytesUp + conn.bytesDown;
      svc.sessions += 1;
      if (seenSec > svc.lastSeenAt) svc.lastSeenAt = seenSec;
    }

    if (conn.route === 'cloud' && e !== OTHER_ETLD1 && e !== IP_ETLD1 && isLikelyDomestic(e)) {
      let cand = parsed.candidates.get(e);
      if (!cand) {
        cand = { firstSeen: seenSec, lastSeen: seenSec, bytes: 0, connections: 0 };
        parsed.candidates.set(e, cand);
      }
      cand.connections += 1;
      cand.bytes += conn.bytesUp + conn.bytesDown;
      if (seenSec < cand.firstSeen) cand.firstSeen = seenSec;
      if (seenSec > cand.lastSeen) cand.lastSeen = seenSec;
    }
  }
  return parsed;
}

function parseDestKey(key: string): { dayAt: number; etld1: string; route: Route; node: string } {
  const [day, e, route, node] = key.split('\t');
  return { dayAt: Number(day), etld1: e, route: route as Route, node: node ?? '' };
}

function parseServiceKey(key: string): { dayAt: number; family: string; route: Route } {
  const [day, family, route] = key.split('\t');
  return { dayAt: Number(day), family, route: route as Route };
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += UPSERT_BATCH) {
    const chunk = statements.slice(i, i + UPSERT_BATCH);
    try {
      await db.batch(chunk);
    } catch (error) {
      if (missingTable(error)) return;
      throw error;
    }
  }
}

export async function writeParsedSegment(
  db: D1Database,
  parsed: ParsedSegment,
  nowSec: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const [key, agg] of parsed.destinations) {
    const { dayAt: day, etld1: e, route, node } = parseDestKey(key);
    statements.push(db.prepare(
      `INSERT INTO traffic_destination_daily(
         user_id, device_id, day_at, etld1, route, node,
         connections, bytes_up, bytes_down, top_process, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_id, day_at, etld1, route, node) DO UPDATE SET
         connections = connections + excluded.connections,
         bytes_up = bytes_up + excluded.bytes_up,
         bytes_down = bytes_down + excluded.bytes_down,
         top_process = CASE
           WHEN excluded.connections >= traffic_destination_daily.connections
           THEN COALESCE(excluded.top_process, traffic_destination_daily.top_process)
           ELSE COALESCE(traffic_destination_daily.top_process, excluded.top_process)
         END,
         updated_at = excluded.updated_at`,
    ).bind(
      parsed.userId,
      parsed.deviceId,
      day,
      e,
      route,
      node,
      agg.connections,
      agg.bytesUp,
      agg.bytesDown,
      topProcess(agg.processes),
      nowSec,
    ));
  }
  for (const [key, agg] of parsed.services) {
    const { dayAt: day, family, route } = parseServiceKey(key);
    statements.push(db.prepare(
      `INSERT INTO service_usage_daily(
         user_id, day_at, family, route, bytes, sessions, last_seen_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day_at, family, route) DO UPDATE SET
         bytes = bytes + excluded.bytes,
         sessions = sessions + excluded.sessions,
         last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
    ).bind(
      parsed.userId,
      day,
      family,
      route,
      agg.bytes,
      agg.sessions,
      agg.lastSeenAt,
    ));
  }
  for (const [e, agg] of parsed.candidates) {
    statements.push(db.prepare(
      `INSERT INTO direct_candidates(
         etld1, first_seen, last_seen, users, bytes_30d, connections_30d, status
       ) VALUES(?, ?, ?, 1, ?, ?, 'new')
       ON CONFLICT(etld1) DO UPDATE SET
         first_seen = MIN(first_seen, excluded.first_seen),
         last_seen = MAX(last_seen, excluded.last_seen),
         users = users + excluded.users,
         bytes_30d = bytes_30d + excluded.bytes_30d,
         connections_30d = connections_30d + excluded.connections_30d`,
    ).bind(e, agg.firstSeen, agg.lastSeen, agg.bytes, agg.connections));
  }
  if (statements.length === 0) return;
  await runBatches(db, statements);
}

export async function retainTrafficDaily(
  db: D1Database,
  nowSec: number,
  days = 90,
  limit = 500,
): Promise<void> {
  const cutoff = nowSec - days * 86_400;
  const tables = ['traffic_destination_daily', 'service_usage_daily'] as const;
  const column = 'day_at';
  try {
    for (const table of tables) {
      await db.prepare(
        `DELETE FROM ${table} WHERE rowid IN (
           SELECT rowid FROM ${table} WHERE ${column} < ? LIMIT ?
         )`,
      ).bind(cutoff, limit).run();
    }
    await db.prepare(
      `DELETE FROM direct_candidates WHERE rowid IN (
         SELECT rowid FROM direct_candidates WHERE last_seen < ? LIMIT ?
       )`,
    ).bind(cutoff, limit).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}
