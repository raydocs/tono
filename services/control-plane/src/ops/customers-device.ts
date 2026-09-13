// ops_device_status writes and the customer-row derivation from them.

import { compareVersions } from './releases';
import { HEARTBEAT_FRESH_SECONDS } from './verdict-customers';

type Row = Record<string, any>;

export const FAIL_WINDOW_SECONDS = 30 * 60;
const VERSION_WINDOW_SECONDS = 30 * 86_400;

export function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.length ? value : null;
}

export function decayFails30m(previous: number, elapsedSec: number): number {
  if (previous <= 0 || elapsedSec >= FAIL_WINDOW_SECONDS) return 0;
  if (elapsedSec <= 0) return previous;
  return Math.round(previous * (FAIL_WINDOW_SECONDS - elapsedSec) / FAIL_WINDOW_SECONDS);
}

function heartbeatFresh(lastSeenAt: number | null, nowSec: number): boolean {
  return lastSeenAt !== null && nowSec - lastSeenAt <= HEARTBEAT_FRESH_SECONDS;
}

export async function loadDevices(db: D1Database, userId: string): Promise<Row[]> {
  const rows = await db.prepare(
    'SELECT * FROM ops_device_status WHERE user_id = ?',
  ).bind(userId).all<Row>();
  return rows.results ?? [];
}

function minAppVersion(devices: Row[], nowSec: number): string | null {
  const cutoff = nowSec - VERSION_WINDOW_SECONDS;
  let best: string | null = null;
  for (const row of devices) {
    const seen = finite(row.last_seen_at);
    if (seen === null || seen < cutoff) continue;
    const version = text(row.app_version);
    if (!version) continue;
    if (best === null || compareVersions(version, best) < 0) best = version;
  }
  return best;
}

function representative(devices: Row[], nowSec: number): Row | null {
  const connected = devices.filter((row) => (
    Number(row.connected) === 1 && heartbeatFresh(finite(row.last_seen_at), nowSec)
  ));
  const pool = connected.length > 0 ? connected : devices;
  let best: Row | null = null;
  let bestSeen = Number.NEGATIVE_INFINITY;
  for (const row of pool) {
    const seen = finite(row.last_seen_at) ?? 0;
    if (seen >= bestSeen) {
      best = row;
      bestSeen = seen;
    }
  }
  return best;
}

export type CustomerWrite = {
  userId: string;
  deviceId: string | null;
  platform: string | null;
  appVersion: string | null;
  osVersion: string | null;
  uiState: string | null;
  connected: number;
  connectedSince: number | null;
  selectedServer: string | null;
  catalogRevision: number | null;
  lastSeenAt: number | null;
  lastWindowId: string | null;
  edgeAsn: number | null;
  edgeAsOrg: string | null;
  edgeCountry: string | null;
  edgeRegion: string | null;
  lastFailAt: number | null;
  lastFailCode: string | null;
  lastFailNode: string | null;
  fails30m: number;
  firstConnectedAt: number | null;
  updatedAt: number;
};

export async function upsertCustomer(db: D1Database, row: CustomerWrite): Promise<void> {
  await db.prepare(
    `INSERT INTO ops_customer_status (
       user_id, device_id, platform, app_version, os_version,
       ui_state, connected, connected_since,
       selected_server, catalog_revision,
       last_seen_at, last_window_id,
       edge_asn, edge_as_org, edge_country, edge_region,
       last_fail_at, last_fail_code, last_fail_node, fails_30m,
       updated_at, first_connected_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       device_id = excluded.device_id,
       platform = excluded.platform,
       app_version = COALESCE(excluded.app_version, ops_customer_status.app_version),
       os_version = excluded.os_version,
       ui_state = CASE
         WHEN excluded.connected = 1 THEN 'connected'
         WHEN excluded.ui_state IS NOT NULL THEN excluded.ui_state
         ELSE ops_customer_status.ui_state
       END,
       connected = excluded.connected,
       connected_since = excluded.connected_since,
       selected_server = excluded.selected_server,
       catalog_revision = COALESCE(excluded.catalog_revision, ops_customer_status.catalog_revision),
       last_seen_at = excluded.last_seen_at,
       last_window_id = COALESCE(excluded.last_window_id, ops_customer_status.last_window_id),
       edge_asn = COALESCE(excluded.edge_asn, ops_customer_status.edge_asn),
       edge_as_org = COALESCE(excluded.edge_as_org, ops_customer_status.edge_as_org),
       edge_country = COALESCE(excluded.edge_country, ops_customer_status.edge_country),
       edge_region = COALESCE(excluded.edge_region, ops_customer_status.edge_region),
       last_fail_at = COALESCE(excluded.last_fail_at, ops_customer_status.last_fail_at),
       last_fail_code = COALESCE(excluded.last_fail_code, ops_customer_status.last_fail_code),
       last_fail_node = COALESCE(excluded.last_fail_node, ops_customer_status.last_fail_node),
       fails_30m = excluded.fails_30m,
       updated_at = excluded.updated_at,
       first_connected_at = COALESCE(ops_customer_status.first_connected_at, excluded.first_connected_at)`,
  ).bind(
    row.userId, row.deviceId, row.platform, row.appVersion, row.osVersion,
    row.uiState, row.connected, row.connectedSince,
    row.selectedServer, row.catalogRevision,
    row.lastSeenAt, row.lastWindowId,
    row.edgeAsn, row.edgeAsOrg, row.edgeCountry, row.edgeRegion,
    row.lastFailAt, row.lastFailCode, row.lastFailNode, row.fails30m,
    row.updatedAt, row.connected === 1 ? row.firstConnectedAt : null,
  ).run();
}

