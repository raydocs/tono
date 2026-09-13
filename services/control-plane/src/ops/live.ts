import { type Env, type Row, now } from '../env';
import { optionalText, optionalNumber } from '../request';
import type { OpsRequestCache } from './cache';

// Every status the fleet quality endpoints can emit: the collector's block
// verdicts (ops-panel/collect.py classify_block) plus the ones synthesized in
// fleetQualityStatus below. The console's label table is pinned to this list
// by a drift test, so a new verdict cannot ship without an operator label.
export const FLEET_QUALITY_STATUSES = [
  'OK',
  'LIKELY_BLOCKED',
  'DEGRADED',
  'EDGE_OK',
  'EDGE_FAIL',
  'DOWN',
  'UNPROBED',
  'CHECK_FAILED',
  'UNKNOWN',
] as const;

export function fleetQualityStatus(node: Row | undefined): { status: string; label: string } {
  if (!node) return { status: 'UNKNOWN', label: '未测' };
  const block = node.block && typeof node.block === 'object' && !Array.isArray(node.block)
    ? node.block as Row
    : null;
  const reported = typeof block?.status === 'string' ? block.status : null;
  if (reported === 'LIKELY_BLOCKED') return { status: reported, label: '疑似被墙' };
  if (node.ok !== true) return { status: 'DOWN', label: '整机失联' };
  if (reported) return { status: reported, label: optionalText(block?.label) ?? reported };
  return { status: 'OK', label: '大陆正常' };
}

// Live node telemetry for the admin monitor. The collector on the ops VPS
// pushes a sanitized snapshot (`PUT /api/v1/ops-ingest/snapshot`); the stored
// row is the only source.
//
// It used to fall back to fetching ops.afk.ccwu.cc and quality.afk.ccwu.cc
// when no row existed. Those hostnames are now absorbed by `admin-worker.ts`,
// which answers them with a 302 to the admin console — so the fallback fetched
// this deployment's own SPA HTML, failed to parse it as JSON, and reported the
// parse error as `qualityError` after two 8s timeouts. A stale snapshot beats
// a request that cannot succeed; without one, /ops/live says so.
const OPS_LIVE_MAX_NODES = 64;
const OPS_LIVE_TEXT_LIMIT = 12_000;

export function liveKeywordList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .slice(0, limit)
    .map((entry) => entry.slice(0, 40));
}

export function liveProbeSummary(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Row;
  const summary: Row = {};
  if (typeof raw.ok === 'boolean') summary.ok = raw.ok;
  for (const key of ['success', 'fail', 'total'] as const) {
    if (Number.isSafeInteger(raw[key]) && raw[key] >= 0) summary[key] = raw[key];
  }
  if (typeof raw.rate === 'number' && Number.isFinite(raw.rate)) summary.rate = raw.rate;
  if (typeof raw.status === 'string' && raw.status) summary.status = raw.status.slice(0, 40);
  if (typeof raw.source === 'string' && raw.source) summary.source = raw.source.slice(0, 80);
  if (typeof raw.note === 'string' && raw.note) summary.note = raw.note.slice(0, 240);
  if (raw.authoritative === true) summary.authoritative = true;
  return Object.keys(summary).length ? summary : null;
}

export function liveBoundedText(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.length > OPS_LIVE_TEXT_LIMIT ? value.slice(0, OPS_LIVE_TEXT_LIMIT) : value;
}

