// Live + D1 facts that feed the verdict engine. Kept beside verdict-run so
// that file stays under the line cap.

import { decryptCatalog } from '../crypto';
import { type Env, type Row, requiredCatalogKey } from '../env';
import { splitManagedCatalogProxies } from '../catalog-yaml';
import { loadPriorNodeStates } from './evaluate';
import { loadOperationsLive } from './live';
import {
  type CarrierMap,
  type CustomerVerdictInput,
  type IncidentDesire,
  type NodeFails30m,
  type NodeVerdictInput,
  type VerdictInput,
} from './verdict';

const FAIL_WINDOW = 30 * 60;
const DAY = 86_400;
const SPIKE_MIN = 10;
const SPIKE_RATIO = 3;
const HANDSHAKE_SQL = `(stage IN ('handshake', 'dial', 'tls') OR lower(COALESCE(stage, '')) LIKE '%handshake%')`;

export type CustomerScope = 'all' | 'none' | { userId: string };

type LiveIncidentRow = {
  evidence_json?: string | null;
  id: string;
  dedupe_key: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  severity: IncidentDesire['severity'];
  title: string;
  detail: string | null;
  cause: string | null;
  parent_incident_id: string | null;
  impact_count: number;
};

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.length ? value : null;
}

function utcDay(sec: number): number {
  return Math.floor(sec / DAY) * DAY;
}

async function catalogNameSet(e: Env): Promise<Set<string> | null> {
  // Same decrypt + splitManagedCatalogProxies path operationsFleetNodes uses.
  try {
    const row = await e.DB.prepare(
      'SELECT ciphertext, nonce FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<{ ciphertext: string; nonce: string }>();
    if (!row) return new Set();
    const yaml = await decryptCatalog(String(row.ciphertext), String(row.nonce), requiredCatalogKey(e));
    return new Set(splitManagedCatalogProxies(yaml).items.map((item) => item.name));
  } catch {
    return null;
  }
}

function asCarriers(raw: unknown): CarrierMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Row;
  const out: CarrierMap = {};
  for (const key of ['unicom', 'telecom', 'mobile'] as const) {
    const row = src[key];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const sample = row as Row;
    out[key] = {
      lossPct: finite(sample.lossPct),
      latencyMs: finite(sample.latencyMs),
      samples: finite(sample.samples) ?? 0,
    };
  }
  return Object.keys(out).length ? out : null;
}

function asMachine(
  agent: Row | undefined,
  rollup: Row | undefined,
): NodeVerdictInput['machine'] {
  const cpu = finite(agent?.cpu) ?? finite(rollup?.cpu_avg);
  const memUsed = finite(agent?.memUsed) ?? finite(rollup?.mem_used_avg);
  const memTotal = finite(agent?.memTotal) ?? finite(rollup?.mem_total);
  const diskUsed = finite(agent?.diskUsed) ?? finite(rollup?.disk_used_avg);
  const diskTotal = finite(agent?.diskTotal) ?? finite(rollup?.disk_total);
  const load1 = finite(agent?.load1) ?? finite(rollup?.load1_avg);
  if (cpu == null && memUsed == null && diskUsed == null && load1 == null) return null;
  return {
    cpu,
    memRatio: memUsed != null && memTotal != null && memTotal > 0 ? memUsed / memTotal : null,
    diskRatio: diskUsed != null && diskTotal != null && diskTotal > 0 ? diskUsed / diskTotal : null,
    load1,
  };
}

function blockStatusOf(node: Row | undefined): string | null {
  const block = node?.block;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  return text((block as Row).status);
}

function delaysFromPayload(payload: Row, receivedAtSec: number) {
  const clip = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
  const receivedAtMs = receivedAtSec * 1000;
  const at = (key: string) => {
    const value = clip(payload[key], 1, 4_102_444_800_000);
    return value == null ? null : Math.min(value, receivedAtMs);
  };
  return {
    exitDelayMs: clip(payload.exitDelayMs, 1, 120_000),
    tcpDelayMs: clip(payload.tcpDelayMs, 1, 120_000),
    exitDelayAtMs: at('exitDelayAtMs'),
    tcpDelayAtMs: at('tcpDelayAtMs'),
  };
}

