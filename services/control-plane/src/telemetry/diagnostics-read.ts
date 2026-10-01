// Read-only diagnostics for the engineering bot and the ops customer page.
// Responses carry pseudonymous ids, versions, and redacted samples. They do
// not join users.email and do not return hostnames or full IPs.

import { ApiError } from '../errors';
import { tokenMatches } from './failure-clusters';

type Row = Record<string, unknown>;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function num(value: unknown): number {
  return Number(value) || 0;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function authorizeDiagnosticsRead(req: Request, expected: string | undefined): Promise<void> {
  const secret = expected?.trim() ?? '';
  if (secret.length < 32) throw new ApiError(503, 'SERVICE_MISCONFIGURED', 'Diagnostics read token is not configured');
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!await tokenMatches(presented, secret)) throw new ApiError(401, 'UNAUTHORIZED', 'Unauthorized');
}

function clusterDto(row: Row) {
  let sample: unknown = null;
  try {
    sample = typeof row.sample_json === 'string' ? JSON.parse(row.sample_json) : null;
  } catch {
    sample = null;
  }
  return {
    id: String(row.id),
    code: String(row.code),
    stage: String(row.stage),
    appVersion: String(row.app_version),
    platform: String(row.platform),
    node: String(row.node),
    severity: row.severity === 'p0' || row.severity === 'normal'
      ? row.severity
      : (typeof row.code === 'string' && [
        'TONO_NETWORK_LOSS', 'TONO_FAIL_OPEN', 'TONO_WATCHDOG_RESTORE',
        'TONO_KILL_SWITCH_STUCK', 'TONO_RESTORE_NETWORK', 'TONO_CRASH_WHILE_PROTECTED',
      ].includes(row.code) ? 'p0' : 'normal'),
    count: num(row.event_count),
    users: num(row.user_count),
    devices: num(row.device_count),
    firstSeenMs: num(row.first_seen_ms),
    lastSeenMs: num(row.last_seen_ms),
    status: String(row.status),
    sample,
    detailPath: `/api/v1/diagnostics/clusters/${row.id}`,
  };
}

export async function listFailureClusters(db: D1Database, url: URL): Promise<Response> {
  const nowSec = Math.floor(Date.now() / 1000);
  const from = parseWindow(url.searchParams.get('from'), nowSec - 86_400);
  const to = parseWindow(url.searchParams.get('to'), nowSec);
  if (to < from || to - from > 7 * 86_400) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid time window');
  }
  const rows = await db.prepare(
    `SELECT * FROM failure_clusters
     WHERE last_seen_ms >= ? AND first_seen_ms <= ?
     ORDER BY last_seen_ms DESC LIMIT 100`,
  ).bind(from * 1000, (to + 1) * 1000).all<Row>();
  return Response.json({ clusters: (rows.results ?? []).map(clusterDto) }, {
    headers: { 'cache-control': 'no-store' },
  });
}

function parseWindow(raw: string | null, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid time window');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid time window');
  return value;
}

export async function failureClusterDetail(db: D1Database, clusterId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(clusterId)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cluster id');
  const cluster = await db.prepare('SELECT * FROM failure_clusters WHERE id = ?').bind(clusterId).first<Row>();
  if (!cluster) throw new ApiError(404, 'NOT_FOUND', 'Cluster not found');
  const members = await db.prepare(
    `SELECT user_id, device_id FROM failure_cluster_members WHERE cluster_id = ? LIMIT 50`,
  ).bind(clusterId).all<Row>();
  const userIds = [...new Set((members.results ?? []).map((row) => String(row.user_id)))].slice(0, 20);
  const sessions = [];
  const dnsChecks = [];
  const hops = [];
  const exits = [];
  for (const userId of userIds) {
    sessions.push(...await sessionRows(db, userId));
    dnsChecks.push(...await dnsRows(db, userId));
    hops.push(...await hopRows(db, userId));
    exits.push(...await exitRows(db, userId));
  }
  return Response.json({
    cluster: clusterDto(cluster),
    members: (members.results ?? []).map((row) => ({
      userId: String(row.user_id),
      deviceId: text(row.device_id),
    })),
    sessions,
    dnsChecks,
    hops,
    exits,
  }, { headers: { 'cache-control': 'no-store' } });
}

