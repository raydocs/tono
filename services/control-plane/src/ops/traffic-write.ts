// Persist a parsed traffic-audit segment, and prune what has aged out.
//
// Split from traffic-parse.ts to keep both files inside the 500-line ops
// budget. The parse half is pure; this half is the only place that writes.

import type { CandidateAgg, ParsedSegment, Route } from './traffic-parse';

export const UPSERT_BATCH = 50;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function uniqueConflict(error: unknown): boolean {
  return String(error).includes('UNIQUE constraint failed');
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

function parseDestKey(key: string): { dayAt: number; etld1: string; route: Route; node: string } {
  const [day, e, route, node] = key.split('\t');
  return { dayAt: Number(day), etld1: e, route: route as Route, node: node ?? '' };
}

function parseServiceKey(key: string): { dayAt: number; family: string; route: Route } {
  const [day, family, route] = key.split('\t');
  return { dayAt: Number(day), family, route: route as Route };
}

function parseCandidateKey(key: string): { dayAt: number; etld1: string } {
  const [day, e] = key.split('\t');
  return { dayAt: Number(day), etld1: e };
}

/**
 * The segment ledger is written by the first statement of the first chunk, so
 * a concurrent parse of the same id loses the primary-key race there and the
 * whole chunk rolls back — nothing is written twice. The trade-off is the
 * other direction: a failure in a *later* chunk under-counts that segment
 * once, because the ledger row already claims it. Under-counting once is the
 * cheaper wrong answer.
 */
async function runBatches(
  db: D1Database,
  statements: D1PreparedStatement[],
  guardFirst: boolean,
): Promise<{ skipped: boolean; rows: number }> {
  let rows = 0;
  for (let i = 0; i < statements.length; i += UPSERT_BATCH) {
    const chunk = statements.slice(i, i + UPSERT_BATCH);
    try {
      await db.batch(chunk);
      rows += chunk.length;
    } catch (error) {
      if (i === 0 && guardFirst && uniqueConflict(error)) return { skipped: true, rows: 0 };
      if (missingTable(error)) return { skipped: false, rows };
      throw error;
    }
  }
  return { skipped: false, rows };
}

type LedgerState = 'seen' | 'new' | 'unavailable';

async function segmentLedgerState(db: D1Database, segmentId: string): Promise<LedgerState> {
  if (!segmentId) return 'unavailable';
  try {
    const row = await db.prepare(
      'SELECT 1 AS ok FROM ops_traffic_segments WHERE segment_id = ?',
    ).bind(segmentId).first();
    return row ? 'seen' : 'new';
  } catch (error) {
    if (missingTable(error)) return 'unavailable';
    throw error;
  }
}

/**
 * Write one parsed segment. `segmentId` is the `diagnostics_log_objects.id`
 * the bytes came from: parsing the same id twice writes nothing the second
 * time, so a retried hook or a replayed upload cannot double any counter.
 */
export async function writeParsedSegment(
  db: D1Database,
  parsed: ParsedSegment,
  nowSec: number,
  segmentId: string,
): Promise<{ skipped: boolean; rows: number }> {
  const ledger = await segmentLedgerState(db, segmentId);
  if (ledger === 'seen') return { skipped: true, rows: 0 };
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
  const domains = new Map<string, CandidateAgg>();
  for (const [key, agg] of parsed.candidates) {
    const { dayAt: day, etld1: e } = parseCandidateKey(key);
    statements.push(db.prepare(
      `INSERT INTO direct_candidate_daily(
         user_id, day_at, etld1, bytes, connections, last_seen_at
       ) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day_at, etld1) DO UPDATE SET
         bytes = bytes + excluded.bytes,
         connections = connections + excluded.connections,
         last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
    ).bind(parsed.userId, day, e, agg.bytes, agg.connections, agg.lastSeen));
    const rolled = domains.get(e);
    if (!rolled) {
      domains.set(e, { ...agg });
      continue;
    }
    rolled.bytes += agg.bytes;
    rolled.connections += agg.connections;
    rolled.firstSeen = Math.min(rolled.firstSeen, agg.firstSeen);
    rolled.lastSeen = Math.max(rolled.lastSeen, agg.lastSeen);
  }
  for (const [e, agg] of domains) {
    // The candidate row itself is insert-if-missing: a new domain must show up
    // on its first segment, but `users` is a distinct count that only
    // `rollupDirectCandidates30d` can get right. Bytes and connections are
    // bumped in place so the queue sorts sensibly between rollups; both are
    // exact again after the next daily pass.
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO direct_candidates(
         etld1, first_seen, last_seen, users, bytes_30d, connections_30d, status
       ) VALUES(?, ?, ?, 0, 0, 0, 'new')`,
    ).bind(e, agg.firstSeen, agg.lastSeen));
    statements.push(db.prepare(
      `UPDATE direct_candidates
       SET last_seen = MAX(last_seen, ?),
           bytes_30d = bytes_30d + ?,
           connections_30d = connections_30d + ?
       WHERE etld1 = ?`,
    ).bind(agg.lastSeen, agg.bytes, agg.connections, e));
  }
  if (ledger === 'new') {
    statements.unshift(db.prepare(
      `INSERT INTO ops_traffic_segments(
         segment_id, user_id, device_id, received_at, parsed_at, lines, connection_rows
       ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      segmentId,
      parsed.userId,
      parsed.deviceId || null,
      parsed.receivedAt,
      nowSec,
      parsed.lines,
      parsed.connectionRows,
    ));
  }
  if (statements.length === 0) return { skipped: false, rows: 0 };
  return await runBatches(db, statements, ledger === 'new');
}

export async function retainTrafficDaily(
  db: D1Database,
  nowSec: number,
  days = 90,
  limit = 500,
): Promise<void> {
  const cutoff = nowSec - days * 86_400;
  const tables = ['traffic_destination_daily', 'service_usage_daily', 'direct_candidate_daily'] as const;
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
    // The ledger only has to outlive the objects it de-duplicates; a segment
    // older than the retention window can never be replayed into live rows.
    await db.prepare(
      `DELETE FROM ops_traffic_segments WHERE rowid IN (
         SELECT rowid FROM ops_traffic_segments WHERE parsed_at < ? LIMIT ?
       )`,
    ).bind(cutoff, limit).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}
