import { VERDICT_RULES_VERSION } from './verdict';

const DAY_SECONDS = 86_400;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export async function rollupDailySlo(db: D1Database, dayAt: number): Promise<void> {
  const dayStart = Math.floor(dayAt / DAY_SECONDS) * DAY_SECONDS;
  const dayEnd = dayStart + DAY_SECONDS;
  const fromMs = dayStart * 1000;
  const toMs = dayEnd * 1000;

  try {
    const connRows = await db.prepare(
      `WITH bounded AS (
         SELECT
           COALESCE(node, '') AS node,
           COALESCE(NULLIF(platform, ''), 'other') AS platform,
           CASE
             WHEN LOWER(COALESCE(edge_as_org, '')) LIKE '%mobile%' OR LOWER(COALESCE(edge_as_org, '')) LIKE '%cmcc%' OR edge_as_org LIKE '%移动%' THEN 'mobile'
             WHEN LOWER(COALESCE(edge_as_org, '')) LIKE '%telecom%' OR LOWER(COALESCE(edge_as_org, '')) LIKE '%chinanet%' OR edge_as_org LIKE '%电信%' THEN 'telecom'
             WHEN LOWER(COALESCE(edge_as_org, '')) LIKE '%unicom%' OR edge_as_org LIKE '%联通%' THEN 'unicom'
             ELSE 'other'
           END AS carrier,
           kind,
           elapsed_ms
         FROM connection_events
         WHERE at_ms >= ? AND at_ms < ?
           AND kind IN ('connectOk', 'connectFail')
           AND node IS NOT NULL AND node != ''
       ),
       agg AS (
         SELECT
           node, platform, carrier,
           COUNT(*) AS attempts,
           SUM(CASE WHEN kind = 'connectOk' THEN 1 ELSE 0 END) AS successes
         FROM bounded
         GROUP BY node, platform, carrier
       ),
       ranked AS (
         SELECT
           node, platform, carrier, elapsed_ms,
           ROW_NUMBER() OVER (
             PARTITION BY node, platform, carrier
             ORDER BY elapsed_ms ASC
           ) AS rn,
           COUNT(elapsed_ms) OVER (
             PARTITION BY node, platform, carrier
           ) AS n
         FROM bounded
         WHERE elapsed_ms IS NOT NULL
       ),
       p50 AS (
         SELECT node, platform, carrier, elapsed_ms AS p50_ms
         FROM ranked
         WHERE rn = (n + 1) / 2
       )
       SELECT
         agg.node, agg.platform, agg.carrier,
         agg.attempts, agg.successes,
         p50.p50_ms
       FROM agg
       LEFT JOIN p50 USING (node, platform, carrier)`
    ).bind(fromMs, toMs).all<{
      node: string;
      platform: string;
      carrier: string;
      attempts: number;
      successes: number;
      p50_ms: number | null;
    }>();

    const results = connRows.results ?? [];
    if (results.length === 0) return;

    const nodeNames = [...new Set(results.map((r) => r.node))];
    const nodeMetrics = new Map<string, { outageMin: number; unmeasuredMin: number }>();

    for (const node of nodeNames) {
      const outageRow = await db.prepare(
        `SELECT
           COALESCE(
             SUM(
               CAST((MIN(COALESCE(resolved_at, ?), ?) - MAX(opened_at, ?)) / 60 AS INTEGER)
             ),
             0
           ) AS outage_min
         FROM ops_incidents
         WHERE subject_type = 'node'
           AND subject_id = ?
           AND severity = 'severe'
           AND closure = 'verified'
           AND opened_at < ?
           AND (resolved_at IS NULL OR resolved_at > ?)`
      ).bind(dayEnd, dayEnd, dayStart, node, dayEnd, dayStart).first<{ outage_min: number }>();

      const outageMin = Math.max(0, Number(outageRow?.outage_min ?? 0));

      const measuredRow = await db.prepare(
        `SELECT COUNT(DISTINCT h) AS measured_hours FROM (
           SELECT CAST((hour_at - ?) / 3600 AS INTEGER) AS h
           FROM customer_activity_hours
           WHERE node = ? AND hour_at >= ? AND hour_at < ?
           UNION
           SELECT CAST((at - ?) / 3600 AS INTEGER) AS h
           FROM ops_node_status_history
           WHERE node_name = ? AND at >= ? AND at < ?
           UNION
           SELECT CAST((at_ms / 1000 - ?) / 3600 AS INTEGER) AS h
           FROM connection_events
           WHERE node = ? AND at_ms >= ? AND at_ms < ?
         )`
      ).bind(
        dayStart, node, dayStart, dayEnd,
        dayStart, node, dayStart, dayEnd,
        dayStart, node, fromMs, toMs,
      ).first<{ measured_hours: number }>();

      const measuredHours = Math.min(24, Math.max(0, Number(measuredRow?.measured_hours ?? 0)));
      const unmeasuredMin = (24 - measuredHours) * 60;

      nodeMetrics.set(node, { outageMin, unmeasuredMin });
    }

    for (const row of results) {
      const metrics = nodeMetrics.get(row.node) ?? { outageMin: 0, unmeasuredMin: 1440 };
      await db.prepare(
        `INSERT INTO ops_daily_slo(
           day_at, platform, carrier, node,
           attempts, successes, p50_ms,
           verified_outage_min, unmeasured_min, rules_version
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day_at, platform, carrier, node) DO UPDATE SET
           attempts = excluded.attempts,
           successes = excluded.successes,
           p50_ms = excluded.p50_ms,
           verified_outage_min = excluded.verified_outage_min,
           unmeasured_min = excluded.unmeasured_min,
           rules_version = excluded.rules_version`
      ).bind(
        dayStart,
        row.platform,
        row.carrier,
        row.node,
        row.attempts,
        row.successes,
        row.p50_ms,
        metrics.outageMin,
        metrics.unmeasuredMin,
        VERDICT_RULES_VERSION,
      ).run();
    }
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}
