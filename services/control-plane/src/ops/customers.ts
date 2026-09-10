// Customer 360 projections from telemetry_windows + sessions/devices.
// Pure module: the ingest worker is not wired here (no import from ../index).

import {
  activityHours,
  customerStatus,
  sessionsFor,
  type ActivityHour,
  type CustomerSession,
  type CustomerStatus,
} from './customers-read';
import {
  backfillSessionsFromTables,
  recordSession,
  retainActivityHours,
  retainSessions,
  type SessionKind,
} from './customers-sessions';
import { sniffPlatform, windowPlatform } from './platform';

export {
  sniffPlatform,
  activityHours,
  backfillSessionsFromTables,
  customerStatus,
  recordSession,
  retainActivityHours,
  retainSessions,
  sessionsFor,
  type ActivityHour,
  type CustomerSession,
  type CustomerStatus,
  type SessionKind,
};

type Row = Record<string, any>;

const HOUR = 3600;
const HOUR_MS = HOUR * 1000;
const FAIL_WINDOW_SECONDS = 30 * 60;
const BATCH = 50;
export const PROJECT_BACKLOG_LIMIT = 60;
export const PROJECT_BACKLOG_BUDGET_MS = 25_000;

export type TelemetryWindowInput = {
  id: string;
  user_id: string;
  device_id?: string | null;
  received_at: number;
  client_version?: string | null;
  os_version?: string | null;
  payload?: unknown;
  payload_json?: unknown;
  window_start_ms?: number | null;
  window_end_ms?: number | null;
};

export type CustomerEdge = {
  asn?: number | null;
  asOrg?: string | null;
  country?: string | null;
  region?: string | null;
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

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH) {
    await db.batch(statements.slice(i, i + BATCH));
  }
}

function payloadOf(window: TelemetryWindowInput): Row {
  const raw = window.payload ?? window.payload_json;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Row : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Row;
  return {};
}

function eventTsSec(ts: number): number {
  return ts >= 1_000_000_000_000 ? Math.floor(ts / 1000) : ts;
}

type FailEvent = { tsSec: number; code: string | null; node: string | null };

function connectFails(payload: Row): FailEvent[] {
  if (!Array.isArray(payload.events)) return [];
  const out: FailEvent[] = [];
  for (const raw of payload.events) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const event = raw as Row;
    if (event.kind !== 'connectFail') continue;
    const ts = finite(event.ts);
    if (ts === null || ts < 0) continue;
    out.push({
      tsSec: eventTsSec(ts),
      code: text(event.code),
      node: text(event.node),
    });
  }
  return out;
}

/**
 * fails_30m decay rule:
 *   new = count(this window's connectFail events with ts in
 *               [received_at - 1800, received_at])
 *        + round(previous.fails_30m * max(0, 1800 - elapsed) / 1800)
 *   elapsed = received_at - previous.last_seen_at (0 if no previous row)
 *   If elapsed >= 1800 the previous contribution is 0. Integer, never negative.
 * last_fail_* is the latest connectFail in this window ({ts, code, node});
 * a window with none leaves the previous last_fail_* in place.
 */
function decayFails30m(previous: number, elapsedSec: number): number {
  if (previous <= 0 || elapsedSec >= FAIL_WINDOW_SECONDS) return 0;
  if (elapsedSec <= 0) return previous;
  return Math.round(previous * (FAIL_WINDOW_SECONDS - elapsedSec) / FAIL_WINDOW_SECONDS);
}

function failsInWindow(fails: FailEvent[], receivedAt: number): FailEvent[] {
  const cutoff = receivedAt - FAIL_WINDOW_SECONDS;
  return fails.filter((event) => event.tsSec >= cutoff && event.tsSec <= receivedAt);
}