// `includeText` keeps the multi-kilobyte securityCheck/backtrace bodies. The
// stored snapshot keeps them (they are the drawer's source of truth), but the
// list responses the console polls every fifteen seconds do not: at 64 nodes
// that is megabytes per minute for text only ever read one node at a time,
// through the fleet-nodes quality-text endpoint.
export function liveQualityNode(raw: unknown, includeText = true): Row | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const node = raw as Row;
  const name = optionalText(node.name);
  if (!name) return null;
  const blockRaw = node.block && typeof node.block === 'object' && !Array.isArray(node.block)
    ? node.block as Row
    : null;
  return {
    name,
    host: optionalText(node.host),
    publicIp: optionalText(node.publicIp ?? node.public_ip),
    ok: node.ok === true,
    quality: optionalText(node.quality),
    riskKeywords: liveKeywordList(node.riskKeywords ?? node.risk_keywords),
    routeKeywords: liveKeywordList(node.routeKeywords ?? node.route_keywords),
    block: blockRaw
      ? {
          status: optionalText(blockRaw.status),
          label: optionalText(blockRaw.label),
          rule: liveBoundedText(blockRaw.rule),
          mainland: liveProbeSummary(blockRaw.mainland),
          asiaEdge: liveProbeSummary(blockRaw.asiaEdge ?? blockRaw.asia_edge),
          overseas: liveProbeSummary(blockRaw.overseas),
        }
      : null,
    riskSignals: liveRiskSignals(node.riskSignals ?? node.risk_signals),
    exposure: liveExposure(node.exposure),
    ...(includeText
      ? {
          securityCheck: liveBoundedText(node.securityCheck ?? node.security_check),
          backtrace: liveBoundedText(node.backtrace),
        }
      : {}),
  };
}

// How many of securityCheck's seventeen databases took each side.
//
// The collector used to report a tag whenever any single database said yes,
// which put the word "attacker" beside a node that two of three databases
// called clean. The tally is carried so the console can show what was actually
// found rather than a verdict nothing supports.
export function liveRiskSignals(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  const signals: Row[] = [];
  for (const raw of value.slice(0, 12)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const signal = raw as Row;
    const tag = optionalText(signal.tag);
    if (!tag) continue;
    const yes = optionalNumber(signal.yes);
    const no = optionalNumber(signal.no);
    if (yes === null || yes < 0) continue;
    signals.push({ tag: tag.slice(0, 24), yes, no: no === null || no < 0 ? 0 : no });
  }
  return signals;
}

// What the node offers the internet. `null` when the collector predates this,
// which the console must show as unknown rather than as clean: a node nobody
// has looked at is exactly the state the leak lived in.
export function liveExposure(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Row;
  const listeners = (input: unknown, withReason: boolean): Row[] => {
    if (!Array.isArray(input)) return [];
    const rows: Row[] = [];
    for (const entry of input.slice(0, 32)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const listener = entry as Row;
      const port = optionalNumber(listener.port);
      if (port === null || port < 0 || port > 65535) continue;
      const row: Row = {
        port,
        address: optionalText(listener.address),
        process: optionalText(listener.process),
      };
      if (withReason) row.reason = liveBoundedText(listener.reason);
      rows.push(row);
    }
    return rows;
  };
  const sshPorts = Array.isArray(raw.sshPorts)
    ? raw.sshPorts
        .map((port) => optionalNumber(port))
        .filter((port): port is number => port !== null && port > 0 && port <= 65535)
        .slice(0, 8)
    : [];
  return {
    clean: raw.clean === true,
    sshPorts,
    unexpected: listeners(raw.unexpected, false),
    acknowledged: listeners(raw.acknowledged, true),
    expected: listeners(raw.expected, false),
  };
}

export function liveObservedAt(value: unknown, receivedAt?: number): number | null {
  const observedAt = optionalNumber(value);
  if (observedAt === null || !Number.isFinite(observedAt)) return null;
  if (observedAt <= 0) return receivedAt ?? null;
  if (receivedAt !== undefined && observedAt > receivedAt + 5 * 60) {
    return receivedAt;
  }
  return observedAt;
}