export async function writeCustomerFromDevices(
  db: D1Database,
  userId: string,
  devices: Row[],
  nowSec: number,
  extras: {
    uiState?: string | null;
    catalogRevision?: number | null;
    edge?: { asn?: number | null; asOrg?: string | null; country?: string | null; region?: string | null } | null;
    windowId?: string | null;
    windowReceivedAt?: number | null;
  } = {},
): Promise<void> {
  const connectedRows = devices.filter((row) => (
    Number(row.connected) === 1 && heartbeatFresh(finite(row.last_seen_at), nowSec)
  ));
  const lead = representative(devices, nowSec);
  let lastSeenAt: number | null = null;
  let lastFail: { at: number; code: string | null; node: string | null } | null = null;
  let fails30m = 0;
  let connectedSince: number | null = null;
  for (const row of devices) {
    const seen = finite(row.last_seen_at);
    if (seen !== null) lastSeenAt = lastSeenAt === null ? seen : Math.max(lastSeenAt, seen);
    const failAt = finite(row.last_fail_at);
    if (failAt !== null && (!lastFail || failAt > lastFail.at)) {
      lastFail = { at: failAt, code: text(row.last_fail_code), node: text(row.last_fail_node) };
    }
    const elapsed = seen === null ? FAIL_WINDOW_SECONDS : nowSec - seen;
    fails30m += decayFails30m(Number(row.fails_30m) || 0, elapsed);
  }
  for (const row of connectedRows) {
    const since = finite(row.connected_since);
    if (since === null) continue;
    connectedSince = connectedSince === null ? since : Math.min(connectedSince, since);
  }
  if (connectedSince === null) connectedSince = finite(lead?.connected_since);
  const latestWindow = extras.windowReceivedAt != null
    && lastSeenAt != null
    && extras.windowReceivedAt >= lastSeenAt;
  await upsertCustomer(db, {
    userId,
    deviceId: text(lead?.device_id),
    platform: text(lead?.platform),
    appVersion: minAppVersion(devices, nowSec) ?? text(lead?.app_version),
    osVersion: text(lead?.os_version),
    uiState: latestWindow ? (extras.uiState ?? null) : null,
    connected: connectedRows.length > 0 ? 1 : 0,
    connectedSince,
    selectedServer: connectedRows.length > 0
      ? text(representative(connectedRows, nowSec)?.selected_server)
      : text(lead?.selected_server),
    catalogRevision: latestWindow ? (extras.catalogRevision ?? null) : null,
    lastSeenAt,
    lastWindowId: latestWindow ? (extras.windowId ?? text(lead?.last_window_id)) : text(lead?.last_window_id),
    edgeAsn: latestWindow ? (finite(extras.edge?.asn) ?? null) : null,
    edgeAsOrg: latestWindow ? text(extras.edge?.asOrg ?? null) : null,
    edgeCountry: latestWindow ? text(extras.edge?.country ?? null) : null,
    edgeRegion: latestWindow ? text(extras.edge?.region ?? null) : null,
    lastFailAt: lastFail?.at ?? null,
    lastFailCode: lastFail?.code ?? null,
    lastFailNode: lastFail?.node ?? null,
    fails30m,
    firstConnectedAt: connectedRows.length > 0 ? nowSec : null,
    updatedAt: nowSec,
  });
}

