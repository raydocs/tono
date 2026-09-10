// Flatten immutable telemetry windows into queryable connection_events.
// Windows reject UPDATE, so progress lives in ops_flatten_cursor rather than
// a watermark column on the source table. One INSERT…SELECT per window keeps
// the bound-parameter count fixed no matter how many events the payload holds.

import { sniffPlatform } from './platform';
export { sniffPlatform, type Platform } from './platform';

export const FLATTEN_KINDS = [
  'connectBegin',
  'connectOk',
  'connectFail',
  'nodeSwitch',
  'connectCatalogFailover',
  'healthProbeFail',
  'protectedOffline',
  'coreRestart',
  'reconnectScheduled',
  'networkChange',
  'disconnectOk',
  'releaseFail',
  'syncFail',
] as const;

export type FlattenKind = (typeof FLATTEN_KINDS)[number];

export type FlattenWindowRow = {
  id: string;
  user_id: string;
  device_id: string | null;
  received_at: number;
  client_version: string;
  os_version: string;
  payload_json: string;
};

export type EdgeCf = {
  asn?: number | string | null;
  asOrganization?: string | null;
  country?: string | null;
  regionCode?: string | null;
};

export type EdgeAttribution = {
  edge_asn: number | null;
  edge_as_org: string | null;
  edge_country: string | null;
  edge_region: string | null;
  edge_via_exit: 0 | 1;
};

const BATCH_STATEMENTS = 50;
const DAY_SECONDS = 86400;
const EMPTY_EDGE: EdgeAttribution = {
  edge_asn: null,
  edge_as_org: null,
  edge_country: null,
  edge_region: null,
  edge_via_exit: 0,
};

const FLATTEN_KIND_SQL = FLATTEN_KINDS.map((kind) => `'${kind}'`).join(', ');

// Intake allows a 500-char error; the column is 200. Clip in SQL so a long
// error cannot OR IGNORE the whole row. Node is clipped for the same reason.
const FLATTEN_WINDOW_SQL = `INSERT OR IGNORE INTO connection_events(
  id, at_ms, received_at, source, window_id, user_id, device_id,
  platform, app_version, os_version, os_arch,
  kind, node, stage, outcome, code, error, action, reason, from_node, to_node,
  elapsed_ms, delay_ms, exit_delay_ms, tcp_delay_ms, catalog_revision,
  edge_asn, edge_as_org, edge_country, edge_region, edge_via_exit, attempt_id
)
SELECT
  ? || ':' || ev.key,
  MIN(CAST(json_extract(ev.value, '$.ts') AS INTEGER), ?),
  ?,
  'window',
  ?,
  ?,
  ?,
  COALESCE(json_extract(?, '$.platform'), ?),
  ?,
  ?,
  json_extract(?, '$.osArch'),
  json_extract(ev.value, '$.kind'),
  SUBSTR(COALESCE(json_extract(ev.value, '$.node'), json_extract(?, '$.selectedServer')), 1, 120),
  json_extract(ev.value, '$.stage'),
  json_extract(ev.value, '$.outcome'),
  json_extract(ev.value, '$.code'),
  CASE
    WHEN json_extract(ev.value, '$.error') IS NULL THEN NULL
    ELSE SUBSTR(json_extract(ev.value, '$.error'), 1, 200)
  END,
  json_extract(ev.value, '$.action'),
  json_extract(ev.value, '$.reason'),
  json_extract(ev.value, '$.from'),
  json_extract(ev.value, '$.to'),
  CAST(json_extract(ev.value, '$.elapsedMs') AS INTEGER),
  CAST(json_extract(ev.value, '$.delayMs') AS INTEGER),
  CAST(json_extract(?, '$.exitDelayMs') AS INTEGER),
  CAST(json_extract(?, '$.tcpDelayMs') AS INTEGER),
  CAST(json_extract(?, '$.catalogRevision') AS INTEGER),
  ?,
  ?,
  ?,
  ?,
  ?,
  CASE
    WHEN json_extract(ev.value, '$.attemptId') IS NULL THEN NULL
    WHEN LENGTH(CAST(json_extract(ev.value, '$.attemptId') AS TEXT)) BETWEEN 1 AND 64
    THEN CAST(json_extract(ev.value, '$.attemptId') AS TEXT)
    ELSE NULL
  END
FROM json_each(?, '$.events') ev
WHERE json_extract(ev.value, '$.kind') IN (${FLATTEN_KIND_SQL})`;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function finiteInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function textOrNull(value: unknown, max?: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return max != null && trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function edgeAttribution(
  cf: EdgeCf | undefined,
  knownExitAsns: Set<number>,
): EdgeAttribution {
  const asn = finiteInt(cf?.asn);
  return {
    edge_asn: asn,
    edge_as_org: textOrNull(cf?.asOrganization, 120),
    edge_country: textOrNull(cf?.country),
    edge_region: textOrNull(cf?.regionCode),
    edge_via_exit: asn != null && knownExitAsns.has(asn) ? 1 : 0,
  };
}

export function flattenWindowStatement(
  db: D1Database,
  row: FlattenWindowRow,
  edge: EdgeAttribution,
): D1PreparedStatement {
  const payload = row.payload_json;
  return db.prepare(FLATTEN_WINDOW_SQL).bind(
    row.id,
    row.received_at * 1000,
    row.received_at,
    row.id,
    row.user_id,
    row.device_id,
    payload,
    sniffPlatform(row.os_version),
    row.client_version,
    row.os_version,
    payload,
    payload,
    payload,
    payload,
    payload,
    edge.edge_asn,
    edge.edge_as_org,
    edge.edge_country,
    edge.edge_region,
    edge.edge_via_exit,
    payload,
  );
}

export async function flattenWindow(
  db: D1Database,
  row: FlattenWindowRow,
  edge: EdgeAttribution,
): Promise<number> {
  try {
    const result = await flattenWindowStatement(db, row, edge).run();
    return Number(result.meta.changes ?? 0);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}

function asWindow(row: Record<string, unknown>): FlattenWindowRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    device_id: row.device_id == null ? null : String(row.device_id),
    received_at: Number(row.received_at),
    client_version: String(row.client_version),
    os_version: String(row.os_version),
    payload_json: String(row.payload_json),
  };
}