export function liveQualityReport(
  value: unknown,
  receivedAt?: number,
  includeText = true,
): { updatedAt: number | null; updatedAtIso: string | null; cnAgentsConfigured: number | null; nodes: Row[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Row;
  const sourceNodes = Array.isArray(raw.nodes) ? raw.nodes : null;
  if (!sourceNodes) return null;
  const nodes = sourceNodes.slice(0, OPS_LIVE_MAX_NODES)
    .map((node) => liveQualityNode(node, includeText))
    .filter((node): node is Row => node !== null);
  const updatedAt = liveObservedAt(raw.updatedAt ?? raw.updated_at, receivedAt);
  return {
    updatedAt,
    // Keep the two representations consistent when a broken collector clock is
    // pinned to receipt time. The console uses the integer for incident age, but
    // a contradictory ISO string is still misleading to API consumers.
    updatedAtIso: updatedAt === null
      ? optionalText(raw.updatedAtIso ?? raw.updated_at_iso)
      : new Date(updatedAt * 1_000).toISOString(),
    cnAgentsConfigured: optionalNumber(raw.cnAgentsConfigured ?? raw.cn_agents_configured),
    nodes,
  };
}

const CARRIER_KEYS = ['unicom', 'telecom', 'mobile'] as const;
const CARRIER_HISTORY_MAX = 48;

/**
 * Per-carrier mainland latency and loss for one node, as measured *from* it.
 *
 * A carrier that was never measured is absent from this object — never present
 * with zeros. Komari reports an unrun ping task as `avg: 0, loss: 0`, which is
 * field-for-field identical to a flawless result, so the collector drops those
 * before sending and anything that arrives here claiming a carrier is claiming
 * it was actually probed. The console renders a missing carrier as unknown.
 *
 * This is not the block verdict and cannot stand in for it. These probes leave
 * the node heading for China; whether China can open a connection back to the
 * node is the other direction, measured by the mainland agents. A node can be
 * perfect here and still be unreachable from inside the country.
 */
export function liveCarriers(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Row;
  const out: Row = {};
  for (const key of CARRIER_KEYS) {
    const raw = source[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const carrier = raw as Row;
    const samples = optionalNumber(carrier.samples);
    // No samples, no carrier. Anything else would put a number on screen for a
    // path nothing has travelled.
    if (samples === null || samples <= 0) continue;
    const history = Array.isArray(carrier.history)
      ? carrier.history.slice(0, CARRIER_HISTORY_MAX).map((point: unknown) => {
        if (!point || typeof point !== 'object' || Array.isArray(point)) {
          return { latencyMs: null, lossPct: null };
        }
        const entry = point as Row;
        return {
          latencyMs: optionalNumber(entry.latencyMs),
          lossPct: optionalNumber(entry.lossPct),
        };
      })
      : [];
    out[key] = {
      latencyMs: optionalNumber(carrier.latencyMs),
      lossPct: optionalNumber(carrier.lossPct),
      samples,
      targets: Array.isArray(carrier.targets)
        ? carrier.targets.slice(0, 12).map((name: unknown) => optionalText(name)).filter(Boolean)
        : [],
      history,
    };
  }
  return Object.keys(out).length ? out : null;
}

export function liveAgents(value: unknown, receivedAt?: number): Row[] | null {
  if (value === null || value === undefined) return null;
  const rows = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray((value as Row).data) ? (value as Row).data : null);
  if (!rows) return null;
  return rows.slice(0, OPS_LIVE_MAX_NODES).map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const node = raw as Row;
    const name = optionalText(node.name);
    if (!name) return null;
    return {
      name,
      os: optionalText(node.os),
      arch: optionalText(node.arch),
      cpuName: optionalText(node.cpuName ?? node.cpu_name),
      cpu: optionalNumber(node.cpu ?? node.cpu_used ?? node.cpuUsed),
      memTotal: optionalNumber(node.memTotal ?? node.mem_total),
      memUsed: optionalNumber(node.memUsed ?? node.mem_used),
      diskTotal: optionalNumber(node.diskTotal ?? node.disk_total),
      diskUsed: optionalNumber(node.diskUsed ?? node.disk_used),
      netIn: optionalNumber(node.netIn ?? node.net_in ?? node.net_in_transfer),
      netOut: optionalNumber(node.netOut ?? node.net_out ?? node.net_out_transfer),
      uptime: optionalNumber(node.uptime),
      // The fields that answer "which box is in trouble" rather than "what is
      // this box". Load against core count is the one number that separates a
      // node that is busy from a node that is failing to keep up; swap in use
      // on a 1 GB VPS means it is already thrashing; and a stalled agent is
      // indistinguishable from a healthy idle one without `observedAt`, which
      // is how a dead collector reads as a quiet fleet.
      cpuCores: optionalNumber(node.cpuCores ?? node.cpu_cores),
      load1: optionalNumber(node.load1 ?? node.load_1),
      load5: optionalNumber(node.load5 ?? node.load_5),
      load15: optionalNumber(node.load15 ?? node.load_15),
      swapTotal: optionalNumber(node.swapTotal ?? node.swap_total),
      swapUsed: optionalNumber(node.swapUsed ?? node.swap_used),
      tcpConnections: optionalNumber(node.tcpConnections ?? node.tcp_connections),
      processes: optionalNumber(node.processes ?? node.process),
      observedAt: liveObservedAt(node.observedAt ?? node.observed_at, receivedAt),
      // Komari /api/nodes inventory. Manual nodeProfiles still win when filled;
      // these fill the holes so "which box renews / is about to blow quota"
      // is not a second spreadsheet.
      price: optionalNumber(node.price),
      currency: optionalText(node.currency)?.slice(0, 8) ?? null,
      billingCycle: optionalNumber(node.billingCycle ?? node.billing_cycle),
      expiredAt: optionalNumber(node.expiredAt ?? node.expired_at),
      trafficLimit: optionalNumber(node.trafficLimit ?? node.traffic_limit),
      trafficLimitType: optionalText(node.trafficLimitType ?? node.traffic_limit_type)?.slice(0, 16) ?? null,
      // How this node reaches 联通 / 电信 / 移动 — the half of "is this exit any
      // good" that reachability alone never answered.
      carriers: liveCarriers(node.carriers),
    };
  }).filter((node: Row | null): node is Row => node !== null);
}