async function loadFails30m(db: D1Database, nowSec: number): Promise<Map<string, NodeFails30m>> {
  try {
    const rows = await db.prepare(
      `SELECT node,
              SUM(CASE WHEN kind IN ('connectBegin', 'connectOk', 'connectFail') THEN 1 ELSE 0 END) AS attempts,
              SUM(CASE WHEN kind = 'connectFail' THEN 1 ELSE 0 END) AS failures,
              COUNT(DISTINCT CASE WHEN kind = 'connectFail' THEN user_id END) AS distinct_users,
              COUNT(DISTINCT CASE WHEN kind = 'connectFail' AND ${HANDSHAKE_SQL} THEN user_id END) AS handshake_users
       FROM connection_events
       WHERE received_at >= ? AND node IS NOT NULL AND node != ''
       GROUP BY node`,
    ).bind(nowSec - FAIL_WINDOW).all<Row>();
    const out = new Map<string, NodeFails30m>();
    for (const row of rows.results ?? []) {
      out.set(String(row.node), {
        attempts: Number(row.attempts) || 0,
        failures: Number(row.failures) || 0,
        distinctUsers: Number(row.distinct_users) || 0,
        handshakeDistinctUsers: Number(row.handshake_users) || 0,
      });
    }
    return out;
  } catch (error) {
    if (missingTable(error)) return new Map();
    throw error;
  }
}

async function loadRollups(db: D1Database): Promise<Map<string, Row>> {
  try {
    const rows = await db.prepare(
      `SELECT r.node_name, r.cpu_avg, r.mem_used_avg, r.mem_total,
              r.disk_used_avg, r.disk_total, r.load1_avg
       FROM operations_agent_rollups r
       JOIN (
         SELECT node_name, MAX(bucket_at) AS bucket_at
         FROM operations_agent_rollups
         GROUP BY node_name
       ) t ON t.node_name = r.node_name AND t.bucket_at = r.bucket_at`,
    ).all<Row>();
    return new Map((rows.results ?? []).map((row) => [String(row.node_name), row]));
  } catch (error) {
    if (missingTable(error)) return new Map();
    throw error;
  }
}

async function loadErrorSpikes(db: D1Database, nowSec: number): Promise<Set<string>> {
  const today = utcDay(nowSec);
  const from = today - 6 * DAY;
  try {
    const rows = await db.prepare(
      `SELECT node, day_at, SUM(count) AS n
       FROM node_error_daily WHERE day_at >= ?
       GROUP BY node, day_at`,
    ).bind(from).all<Row>();
    const byNode = new Map<string, { today: number; prev: number[] }>();
    for (const row of rows.results ?? []) {
      const node = String(row.node);
      const day = Number(row.day_at);
      const n = Number(row.n) || 0;
      const bucket = byNode.get(node) ?? { today: 0, prev: [] };
      if (day === today) bucket.today = n;
      else bucket.prev.push(n);
      byNode.set(node, bucket);
    }
    const spikes = new Set<string>();
    for (const [node, bucket] of byNode) {
      const mean = bucket.prev.length
        ? bucket.prev.reduce((sum, n) => sum + n, 0) / bucket.prev.length
        : 0;
      if (bucket.today >= SPIKE_MIN && bucket.today >= SPIKE_RATIO * Math.max(mean, 1)) {
        spikes.add(node);
      }
    }
    return spikes;
  } catch (error) {
    if (missingTable(error)) return new Set();
    throw error;
  }
}

async function loadLastOkAt(db: D1Database): Promise<Map<string, number>> {
  try {
    const rows = await db.prepare(
      `SELECT node, MAX(received_at) AS last_ok
       FROM connection_events
       WHERE kind = 'connectOk' AND node IS NOT NULL AND node != ''
       GROUP BY node`,
    ).all<Row>();
    return new Map((rows.results ?? []).map((row) => [String(row.node), Number(row.last_ok)]));
  } catch (error) {
    if (missingTable(error)) return new Map();
    throw error;
  }
}