export async function upsertDeviceFromWindow(
  db: D1Database,
  input: {
    userId: string;
    deviceId: string;
    platform: string | null;
    appVersion: string | null;
    osVersion: string | null;
    selectedServer: string | null;
    connected: number;
    connectedSince: number | null;
    receivedAt: number;
    windowId: string;
    exitDelayMs: number | null;
    tcpDelayMs: number | null;
    lastFailAt: number | null;
    lastFailCode: string | null;
    lastFailNode: string | null;
    fails30m: number;
    nowSec: number;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO ops_device_status (
       user_id, device_id, platform, app_version, os_version,
       selected_server, connected, connected_since,
       last_seen_at, last_window_id, exit_delay_ms, tcp_delay_ms,
       last_fail_at, last_fail_code, last_fail_node, fails_30m, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, device_id) DO UPDATE SET
       platform = excluded.platform,
       app_version = excluded.app_version,
       os_version = excluded.os_version,
       selected_server = excluded.selected_server,
       connected = excluded.connected,
       connected_since = excluded.connected_since,
       last_seen_at = excluded.last_seen_at,
       last_window_id = excluded.last_window_id,
       exit_delay_ms = COALESCE(excluded.exit_delay_ms, ops_device_status.exit_delay_ms),
       tcp_delay_ms = COALESCE(excluded.tcp_delay_ms, ops_device_status.tcp_delay_ms),
       last_fail_at = COALESCE(excluded.last_fail_at, ops_device_status.last_fail_at),
       last_fail_code = COALESCE(excluded.last_fail_code, ops_device_status.last_fail_code),
       last_fail_node = COALESCE(excluded.last_fail_node, ops_device_status.last_fail_node),
       fails_30m = excluded.fails_30m,
       updated_at = excluded.updated_at`,
  ).bind(
    input.userId, input.deviceId, input.platform, input.appVersion, input.osVersion,
    input.selectedServer, input.connected, input.connectedSince,
    input.receivedAt, input.windowId, input.exitDelayMs, input.tcpDelayMs,
    input.lastFailAt, input.lastFailCode, input.lastFailNode, input.fails30m, input.nowSec,
  ).run();
}

export async function upsertDeviceFromFailure(
  db: D1Database,
  input: {
    userId: string;
    deviceId: string;
    platform: string | null;
    appVersion: string | null;
    osVersion: string | null;
    nowSec: number;
    tcpDelayMs: number | null;
    exitDelayMs: number | null;
    code: string;
    node: string;
  },
): Promise<void> {
  const t = input.nowSec;
  await db.prepare(
    `INSERT INTO ops_device_status (
       user_id, device_id, platform, app_version, os_version,
       selected_server, connected, connected_since,
       last_seen_at, last_window_id, exit_delay_ms, tcp_delay_ms,
       last_fail_at, last_fail_code, last_fail_node, fails_30m, updated_at
     ) VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, ?, NULL, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id, device_id) DO UPDATE SET
       platform = COALESCE(excluded.platform, ops_device_status.platform),
       app_version = COALESCE(excluded.app_version, ops_device_status.app_version),
       os_version = COALESCE(excluded.os_version, ops_device_status.os_version),
       last_seen_at = excluded.last_seen_at,
       exit_delay_ms = COALESCE(excluded.exit_delay_ms, ops_device_status.exit_delay_ms),
       tcp_delay_ms = COALESCE(excluded.tcp_delay_ms, ops_device_status.tcp_delay_ms),
       last_fail_at = excluded.last_fail_at,
       last_fail_code = excluded.last_fail_code,
       last_fail_node = excluded.last_fail_node,
       fails_30m = CASE
         WHEN ops_device_status.last_fail_at IS NOT NULL
          AND excluded.last_fail_at - ops_device_status.last_fail_at < 1800
         THEN ops_device_status.fails_30m + 1
         ELSE 1
       END,
       updated_at = excluded.updated_at`,
  ).bind(
    input.userId, input.deviceId, input.platform, input.appVersion, input.osVersion,
    t, input.exitDelayMs, input.tcpDelayMs, t, input.code, input.node, t,
  ).run();
}