export async function applyWindowToStatus(
  db: D1Database,
  window: TelemetryWindowInput,
  edge: CustomerEdge | null | undefined,
  nowSec: number,
): Promise<void> {
  const userId = text(window.user_id);
  if (!userId) return;
  const payload = payloadOf(window);
  const receivedAt = finite(window.received_at);
  if (receivedAt === null) return;
  const deviceId = text(window.device_id);
  const osVersion = text(window.os_version);
  const uiState = text(payload.uiState);
  const connected = uiState === 'connected' ? 1 : 0;
  const fails = failsInWindow(connectFails(payload), receivedAt);
  const latestFail = fails.reduce<FailEvent | null>(
    (best, event) => (!best || event.tsSec > best.tsSec ? event : best),
    null,
  );

  try {
    const prev = await db.prepare(
      'SELECT * FROM ops_customer_status WHERE user_id = ?',
    ).bind(userId).first<Row>();
    if (prev && String(prev.last_window_id) === window.id) return;
    if (prev && finite(prev.last_seen_at) !== null && Number(prev.last_seen_at) > receivedAt) {
      return;
    }

    const sameDeviceConnected = Boolean(
      prev
      && Number(prev.connected) === 1
      && connected === 1
      && String(prev.device_id ?? '') === String(deviceId ?? ''),
    );
    const connectedSince = connected === 1
      ? (sameDeviceConnected ? Number(prev!.connected_since) : nowSec)
      : (prev?.connected_since == null ? null : Number(prev.connected_since));

    const elapsed = prev && finite(prev.last_seen_at) !== null
      ? receivedAt - Number(prev.last_seen_at)
      : FAIL_WINDOW_SECONDS;
    const fails30m = decayFails30m(Number(prev?.fails_30m) || 0, elapsed) + fails.length;

    await db.prepare(
      `INSERT INTO ops_customer_status (
         user_id, device_id, platform, app_version, os_version,
         ui_state, connected, connected_since,
         selected_server, catalog_revision,
         last_seen_at, last_window_id,
         edge_asn, edge_as_org, edge_country, edge_region,
         last_fail_at, last_fail_code, last_fail_node, fails_30m,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         device_id = excluded.device_id,
         platform = excluded.platform,
         app_version = excluded.app_version,
         os_version = excluded.os_version,
         ui_state = excluded.ui_state,
         connected = excluded.connected,
         connected_since = excluded.connected_since,
         selected_server = excluded.selected_server,
         catalog_revision = excluded.catalog_revision,
         last_seen_at = excluded.last_seen_at,
         last_window_id = excluded.last_window_id,
         edge_asn = COALESCE(excluded.edge_asn, ops_customer_status.edge_asn),
         edge_as_org = COALESCE(excluded.edge_as_org, ops_customer_status.edge_as_org),
         edge_country = COALESCE(excluded.edge_country, ops_customer_status.edge_country),
         edge_region = COALESCE(excluded.edge_region, ops_customer_status.edge_region),
         last_fail_at = COALESCE(excluded.last_fail_at, ops_customer_status.last_fail_at),
         last_fail_code = COALESCE(excluded.last_fail_code, ops_customer_status.last_fail_code),
         last_fail_node = COALESCE(excluded.last_fail_node, ops_customer_status.last_fail_node),
         fails_30m = excluded.fails_30m,
         updated_at = excluded.updated_at`,
    ).bind(
      userId,
      deviceId,
      sniffPlatform(osVersion),
      text(window.client_version),
      osVersion,
      uiState,
      connected,
      connectedSince,
      text(payload.selectedServer),
      finite(payload.catalogRevision),
      receivedAt,
      window.id,
      finite(edge?.asn),
      text(edge?.asOrg ?? null),
      text(edge?.country ?? null),
      text(edge?.region ?? null),
      latestFail?.tsSec ?? null,
      latestFail?.code ?? null,
      latestFail?.node ?? null,
      fails30m,
      nowSec,
    ).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

function windowBoundsMs(window: TelemetryWindowInput, payload: Row): { startMs: number; endMs: number } | null {
  const start = finite(window.window_start_ms) ?? finite(payload.windowStartMs);
  const end = finite(window.window_end_ms) ?? finite(payload.windowEndMs);
  if (start === null || end === null || end <= start) return null;
  return { startMs: start, endMs: end };
}

/**
 * Hour-accrual overlap rule:
 *   A window is one uiState for its whole [window_start_ms, window_end_ms].
 *   For each UTC hour that interval overlaps, online_minutes += round(overlap
 *   milliseconds / 60_000). connected_minutes gets the same overlap when
 *   uiState === 'connected', else 0. windows += 1 per overlapped hour.
 *   node / app_version / platform take the latest window (excluded.*).
 */
function hourSlices(
  startMs: number,
  endMs: number,
): Array<{ hourAt: number; minutes: number }> {
  const slices: Array<{ hourAt: number; minutes: number }> = [];
  const lastHour = Math.floor((endMs - 1) / HOUR_MS) * HOUR_MS;
  for (let hourMs = Math.floor(startMs / HOUR_MS) * HOUR_MS; hourMs <= lastHour; hourMs += HOUR_MS) {
    const overlapStart = Math.max(startMs, hourMs);
    const overlapEnd = Math.min(endMs, hourMs + HOUR_MS);
    slices.push({
      hourAt: hourMs / 1000,
      minutes: Math.max(0, Math.round((overlapEnd - overlapStart) / 60_000)),
    });
  }
  return slices;
}

export async function accrueActivityHours(
  db: D1Database,
  window: TelemetryWindowInput,
  _nowSec: number,
): Promise<number> {
  const userId = text(window.user_id);
  if (!userId) return 0;
  const payload = payloadOf(window);
  const bounds = windowBoundsMs(window, payload);
  if (!bounds) return 0;
  const slices = hourSlices(bounds.startMs, bounds.endMs);
  if (slices.length === 0) return 0;
  const connected = text(payload.uiState) === 'connected';
  const deviceId = text(window.device_id) ?? '';
  const node = text(payload.selectedServer);
  const appVersion = text(window.client_version);
  const platform = windowPlatform(payload, text(window.os_version));
  const statements = slices.map((slice) => db.prepare(
    `INSERT INTO customer_activity_hours (
       user_id, device_id, hour_at, online_minutes, connected_minutes,
       bytes_up, bytes_down, node, app_version, platform, windows
     ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 1)
     ON CONFLICT(user_id, device_id, hour_at) DO UPDATE SET
       online_minutes = customer_activity_hours.online_minutes + excluded.online_minutes,
       connected_minutes = customer_activity_hours.connected_minutes + excluded.connected_minutes,
       bytes_up = customer_activity_hours.bytes_up + excluded.bytes_up,
       bytes_down = customer_activity_hours.bytes_down + excluded.bytes_down,
       node = excluded.node,
       app_version = excluded.app_version,
       platform = excluded.platform,
       windows = customer_activity_hours.windows + excluded.windows`,
  ).bind(
    userId,
    deviceId,
    slice.hourAt,
    slice.minutes,
    connected ? slice.minutes : 0,
    node,
    appVersion,
    platform,
  ));
  try {
    await runBatches(db, statements);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
  return slices.length;
}

export type ProjectionCounts = { windows: number; hours: number };

export type ProjectBacklogClock = {
  nowMs?: () => number;
  budgetMs?: number;
};

export async function projectBacklog(
  db: D1Database,
  nowSec: number,
  limit = PROJECT_BACKLOG_LIMIT,
  clock: ProjectBacklogClock = {},
): Promise<ProjectionCounts> {
  const cap = Math.min(Math.max(limit, 1), 1000);
  const nowMs = clock.nowMs ?? Date.now;
  const budgetMs = clock.budgetMs ?? PROJECT_BACKLOG_BUDGET_MS;
  try {
    const cursor = await db.prepare(
      'SELECT last_received_at, last_window_id FROM ops_customer_projection_cursor WHERE singleton_id = 1',
    ).first<{ last_received_at: number; last_window_id: string }>();
    const lastReceivedAt = Number(cursor?.last_received_at) || 0;
    const lastWindowId = cursor?.last_window_id ?? '';
    const rows = await db.prepare(
      `SELECT id, user_id, device_id, received_at, window_start_ms, window_end_ms,
              client_version, os_version, payload_json
       FROM telemetry_windows
       WHERE received_at > ?
          OR (received_at = ? AND id > ?)
       ORDER BY received_at ASC, id ASC
       LIMIT ?`,
    ).bind(lastReceivedAt, lastReceivedAt, lastWindowId, cap).all<Row>();
    const windows = rows.results ?? [];
    let hours = 0;
    let processed = 0;
    const started = nowMs();
    for (const row of windows) {
      const window: TelemetryWindowInput = {
        id: String(row.id),
        user_id: String(row.user_id),
        device_id: row.device_id == null ? null : String(row.device_id),
        received_at: Number(row.received_at),
        client_version: text(row.client_version),
        os_version: text(row.os_version),
        payload: row.payload_json,
        window_start_ms: finite(row.window_start_ms),
        window_end_ms: finite(row.window_end_ms),
      };
      await applyWindowToStatus(db, window, null, nowSec);
      hours += await accrueActivityHours(db, window, nowSec);
      processed += 1;
      if (nowMs() - started >= budgetMs) break;
    }
    const last = windows[processed - 1];
    if (last) {
      await db.prepare(
        `INSERT INTO ops_customer_projection_cursor (
           singleton_id, last_received_at, last_window_id, updated_at
         ) VALUES (1, ?, ?, ?)
         ON CONFLICT(singleton_id) DO UPDATE SET
           last_received_at = excluded.last_received_at,
           last_window_id = excluded.last_window_id,
           updated_at = excluded.updated_at`,
      ).bind(Number(last.received_at), String(last.id), nowSec).run();
    }
    return { windows: processed, hours };
  } catch (error) {
    if (missingTable(error)) return { windows: 0, hours: 0 };
    throw error;
  }
}