/** Who is on a node right now: a heartbeat within the last forty minutes, not a row that never aged out. */
const OCCUPANCY_FRESH_SECONDS = 40 * 60;

async function loadOccupancy(db: D1Database, nowSec: number): Promise<Map<string, number>> {
  try {
    const rows = await db.prepare(
      `SELECT selected_server AS node, COUNT(*) AS n
       FROM ops_customer_status
       WHERE connected = 1 AND selected_server IS NOT NULL AND last_seen_at >= ?
       GROUP BY selected_server`,
    ).bind(nowSec - OCCUPANCY_FRESH_SECONDS).all<Row>();
    return new Map((rows.results ?? []).map((row) => [String(row.node), Number(row.n) || 0]));
  } catch (error) {
    if (missingTable(error)) return new Map();
    throw error;
  }
}

async function loadProfiles(db: D1Database): Promise<Map<string, string>> {
  try {
    const rows = await db.prepare(
      'SELECT catalog_name, status FROM ops_node_profiles',
    ).all<{ catalog_name: string; status: string }>();
    return new Map((rows.results ?? []).map((row) => [String(row.catalog_name), String(row.status)]));
  } catch (error) {
    if (missingTable(error)) return new Map();
    throw error;
  }
}

async function loadCustomerFacts(
  db: D1Database,
  nowSec: number,
  onlyUserId?: string,
): Promise<CustomerVerdictInput[]> {
  try {
    const filter = onlyUserId ? 'AND s.user_id = ?' : '';
    const binds = onlyUserId ? [onlyUserId] : [];
    const rows = await db.prepare(
      `SELECT s.*, u.email, w.payload_json,
              (SELECT MAX(received_at) FROM connection_events
                WHERE user_id = s.user_id AND kind = 'connectOk') AS last_ok_at,
              (SELECT COUNT(*) FROM connection_events
                WHERE user_id = s.user_id AND kind = 'nodeSwitch' AND received_at >= ?) AS switches_24h
       FROM ops_customer_status s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN telemetry_windows w ON w.id = s.last_window_id
       WHERE 1 = 1 ${filter}`,
    ).bind(nowSec - DAY, ...binds).all<Row>();
    return (rows.results ?? []).map((row) => {
      let payload: Row = {};
      try {
        payload = JSON.parse(String(row.payload_json ?? '{}')) as Row;
      } catch {
        payload = {};
      }
      const lastSeenAt = finite(row.last_seen_at);
      return {
        userId: String(row.user_id),
        email: text(row.email) ?? String(row.user_id),
        selectedServer: text(row.selected_server),
        lastSeenAt,
        online: row.connected == null ? null : Number(row.connected) === 1,
        ...delaysFromPayload(payload, lastSeenAt ?? nowSec),
        fails30m: {
          attempts: Number(row.fails_30m) || 0,
          failures: Number(row.fails_30m) || 0,
        },
        lastFailAt: finite(row.last_fail_at),
        lastOkAt: finite(row.last_ok_at),
        switches24h: Number(row.switches_24h) || 0,
        priorPathStreak: Number(row.path_streak) || 0,
      };
    });
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

function parseEvidence(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function liveDesires(
  db: D1Database,
  keep: (row: LiveIncidentRow) => boolean,
): Promise<IncidentDesire[]> {
  try {
    const rows = await db.prepare(
      `SELECT id, dedupe_key, kind, subject_type, subject_id, severity, title, detail, cause,
              parent_incident_id, impact_count, evidence_json
       FROM ops_incidents WHERE status <> 'resolved'`,
    ).all<LiveIncidentRow>();
    const list = rows.results ?? [];
    const byId = new Map(list.map((row) => [row.id, row]));
    return list.filter(keep).map((row) => ({
      dedupeKey: String(row.dedupe_key),
      kind: String(row.kind),
      subjectType: row.subject_type as IncidentDesire['subjectType'],
      subjectId: String(row.subject_id),
      severity: row.severity,
      title: String(row.title),
      detail: row.detail,
      cause: row.cause,
      parentDedupeKey: row.parent_incident_id
        ? byId.get(row.parent_incident_id)?.dedupe_key
        : undefined,
      impactCount: Number(row.impact_count) || 0,
      evidence: parseEvidence(row.evidence_json),
      carried: true,
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function persistPathStreaks(
  db: D1Database,
  streaks: Record<string, number>,
): Promise<void> {
  const entries = Object.entries(streaks);
  if (entries.length === 0) return;
  try {
    const statements = entries.map(([userId, streak]) => db.prepare(
      'UPDATE ops_customer_status SET path_streak = ? WHERE user_id = ?',
    ).bind(streak, userId));
    for (let i = 0; i < statements.length; i += 50) {
      await db.batch(statements.slice(i, i + 50));
    }
  } catch (error) {
    if (missingTable(error) || String(error).includes('no such column')) return;
    throw error;
  }
}

export async function buildVerdictInput(
  e: Env,
  nowSec: number,
  scope: CustomerScope,
): Promise<VerdictInput> {
  // One customer's pass runs on every heartbeat and never re-judges a node:
  // it only needs that customer's facts. The fleet loads below are a dozen
  // queries the telemetry POST would otherwise pay for nothing.
  if (typeof scope === 'object') {
    return {
      nodes: [],
      customers: await loadCustomerFacts(e.DB, nowSec, scope.userId),
      nowSec,
      qualitySweepAt: null,
      agentsSnapshotAt: null,
      maintenance: new Set(),
    };
  }
  const live = await loadOperationsLive(e);
  const [
    prior, catalog, fails, rollups, spikes, lastOk, occupancy, profiles, customers,
  ] = await Promise.all([
    loadPriorNodeStates(e.DB),
    catalogNameSet(e),
    loadFails30m(e.DB, nowSec),
    loadRollups(e.DB),
    loadErrorSpikes(e.DB, nowSec),
    loadLastOkAt(e.DB),
    loadOccupancy(e.DB, nowSec),
    loadProfiles(e.DB),
    scope === 'none'
      ? Promise.resolve([] as CustomerVerdictInput[])
      : loadCustomerFacts(e.DB, nowSec),
  ]);
  const quality = new Map((live.quality?.nodes ?? []).map((node) => [String(node.name), node]));
  const agents = new Map((live.agents ?? []).map((node) => [String(node.name), node]));
  // A machine is judged only if something that knows machines names it: the
  // sweep, the agent copy, the catalog or a profile. Client events and old
  // status rows contribute facts about known names, never membership — a
  // client that reports an exit by its device-scoped id would otherwise
  // conjure a healthy-looking node called 9B20CAD5-… out of nothing.
  const names = new Set<string>([
    ...quality.keys(),
    ...agents.keys(),
    ...(catalog ?? []),
    ...profiles.keys(),
  ]);
  const nodes: NodeVerdictInput[] = [...names].sort().map((name) => {
    const q = quality.get(name);
    const agent = agents.get(name);
    const stored = prior.get(name);
    const okAt = lastOk.get(name) ?? stored?.lastCustomerOkAt ?? null;
    return {
      name,
      catalogListed: catalog ? catalog.has(name) : null,
      ok: q ? q.ok === true : null,
      blockStatus: blockStatusOf(q),
      agentObservedAt: finite(agent?.observedAt),
      carriers: asCarriers(agent?.carriers),
      machine: asMachine(agent, rollups.get(name)),
      occupancy: occupancy.get(name) ?? 0,
      profileStatus: profiles.get(name) ?? null,
      prior: stored
        ? {
          verdict: stored.verdict,
          candidateVerdict: stored.candidateVerdict,
          candidateStreak: stored.candidateStreak,
          changedAt: stored.changedAt,
        }
        : null,
      fails30m: fails.get(name) ?? { attempts: 0, failures: 0, distinctUsers: 0, handshakeDistinctUsers: 0 },
      lastCustomerOkAt: okAt,
      errorSpike: spikes.has(name),
    };
  });
  return {
    nodes,
    customers,
    nowSec,
    qualitySweepAt: live.qualityReceivedAt,
    agentsSnapshotAt: live.agentsReceivedAt,
    maintenance: new Set(),
  };
}