async function advanceCursor(
  db: D1Database,
  lastReceivedAt: number,
  lastWindowId: string,
  nowSec: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO ops_flatten_cursor(singleton_id, last_received_at, last_window_id, updated_at)
     VALUES(1, ?, ?, ?)
     ON CONFLICT(singleton_id) DO UPDATE SET
       last_received_at = excluded.last_received_at,
       last_window_id = excluded.last_window_id,
       updated_at = excluded.updated_at`,
  ).bind(lastReceivedAt, lastWindowId, nowSec).run();
}

export async function flattenBacklog(
  db: D1Database,
  nowSec: number,
  limit = 200,
): Promise<{ windows: number; rows: number }> {
  try {
    const cursor = await db.prepare(
      'SELECT last_received_at, last_window_id FROM ops_flatten_cursor WHERE singleton_id = 1',
    ).first<{ last_received_at: number; last_window_id: string }>();
    const lastReceivedAt = Number(cursor?.last_received_at ?? 0);
    const lastWindowId = String(cursor?.last_window_id ?? '');
    const selected = await db.prepare(
      `SELECT id, user_id, device_id, received_at, client_version, os_version, payload_json
       FROM telemetry_windows
       WHERE received_at > ?
          OR (received_at = ? AND id > ?)
       ORDER BY received_at ASC, id ASC
       LIMIT ?`,
    ).bind(lastReceivedAt, lastReceivedAt, lastWindowId, limit).all<Record<string, unknown>>();
    const windows = (selected.results ?? []).map(asWindow);
    if (windows.length === 0) return { windows: 0, rows: 0 };

    // Replay has no request.cf; edge columns stay null / not-via-exit. Live
    // intake can pass attribution into flattenWindow directly.
    let rows = 0;
    for (let offset = 0; offset < windows.length; offset += BATCH_STATEMENTS) {
      const chunk = windows.slice(offset, offset + BATCH_STATEMENTS);
      const results = await db.batch(
        chunk.map((row) => flattenWindowStatement(db, row, EMPTY_EDGE)),
      );
      rows += results.reduce((total, result) => total + Number(result.meta.changes ?? 0), 0);
    }
    const last = windows[windows.length - 1];
    await advanceCursor(db, last.received_at, last.id, nowSec);
    return { windows: windows.length, rows };
  } catch (error) {
    if (missingTable(error)) return { windows: 0, rows: 0 };
    throw error;
  }
}

export async function rollupConnectionDaily(db: D1Database, dayAt: number): Promise<void> {
  // p50 is the discrete middle: rank (n+1)/2 of non-null elapsed_ms (lower
  // value when n is even). Cheaper than pulling the day's rows into JS — D1
  // already pays for the GROUP BY, and the window function rides along.
  const day = Math.floor(dayAt / DAY_SECONDS) * DAY_SECONDS;
  const fromMs = day * 1000;
  const toMs = (day + DAY_SECONDS) * 1000;
  try {
    await db.prepare(
      `WITH bounded AS (
         SELECT
           COALESCE(node, '') AS node,
           COALESCE(platform, '') AS platform,
           kind,
           COALESCE(code, '') AS code,
           user_id,
           elapsed_ms
         FROM connection_events
         WHERE at_ms >= ? AND at_ms < ?
       ),
       agg AS (
         SELECT node, platform, kind, code,
                COUNT(*) AS attempts,
                COUNT(DISTINCT user_id) AS users
         FROM bounded
         GROUP BY node, platform, kind, code
       ),
       ranked AS (
         SELECT
           node, platform, kind, code, elapsed_ms,
           ROW_NUMBER() OVER (
             PARTITION BY node, platform, kind, code
             ORDER BY elapsed_ms ASC
           ) AS rn,
           COUNT(elapsed_ms) OVER (
             PARTITION BY node, platform, kind, code
           ) AS n
         FROM bounded
         WHERE elapsed_ms IS NOT NULL
       ),
       p50 AS (
         SELECT node, platform, kind, code, elapsed_ms AS p50_elapsed_ms
         FROM ranked
         WHERE rn = (n + 1) / 2
       )
       INSERT INTO ops_connection_daily(
         day_at, node, platform, kind, code, attempts, users, p50_elapsed_ms
       )
       SELECT ?, agg.node, agg.platform, agg.kind, agg.code,
              agg.attempts, agg.users, p50.p50_elapsed_ms
       FROM agg
       LEFT JOIN p50 USING (node, platform, kind, code)
       ON CONFLICT(day_at, node, platform, kind, code) DO UPDATE SET
         attempts = excluded.attempts,
         users = excluded.users,
         p50_elapsed_ms = excluded.p50_elapsed_ms`,
    ).bind(fromMs, toMs, day).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

export async function retainConnectionEvents(
  db: D1Database,
  nowSec: number,
  days = 30,
  limit = 500,
): Promise<number> {
  try {
    const result = await db.prepare(
      `DELETE FROM connection_events
       WHERE id IN (
         SELECT id FROM connection_events
         WHERE received_at <= ?
         ORDER BY received_at ASC, id ASC
         LIMIT ?
       )`,
    ).bind(nowSec - days * DAY_SECONDS, limit).run();
    return Number(result.meta.changes ?? 0);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}

export async function retainConnectionDaily(
  db: D1Database,
  nowSec: number,
  days = 400,
  limit = 500,
): Promise<number> {
  try {
    const result = await db.prepare(
      `DELETE FROM ops_connection_daily
       WHERE rowid IN (
         SELECT rowid FROM ops_connection_daily
         WHERE day_at <= ?
         ORDER BY day_at ASC, node ASC, platform ASC, kind ASC, code ASC
         LIMIT ?
       )`,
    ).bind(nowSec - days * DAY_SECONDS, limit).run();
    return Number(result.meta.changes ?? 0);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}
