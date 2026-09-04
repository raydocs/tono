const HOUR = 3600;
const RETENTION_SECONDS = 90 * 86400;

export function hourFloor(unix: number): number {
  return Math.floor(unix / HOUR) * HOUR;
}

export type UsageHourPoint = {
  t: number;
  bytes: number | null;
};

export function usageHourDeltas(
  snapshots: Array<{ hourAt: number; usageBytes: number }>,
): UsageHourPoint[] {
  const sorted = [...snapshots].sort((a, b) => a.hourAt - b.hourAt);
  return sorted.map((current, index) => {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    if (!previous) return { t: current.hourAt, bytes: null };
    if (current.usageBytes < previous.usageBytes) {
      return { t: current.hourAt, bytes: null };
    }
    return { t: current.hourAt, bytes: current.usageBytes - previous.usageBytes };
  });
}

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export async function snapshotUserUsageHours(db: D1Database, nowUnix: number): Promise<void> {
  const hourAt = hourFloor(nowUnix);
  try {
    await db.prepare(
      `INSERT INTO operations_user_usage_hours (user_id, hour_at, usage_bytes)
       SELECT users.id, ?, users.usage_bytes
       FROM users
       WHERE users.status = 'active'
         AND (
           NOT EXISTS (
             SELECT 1 FROM operations_user_usage_hours history
             WHERE history.user_id = users.id
           )
           OR users.usage_bytes != (
             SELECT history.usage_bytes
             FROM operations_user_usage_hours history
             WHERE history.user_id = users.id
             ORDER BY history.hour_at DESC
             LIMIT 1
           )
         )
       ON CONFLICT(user_id, hour_at) DO NOTHING`,
    ).bind(hourAt).run();
    await db.prepare(
      'DELETE FROM operations_user_usage_hours WHERE hour_at < ?',
    ).bind(hourAt - RETENTION_SECONDS).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

export async function queryUserUsageHours(
  db: D1Database,
  nowUnix: number,
  rangeHours = 24,
): Promise<{
  from: number;
  to: number;
  resolutionSeconds: number;
  fleet: UsageHourPoint[];
  users: Array<{ userId: string; points: UsageHourPoint[] }>;
}> {
  const closed = hourFloor(nowUnix);
  const from = closed - rangeHours * HOUR;
  let rows: { results?: Array<{ user_id: string; hour_at: number; usage_bytes: number }> };
  try {
    rows = await db.prepare(
      `WITH ranked_prior AS (
         SELECT user_id, hour_at, usage_bytes,
                ROW_NUMBER() OVER (
                  PARTITION BY user_id ORDER BY hour_at DESC
                ) AS position
         FROM operations_user_usage_hours
         WHERE hour_at < ?
       )
       SELECT user_id, hour_at, usage_bytes
       FROM ranked_prior WHERE position = 1
       UNION ALL
       SELECT user_id, hour_at, usage_bytes
       FROM operations_user_usage_hours
       WHERE hour_at >= ? AND hour_at < ?
       ORDER BY user_id ASC, hour_at ASC`,
    ).bind(from, from, closed).all<{ user_id: string; hour_at: number; usage_bytes: number }>();
  } catch (error) {
    if (!missingTable(error)) throw error;
    return { from, to: closed, resolutionSeconds: HOUR, fleet: [], users: [] };
  }

  const byUser = new Map<string, Array<{ hourAt: number; usageBytes: number }>>();
  for (const row of rows.results ?? []) {
    const list = byUser.get(row.user_id) ?? [];
    list.push({ hourAt: Number(row.hour_at), usageBytes: Number(row.usage_bytes) });
    byUser.set(row.user_id, list);
  }

  const users = [...byUser.entries()].map(([userId, snapshots]) => {
    const sorted = snapshots.sort((a, b) => a.hourAt - b.hourAt);
    const prior = sorted.filter((snapshot) => snapshot.hourAt < from).at(-1);
    const changes = new Map(
      sorted
        .filter((snapshot) => snapshot.hourAt >= from && snapshot.hourAt < closed)
        .map((snapshot) => [snapshot.hourAt, snapshot.usageBytes]),
    );
    let previous = prior?.usageBytes;
    const points: UsageHourPoint[] = [];
    for (let hourAt = from; hourAt < closed; hourAt += HOUR) {
      const current = changes.get(hourAt);
      if (current === undefined) {
        if (previous !== undefined) points.push({ t: hourAt, bytes: 0 });
        continue;
      }
      points.push({
        t: hourAt,
        bytes: previous === undefined || current < previous ? null : current - previous,
      });
      previous = current;
    }
    return { userId, points };
  });

  const fleetByHour = new Map<number, number | null>();
  for (const user of users) {
    for (const point of user.points) {
      if (!fleetByHour.has(point.t)) fleetByHour.set(point.t, 0);
      if (point.bytes == null) {
        if (fleetByHour.get(point.t) === 0) fleetByHour.set(point.t, null);
        continue;
      }
      const current = fleetByHour.get(point.t);
      fleetByHour.set(point.t, (current ?? 0) + point.bytes);
    }
  }

  const fleet = [...fleetByHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, bytes]) => ({ t, bytes }));

  return {
    from,
    to: closed,
    resolutionSeconds: HOUR,
    fleet,
    users,
  };
}
