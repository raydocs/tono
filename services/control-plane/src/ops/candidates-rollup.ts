// The rolling 30-day counters behind `direct_candidates`.
//
// `users` / `bytes_30d` / `connections_30d` used to be lifetime additive
// counters: every segment added 1 to `users`, so one customer uploading thirty
// segments read as thirty customers, and nothing ever came back down when a
// domain went quiet. They are now recomputed from `direct_candidate_daily`
// over the last 30 UTC days — the same shape the column names always claimed.
//
// Segment writes still bump `bytes_30d` / `connections_30d` in place so a new
// domain is not stuck at zero until midnight; `users` is left to this pass.

import { readCronState, writeCronState } from './cron-state';
import { isLikelyDomestic } from './service-families';

const DAY = 86_400;
const WINDOW_DAYS = 30;
const BATCH = 50;
const BACKFILL_KEY = 'candidate_daily_backfill';

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function utcDay(unix: number): number {
  return Math.floor(unix / DAY) * DAY;
}

async function runChunks(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH) {
    await db.batch(statements.slice(i, i + BATCH));
  }
}

/**
 * Seed `direct_candidate_daily` from the destination rollup that predates it,
 * once. Domestic-ness is a JS predicate, so the domains are listed first and
 * filtered here; that keeps the write to one statement per domestic domain
 * rather than one per (user, day, domain).
 */
async function backfillCandidateDaily(db: D1Database, nowSec: number): Promise<number> {
  if (await readCronState(db, BACKFILL_KEY) != null) return 0;
  const rows = await db.prepare(
    `SELECT DISTINCT etld1 FROM traffic_destination_daily
     WHERE route = 'cloud' AND etld1 NOT IN ('__other__', '__ip__')`,
  ).all<{ etld1: string }>();
  const domains = (rows.results ?? [])
    .map((row) => String(row.etld1))
    .filter((etld1) => isLikelyDomestic(etld1));
  await runChunks(db, domains.map((etld1) => db.prepare(
    `INSERT OR IGNORE INTO direct_candidate_daily(
       user_id, day_at, etld1, bytes, connections, last_seen_at
     )
     SELECT user_id, day_at, etld1,
            SUM(bytes_up + bytes_down), SUM(connections), MAX(day_at)
     FROM traffic_destination_daily
     WHERE route = 'cloud' AND etld1 = ?
     GROUP BY user_id, day_at, etld1`,
  ).bind(etld1)));
  await writeCronState(db, BACKFILL_KEY, nowSec);
  return domains.length;
}

/**
 * Recompute every candidate's 30-day counters. `status`, `decided_by`,
 * `decided_at`, `notes`, `first_seen` and `country_hint` are an operator's
 * decision and a lifetime fact; this pass never touches them.
 */
export async function rollupDirectCandidates30d(
  db: D1Database,
  nowSec: number,
): Promise<{ rows: number; backfilled: number }> {
  try {
    const backfilled = await backfillCandidateDaily(db, nowSec);
    const since = utcDay(nowSec) - (WINDOW_DAYS - 1) * DAY;
    const result = await db.prepare(
      `UPDATE direct_candidates SET
         users = COALESCE((
           SELECT COUNT(DISTINCT d.user_id) FROM direct_candidate_daily d
           WHERE d.etld1 = direct_candidates.etld1 AND d.day_at >= ?
         ), 0),
         bytes_30d = COALESCE((
           SELECT SUM(d.bytes) FROM direct_candidate_daily d
           WHERE d.etld1 = direct_candidates.etld1 AND d.day_at >= ?
         ), 0),
         connections_30d = COALESCE((
           SELECT SUM(d.connections) FROM direct_candidate_daily d
           WHERE d.etld1 = direct_candidates.etld1 AND d.day_at >= ?
         ), 0)`,
    ).bind(since, since, since).run();
    return { rows: Number(result.meta.changes ?? 0), backfilled };
  } catch (error) {
    if (missingTable(error)) return { rows: 0, backfilled: 0 };
    throw error;
  }
}