export async function storedLiveSnapshot(e: Env) {
  try {
    return await e.DB.prepare(
      'SELECT quality_json, agents_json, quality_updated_at, agents_updated_at FROM operations_live_snapshot WHERE singleton_id = 1',
    ).first<Row>();
  } catch (error) {
    // Migration 0022 may not have been applied yet; keep the legacy origin fetch.
    if (String(error).includes('no such table')) return null;
    throw error;
  }
}

export async function storeLiveSnapshot(e: Env, input: { quality?: ReturnType<typeof liveQualityReport>; agents?: Row[] }) {
  const t = now();
  const current = await storedLiveSnapshot(e);
  const quality = input.quality === undefined
    ? (current?.quality_json ? JSON.parse(String(current.quality_json)) : null)
    : input.quality;
  const agents = input.agents === undefined
    ? (current?.agents_json ? JSON.parse(String(current.agents_json)) : null)
    : input.agents;
  const qualityUpdatedAt = input.quality === undefined
    ? optionalNumber(current?.quality_updated_at)
    : t;
  const agentsUpdatedAt = input.agents === undefined
    ? optionalNumber(current?.agents_updated_at)
    : t;
  await e.DB.prepare(
    `INSERT INTO operations_live_snapshot(
       singleton_id, quality_json, agents_json, quality_updated_at, agents_updated_at, updated_at
     ) VALUES(1, ?, ?, ?, ?, ?)
     ON CONFLICT(singleton_id) DO UPDATE SET
       quality_json = excluded.quality_json,
       agents_json = excluded.agents_json,
       quality_updated_at = excluded.quality_updated_at,
       agents_updated_at = excluded.agents_updated_at,
       updated_at = excluded.updated_at`,
  ).bind(
    quality ? JSON.stringify(quality) : null,
    agents ? JSON.stringify(agents) : null,
    qualityUpdatedAt,
    agentsUpdatedAt,
    t,
  ).run();
  return { qualityUpdatedAt, agentsUpdatedAt, updatedAt: t };
}

