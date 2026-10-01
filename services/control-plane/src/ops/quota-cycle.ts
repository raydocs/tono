// Opening and replacing a node traffic cycle. Split from quota.ts so that file
// stays inside the 500-line ops budget.

type Row = Record<string, any>;
type Bounds = { start: number; end: number };
type Counters = { in: number; out: number };

export function newId(): string {
  return crypto.randomUUID();
}

export async function openCycleRow(db: D1Database, nodeName: string): Promise<Row | null> {
  return db.prepare(
    "SELECT * FROM node_traffic_cycles WHERE node_name = ? AND status = 'open'",
  ).bind(nodeName).first<Row>();
}

export async function closeOpenCycle(db: D1Database, nodeName: string, nowSec: number): Promise<void> {
  const open = await openCycleRow(db, nodeName);
  if (!open) return;
  await db.prepare("UPDATE node_traffic_cycles SET status = 'closed', updated_at = ? WHERE id = ?")
    .bind(nowSec, open.id).run();
}

function openCycleInsert(
  db: D1Database,
  nodeName: string,
  bounds: Bounds,
  quota: number | null,
  counters: Counters,
  nowSec: number,
  previous: Row | null,
) {
  const cycleId = newId();
  const statement = db.prepare(
    `INSERT INTO node_traffic_cycles(
       id, node_name, cycle_start, cycle_end, quota_bytes, used_bytes,
       counter_in_start, counter_out_start, counter_in_last, counter_out_last,
       resets_detected, status, updated_at
     ) VALUES(?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 'open', ?)`,
  ).bind(
    cycleId, nodeName, bounds.start, bounds.end, quota,
    counters.in, counters.out,
    previous?.counter_in_last ?? counters.in,
    previous?.counter_out_last ?? counters.out,
    nowSec,
  );
  return { cycleId, statement };
}

export async function insertOpenCycle(
  db: D1Database,
  nodeName: string,
  bounds: Bounds,
  quota: number | null,
  counters: Counters,
  nowSec: number,
  previous: Row | null = null,
): Promise<Row> {
  const { cycleId, statement } = openCycleInsert(
    db, nodeName, bounds, quota, counters, nowSec, previous,
  );
  await statement.run();
  return (await db.prepare('SELECT * FROM node_traffic_cycles WHERE id = ?').bind(cycleId).first<Row>())!;
}

/** Close the expired row and insert its successor in one batch. No successor
 * bounds: close only and return null. A failed insert rolls the close back. */
export async function replaceExpiredOpenCycle(
  db: D1Database,
  nodeName: string,
  bounds: Bounds | null,
  quota: number | null,
  counters: Counters,
  nowSec: number,
  expired: Row,
): Promise<Row | null> {
  const close = db.prepare(
    "UPDATE node_traffic_cycles SET status = 'closed', updated_at = ? WHERE id = ?",
  ).bind(nowSec, expired.id);
  if (!bounds) {
    await close.run();
    return null;
  }
  const replacement = openCycleInsert(db, nodeName, bounds, quota, counters, nowSec, expired);
  await db.batch([close, replacement.statement]);
  return db.prepare('SELECT * FROM node_traffic_cycles WHERE id = ?').bind(replacement.cycleId).first<Row>();
}
