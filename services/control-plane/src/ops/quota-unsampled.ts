import {
  NAME_LIMIT,
  boundsFor,
  field,
  finite,
  newId,
  openCycleRow,
  type QuotaProfile,
} from './quota';

type Row = Record<string, any>;

// A profile save can happen before any interface sample exists. Opening that
// cycle at counter 0 makes the next cumulative reading look like a full
// cycle of usage. Null baselines are the first-reading case in
// detectCounterReset: delta 0, then the real counters become the baseline.
export async function openNodeCycleWithoutSample(
  db: D1Database,
  nodeName: string,
  profile: QuotaProfile,
  nowSec: number,
): Promise<Row | null> {
  const name = nodeName.slice(0, NAME_LIMIT);
  if (!name) return null;
  const quota = finite(field(profile, 'traffic_quota_bytes', 'trafficQuotaBytes'));
  const expected = boundsFor(profile, nowSec);
  const open = await openCycleRow(db, name);
  if (open) {
    await db.prepare(
      'UPDATE node_traffic_cycles SET quota_bytes = COALESCE(?, quota_bytes), updated_at = ? WHERE id = ?',
    ).bind(quota, nowSec, open.id).run();
    return db.prepare('SELECT * FROM node_traffic_cycles WHERE id = ?').bind(open.id).first<Row>();
  }
  if (!expected) return null;
  const cycleId = newId();
  await db.prepare(
    `INSERT INTO node_traffic_cycles(
       id, node_name, cycle_start, cycle_end, quota_bytes, used_bytes,
       counter_in_start, counter_out_start, counter_in_last, counter_out_last,
       resets_detected, status, updated_at
     ) VALUES(?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, 0, 'open', ?)`,
  ).bind(cycleId, name, expected.start, expected.end, quota, nowSec).run();
  return db.prepare('SELECT * FROM node_traffic_cycles WHERE id = ?').bind(cycleId).first<Row>();
}