async function exitRows(db: D1Database, userId: string) {
  try {
    const rows = await db.prepare(
      `SELECT at_ms, ip_prefix, asn, country, city, network_kind, previous_asn, previous_country, previous_city
       FROM session_exit_observations WHERE user_id = ? ORDER BY at_ms DESC LIMIT 20`,
    ).bind(userId).all<Row>();
    return (rows.results ?? []).map((row) => ({
      atMs: num(row.at_ms),
      ipPrefix: text(row.ip_prefix),
      asn: row.asn == null ? null : num(row.asn),
      country: text(row.country),
      city: text(row.city),
      networkKind: String(row.network_kind),
      previousAsn: row.previous_asn == null ? null : num(row.previous_asn),
      previousCountry: text(row.previous_country),
      previousCity: text(row.previous_city),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

async function sessionRows(db: D1Database, userId: string) {
  try {
    const rows = await db.prepare(
      `SELECT id, device_id, started_at_ms, ended_at_ms, node, entry_node_id, residential_exit_id,
              bytes_up, bytes_down, outcome, reason, app_version, app_build, git_commit, platform,
              os_version, core_version, channel
       FROM client_sessions WHERE user_id = ? ORDER BY started_at_ms DESC LIMIT 20`,
    ).bind(userId).all<Row>();
    return (rows.results ?? []).map(sessionDto);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

async function dnsRows(db: D1Database, userId: string) {
  try {
    const rows = await db.prepare(
      `SELECT id, device_id, at_ms, resolver, leak_outside, geo_matches_exit, mode, ipv6_leak,
              resolver_asn, resolver_country, exit_asn, exit_country, app_version, channel
       FROM dns_checks WHERE user_id = ? ORDER BY at_ms DESC LIMIT 20`,
    ).bind(userId).all<Row>();
    return (rows.results ?? []).map((row) => ({
      id: String(row.id),
      deviceId: text(row.device_id),
      atMs: num(row.at_ms),
      resolver: String(row.resolver),
      leakOutside: num(row.leak_outside) === 1,
      geoMatchesExit: row.geo_matches_exit == null ? null : num(row.geo_matches_exit) === 1,
      mode: String(row.mode),
      ipv6Leak: num(row.ipv6_leak) === 1,
      resolverAsn: row.resolver_asn == null ? null : num(row.resolver_asn),
      resolverCountry: text(row.resolver_country),
      exitAsn: row.exit_asn == null ? null : num(row.exit_asn),
      exitCountry: text(row.exit_country),
      appVersion: text(row.app_version),
      channel: text(row.channel),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

async function hopRows(db: D1Database, userId: string) {
  try {
    const rows = await db.prepare(
      `SELECT id, session_id, device_id, hop_index, hop_role, node_id, connected, handshake_ms,
              failure_code, at_ms
       FROM chain_hops WHERE user_id = ? ORDER BY at_ms DESC LIMIT 40`,
    ).bind(userId).all<Row>();
    return (rows.results ?? []).map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      deviceId: text(row.device_id),
      index: num(row.hop_index),
      role: String(row.hop_role),
      nodeId: text(row.node_id),
      connected: num(row.connected) === 1,
      handshakeMs: row.handshake_ms == null ? null : num(row.handshake_ms),
      failureCode: text(row.failure_code),
      atMs: num(row.at_ms),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export function sessionDto(row: Row) {
  return {
    id: String(row.id),
    deviceId: text(row.device_id),
    startedAtMs: num(row.started_at_ms),
    endedAtMs: row.ended_at_ms == null ? null : num(row.ended_at_ms),
    node: text(row.node),
    entryNodeId: text(row.entry_node_id),
    residentialExitId: text(row.residential_exit_id),
    bytesUp: num(row.bytes_up),
    bytesDown: num(row.bytes_down),
    outcome: text(row.outcome),
    reason: text(row.reason),
    appVersion: text(row.app_version) ?? '',
    appBuild: text(row.app_build),
    gitCommit: text(row.git_commit),
    platform: text(row.platform),
    osVersion: text(row.os_version),
    coreVersion: text(row.core_version),
    channel: text(row.channel),
  };
}

export async function loadCustomerDiagnostics(db: D1Database, userId: string, deviceId: string | null) {
  const deviceClause = deviceId ? ' AND device_id = ?' : '';
  const bind = deviceId ? [userId, deviceId] : [userId];
  const sessions = await sessionQuery(db, deviceClause, bind);
  const hops = await hopQuery(db, deviceClause, bind);
  const exits = await exitQuery(db, deviceClause, bind);
  const dnsChecks = await dnsQuery(db, deviceClause, bind);
  const aiRoutes = await aiQuery(db, deviceClause, bind);
  const updatedAt = Math.floor(Date.now() / 1000);
  return { userId, sessions, hops, exits, dnsChecks, aiRoutes, updatedAt };
}

async function sessionQuery(db: D1Database, deviceClause: string, bind: string[]) {
  try {
    const rows = await db.prepare(
      `SELECT id, device_id, started_at_ms, ended_at_ms, node, entry_node_id, residential_exit_id,
              bytes_up, bytes_down, outcome, reason, app_version, app_build, git_commit, platform,
              os_version, core_version, channel
       FROM client_sessions WHERE user_id = ?${deviceClause} ORDER BY started_at_ms DESC LIMIT 50`,
    ).bind(...bind).all<Row>();
    return (rows.results ?? []).map(sessionDto);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

async function hopQuery(db: D1Database, deviceClause: string, bind: string[]) {
  try {
    const rows = await db.prepare(
      `SELECT session_id, device_id, hop_index, hop_role, node_id, connected, handshake_ms, failure_code, at_ms
       FROM chain_hops WHERE user_id = ?${deviceClause} ORDER BY at_ms DESC LIMIT 80`,
    ).bind(...bind).all<Row>();
    return (rows.results ?? []).map((row) => ({
      sessionId: String(row.session_id),
      deviceId: text(row.device_id),
      index: num(row.hop_index),
      role: row.hop_role === 'residential' ? 'residential' as const : 'entry' as const,
      nodeId: text(row.node_id),
      connected: num(row.connected) === 1,
      handshakeMs: row.handshake_ms == null ? null : num(row.handshake_ms),
      failureCode: text(row.failure_code),
      atMs: num(row.at_ms),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

async function exitQuery(db: D1Database, deviceClause: string, bind: string[]) {
  try {
    const rows = await db.prepare(
      `SELECT at_ms, ip_prefix, asn, country, city, network_kind, previous_asn, previous_country, previous_city
       FROM session_exit_observations WHERE user_id = ?${deviceClause} ORDER BY at_ms DESC LIMIT 40`,
    ).bind(...bind).all<Row>();
    return (rows.results ?? []).map((row) => ({
      atMs: num(row.at_ms),
      ipPrefix: text(row.ip_prefix),
      asn: row.asn == null ? null : num(row.asn),
      country: text(row.country),
      city: text(row.city),
      networkKind: String(row.network_kind),
      previousAsn: row.previous_asn == null ? null : num(row.previous_asn),
      previousCountry: text(row.previous_country),
      previousCity: text(row.previous_city),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

async function dnsQuery(db: D1Database, deviceClause: string, bind: string[]) {
  try {
    const rows = await db.prepare(
      `SELECT at_ms, resolver, leak_outside, geo_matches_exit, mode, ipv6_leak, resolver_country,
              exit_country, app_version, channel
       FROM dns_checks WHERE user_id = ?${deviceClause} ORDER BY at_ms DESC LIMIT 40`,
    ).bind(...bind).all<Row>();
    return (rows.results ?? []).map((row) => ({
      atMs: num(row.at_ms),
      resolver: String(row.resolver),
      leakOutside: num(row.leak_outside) === 1,
      geoMatchesExit: row.geo_matches_exit == null ? null : num(row.geo_matches_exit) === 1,
      mode: String(row.mode),
      ipv6Leak: num(row.ipv6_leak) === 1,
      resolverCountry: text(row.resolver_country),
      exitCountry: text(row.exit_country),
      appVersion: text(row.app_version),
      channel: text(row.channel),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

async function aiQuery(db: D1Database, deviceClause: string, bind: string[]) {
  try {
    const rows = await db.prepare(
      `SELECT bucket_start_ms, service, exit_kind, exit_id, exit_country, routing_leak, exit_switched,
              dns_ok, tz_mismatch, app_version, channel
       FROM ai_service_routes WHERE user_id = ?${deviceClause} ORDER BY bucket_start_ms DESC LIMIT 40`,
    ).bind(...bind).all<Row>();
    return (rows.results ?? []).map((row) => ({
      bucketStartMs: num(row.bucket_start_ms),
      service: String(row.service),
      exitKind: String(row.exit_kind),
      exitId: text(row.exit_id),
      exitCountry: text(row.exit_country),
      routingLeak: num(row.routing_leak) === 1,
      exitSwitched: num(row.exit_switched) === 1,
      dnsOk: row.dns_ok == null ? null : num(row.dns_ok) === 1,
      tzMismatch: row.tz_mismatch == null ? null : num(row.tz_mismatch) === 1,
      appVersion: text(row.app_version),
      channel: text(row.channel),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}