export async function loadOperationsLive(e: Env) {
  const stored = await storedLiveSnapshot(e);
  const rawQualityReceivedAt = optionalNumber(stored?.quality_updated_at);
  const rawAgentsReceivedAt = optionalNumber(stored?.agents_updated_at);
  const qualityReceivedAt = rawQualityReceivedAt !== null &&
    Number.isFinite(rawQualityReceivedAt) && rawQualityReceivedAt > 0
    ? Math.floor(rawQualityReceivedAt)
    : null;
  const agentsReceivedAt = rawAgentsReceivedAt !== null &&
    Number.isFinite(rawAgentsReceivedAt) && rawAgentsReceivedAt > 0
    ? Math.floor(rawAgentsReceivedAt)
    : null;
  const quality = stored?.quality_json
    ? liveQualityReport(
      JSON.parse(String(stored.quality_json)),
      qualityReceivedAt ?? undefined,
      false,
    )
    : null;
  const agents = stored?.agents_json
    ? liveAgents(
      JSON.parse(String(stored.agents_json)),
      agentsReceivedAt ?? undefined,
    )
    : null;
  const qualityError = quality ? null : 'no quality snapshot';
  const agentsError = agents ? null : 'no agent snapshot';

  return {
    fetchedAt: now(),
    agents,
    agentsError,
    agentsReceivedAt,
    quality,
    qualityError,
    qualityReceivedAt,
  };
}

export function operationsLive(e: Env, cache?: OpsRequestCache) {
  if (!cache) return loadOperationsLive(e);
  return cache.live ??= loadOperationsLive(e);
}

/**
 * One node of the stored quality snapshot, without parsing the rest of it.
 *
 * `json_each` walks the snapshot inside SQLite and only the matching node's
 * JSON crosses into the Worker — this is how the per-user detail view and the
 * quality-text drawer avoid materializing a 64-node report to read one entry.
 */
export async function liveQualityNodeNamed(e: Env, name: string | null): Promise<Row | null> {
  if (!name) return null;
  let row: Row | null;
  try {
    row = await e.DB.prepare(
      `SELECT entry.value AS node_json
       FROM operations_live_snapshot, json_each(operations_live_snapshot.quality_json, '$.nodes') AS entry
       WHERE singleton_id = 1 AND json_extract(entry.value, '$.name') = ?
       LIMIT 1`,
    ).bind(name).first<Row>();
  } catch (error) {
    if (String(error).includes('no such table')) return null;
    throw error;
  }
  if (!row?.node_json) return null;
  try {
    return liveQualityNode(JSON.parse(String(row.node_json)));
  } catch {
    return null;
  }
}

export const NODE_HEALTH_LABELS: Record<string, string> = {
  ok: '大陆正常',
  blocked: '疑似被墙',
  down: '整机失联',
  unknown: '未测',
};

/**
 * Join a catalog name against the collector quality snapshot.
 *
 * `ok: false` is the machine, not GFW: overseas probes failing with the
 * mainland is how a dead VPS was labelled 疑似被墙. Blocked is only when the
 * box still answers elsewhere.
 */
export function nodeHealthFromQuality(node: Row | null | undefined): { nodeHealth: string; nodeHealthLabel: string } {
  if (!node) {
    return { nodeHealth: 'unknown', nodeHealthLabel: NODE_HEALTH_LABELS.unknown };
  }
  const block = node.block && typeof node.block === 'object' && !Array.isArray(node.block)
    ? node.block as Row
    : null;
  const status = typeof block?.status === 'string' ? block.status : null;
  if (node.ok !== true) {
    return { nodeHealth: 'down', nodeHealthLabel: NODE_HEALTH_LABELS.down };
  }
  if (status === 'LIKELY_BLOCKED') {
    return { nodeHealth: 'blocked', nodeHealthLabel: NODE_HEALTH_LABELS.blocked };
  }
  if (status === 'OK' || node.ok === true) {
    return { nodeHealth: 'ok', nodeHealthLabel: NODE_HEALTH_LABELS.ok };
  }
  return { nodeHealth: 'unknown', nodeHealthLabel: NODE_HEALTH_LABELS.unknown };
}
