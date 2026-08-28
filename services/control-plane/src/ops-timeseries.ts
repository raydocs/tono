// Graded retention for collector telemetry. The live snapshot is still a
// singleton overwrite; these tables keep the minutes that used to vanish.

type Row = Record<string, any>;

const SAMPLE_RETENTION_SECONDS = 48 * 3600;
const ROLLUP_5M_RETENTION_SECONDS = 7 * 86400;
const ROLLUP_1H_RETENTION_SECONDS = 90 * 86400;
const HOME_PROBE_RETENTION_SECONDS = 90 * 86400;
const QUALITY_SAMPLE_RETENTION_SECONDS = 90 * 86400;
const NAME_LIMIT = 120;
const MAX_SERIES_POINTS = 2_000;
const MAX_FUTURE_SKEW_SECONDS = 5 * 60;
// How much source history one retention pass may roll up. After a cron outage
// the backlog is days of rows, and a single INSERT..SELECT over all of it is
// the statement D1 kills; successive runs drain the rest incrementally.
const ROLLUP_MAX_WINDOW_SECONDS = 6 * 3600;

export type AgentSample = {
  name: string;
  cpu: number | null;
  cpuCores: number | null;
  memTotal: number | null;
  memUsed: number | null;
  diskTotal: number | null;
  diskUsed: number | null;
  netIn: number | null;
  netOut: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  swapTotal: number | null;
  swapUsed: number | null;
  tcpConnections: number | null;
  processes: number | null;
  uptime: number | null;
  observedAt: number | null;
};

export type QualitySample = {
  name: string;
  ok: boolean;
  quality: string | null;
  blockStatus: string | null;
};

// One SELECTable column pair per exposed point field, so a caller can ask for
// just the series it will draw instead of every column for every node.
const METRIC_FIELDS = {
  cpu: { sample: 'cpu', rollup: 'cpu_avg' },
  memUsed: { sample: 'mem_used', rollup: 'mem_used_avg' },
  memTotal: { sample: 'mem_total', rollup: 'mem_total' },
  diskUsed: { sample: 'disk_used', rollup: 'disk_used_avg' },
  diskTotal: { sample: 'disk_total', rollup: 'disk_total' },
  load1: { sample: 'load1', rollup: 'load1_avg' },
  netIn: { sample: 'net_in', rollup: 'net_in_last' },
  netOut: { sample: 'net_out', rollup: 'net_out_last' },
  swapUsed: { sample: 'swap_used', rollup: 'swap_used_avg' },
  tcpConnections: { sample: 'tcp_connections', rollup: 'tcp_avg' },
} as const;

export type MetricField = keyof typeof METRIC_FIELDS;

export const METRIC_FIELD_NAMES = Object.keys(METRIC_FIELDS) as MetricField[];

export function isMetricField(value: string): value is MetricField {
  return Object.prototype.hasOwnProperty.call(METRIC_FIELDS, value);
}

export type MetricPoint = { t: number } & { [K in MetricField]?: number | null };

function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nodeName(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.slice(0, NAME_LIMIT);
}

function floorMinute(unix: number): number {
  return Math.floor(unix / 60) * 60;
}

function sampleObservedAt(value: unknown, nowUnix: number): number {
  const observed = finite(value);
  if (observed === null || observed <= 0 || observed > nowUnix + MAX_FUTURE_SKEW_SECONDS) {
    return nowUnix;
  }
  return observed;
}

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export async function recordAgentSamples(
  db: D1Database,
  agents: AgentSample[],
  nowUnix: number,
): Promise<number> {
  if (agents.length === 0) return 0;
  const statements: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    const name = nodeName(agent.name);
    if (!name) continue;
    // The collector is trusted to authenticate, not to have a perfect clock.
    // A millisecond timestamp or a host clock in the future otherwise creates a
    // row outside every normal query/retention window and can keep the live node
    // looking fresh indefinitely. Preserve genuinely old samples (they describe
    // a stalled probe), but pin invalid/future values to receipt time.
    const observed = floorMinute(sampleObservedAt(agent.observedAt, nowUnix));
    const key = `${name}:${observed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    statements.push(db.prepare(
      `INSERT INTO operations_agent_samples(
         node_name, observed_at, cpu, cpu_cores, mem_total, mem_used,
         disk_total, disk_used, net_in, net_out, load1, load5, load15,
         swap_total, swap_used, tcp_connections, processes, uptime
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_name, observed_at) DO UPDATE SET
         cpu = excluded.cpu,
         cpu_cores = excluded.cpu_cores,
         mem_total = excluded.mem_total,
         mem_used = excluded.mem_used,
         disk_total = excluded.disk_total,
         disk_used = excluded.disk_used,
         net_in = excluded.net_in,
         net_out = excluded.net_out,
         load1 = excluded.load1,
         load5 = excluded.load5,
         load15 = excluded.load15,
         swap_total = excluded.swap_total,
         swap_used = excluded.swap_used,
         tcp_connections = excluded.tcp_connections,
         processes = excluded.processes,
         uptime = excluded.uptime`,
    ).bind(
      name,
      observed,
      agent.cpu,
      agent.cpuCores,
      agent.memTotal,
      agent.memUsed,
      agent.diskTotal,
      agent.diskUsed,
      agent.netIn,
      agent.netOut,
      agent.load1,
      agent.load5,
      agent.load15,
      agent.swapTotal,
      agent.swapUsed,
      agent.tcpConnections,
      agent.processes,
      agent.uptime,
    ));
  }
  if (statements.length === 0) return 0;
  try {
    await db.batch(statements);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
  return statements.length;
}

export async function recordQualitySamples(
  db: D1Database,
  nodes: QualitySample[],
  nowUnix: number,
): Promise<number> {
  if (nodes.length === 0) return 0;
  const observed = floorMinute(nowUnix);
  const statements: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const name = nodeName(node.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    statements.push(db.prepare(
      `INSERT INTO operations_quality_samples(node_name, observed_at, ok, quality, block_status)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(node_name, observed_at) DO UPDATE SET
         ok = excluded.ok,
         quality = excluded.quality,
         block_status = excluded.block_status`,
    ).bind(
      name,
      observed,
      node.ok ? 1 : 0,
      node.quality,
      node.blockStatus,
    ));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
  return statements.length;
}

export async function recordHomeProbeSamples(
  db: D1Database,
  probes: Array<{ id: string; status: 'alive' | 'dead' }>,
  nowUnix: number,
): Promise<number> {
  if (probes.length === 0) return 0;
  const statements = probes.map((probe) => db.prepare(
    `INSERT INTO operations_home_probe_samples(home_exit_id, probed_at, status)
     VALUES(?, ?, ?)
     ON CONFLICT(home_exit_id, probed_at) DO UPDATE SET status = excluded.status`,
  ).bind(probe.id, nowUnix, probe.status));
  try {
    await db.batch(statements);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
  return statements.length;
}

async function rollupResolution(
  db: D1Database,
  source: 'samples' | 'rollups',
  fromResolution: number,
  toResolution: number,
  olderThan: number,
): Promise<void> {
  // `now - retention` is not bucket-aligned, and the scheduled run moves it by
  // five minutes at a time, so without this the boundary lands inside a bucket
  // on essentially every pass.
  const cutoff = Math.floor(olderThan / toResolution) * toResolution;
  const oldestRow = await db.prepare(
    source === 'samples'
      ? 'SELECT MIN(observed_at) AS oldest FROM operations_agent_samples WHERE observed_at < ?'
      : 'SELECT MIN(bucket_at) AS oldest FROM operations_agent_rollups WHERE resolution_seconds = ? AND bucket_at < ?',
  ).bind(...(source === 'samples' ? [cutoff] : [fromResolution, cutoff])).first<Row>();
  const oldest = finite(oldestRow?.oldest);
  if (oldest === null) return;
  const bound = Math.min(
    cutoff,
    Math.floor((oldest + ROLLUP_MAX_WINDOW_SECONDS) / toResolution) * toResolution,
  );
  // net_in/net_out are cumulative counters, not gauges. A node restart can make
  // them smaller inside a bucket, so MAX(value) is not the bucket's closing
  // counter. Rank by time and carry the final observation into the next tier.
  if (source === 'samples') {
    await db.prepare(
      `WITH ranked AS (
         SELECT
           *,
           (observed_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS target_bucket,
           ROW_NUMBER() OVER (
             PARTITION BY node_name,
               (observed_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER)
             ORDER BY observed_at DESC
           ) AS bucket_rank
         FROM operations_agent_samples
         WHERE observed_at < ?
       )
       INSERT INTO operations_agent_rollups(
         node_name, resolution_seconds, bucket_at, samples,
         rollup_writer_version, sample_counts_exact,
         cpu_samples, mem_used_samples, disk_used_samples,
         load1_samples, swap_used_samples, tcp_samples,
         cpu_avg, mem_used_avg, mem_total, disk_used_avg, disk_total,
         load1_avg, net_in_last, net_out_last, swap_used_avg, tcp_avg
       )
       SELECT
         node_name,
         ?,
         target_bucket,
         COUNT(*),
         2,
         1,
         COUNT(cpu),
         COUNT(mem_used),
         COUNT(disk_used),
         COUNT(load1),
         COUNT(swap_used),
         COUNT(tcp_connections),
         AVG(cpu),
         AVG(mem_used),
         MAX(CASE WHEN bucket_rank = 1 THEN mem_total END),
         AVG(disk_used),
         MAX(CASE WHEN bucket_rank = 1 THEN disk_total END),
         AVG(load1),
         MAX(CASE WHEN bucket_rank = 1 THEN net_in END),
         MAX(CASE WHEN bucket_rank = 1 THEN net_out END),
         AVG(swap_used),
         AVG(tcp_connections)
       FROM ranked
       GROUP BY node_name, target_bucket
       ON CONFLICT(node_name, resolution_seconds, bucket_at) DO UPDATE SET
         samples = excluded.samples,
         rollup_writer_version = excluded.rollup_writer_version,
         sample_counts_exact = excluded.sample_counts_exact,
         cpu_samples = excluded.cpu_samples,
         mem_used_samples = excluded.mem_used_samples,
         disk_used_samples = excluded.disk_used_samples,
         load1_samples = excluded.load1_samples,
         swap_used_samples = excluded.swap_used_samples,
         tcp_samples = excluded.tcp_samples,
         cpu_avg = excluded.cpu_avg,
         mem_used_avg = excluded.mem_used_avg,
         mem_total = excluded.mem_total,
         disk_used_avg = excluded.disk_used_avg,
         disk_total = excluded.disk_total,
         load1_avg = excluded.load1_avg,
         net_in_last = excluded.net_in_last,
         net_out_last = excluded.net_out_last,
         swap_used_avg = excluded.swap_used_avg,
         tcp_avg = excluded.tcp_avg
       WHERE excluded.samples >= operations_agent_rollups.samples`,
    ).bind(
      toResolution, toResolution,
      toResolution, toResolution,
      bound, toResolution,
    ).run();
    await db.prepare('DELETE FROM operations_agent_samples WHERE observed_at < ?')
      .bind(bound).run();
    return;
  }
  await db.prepare(
    `WITH ranked AS (
       SELECT
         *,
         CASE WHEN sample_counts_exact = 1 THEN cpu_samples
              WHEN cpu_avg IS NULL THEN 0 ELSE samples END AS effective_cpu_samples,
         CASE WHEN sample_counts_exact = 1 THEN mem_used_samples
              WHEN mem_used_avg IS NULL THEN 0 ELSE samples END AS effective_mem_used_samples,
         CASE WHEN sample_counts_exact = 1 THEN disk_used_samples
              WHEN disk_used_avg IS NULL THEN 0 ELSE samples END AS effective_disk_used_samples,
         CASE WHEN sample_counts_exact = 1 THEN load1_samples
              WHEN load1_avg IS NULL THEN 0 ELSE samples END AS effective_load1_samples,
         CASE WHEN sample_counts_exact = 1 THEN swap_used_samples
              WHEN swap_used_avg IS NULL THEN 0 ELSE samples END AS effective_swap_used_samples,
         CASE WHEN sample_counts_exact = 1 THEN tcp_samples
              WHEN tcp_avg IS NULL THEN 0 ELSE samples END AS effective_tcp_samples,
         (bucket_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS target_bucket,
         ROW_NUMBER() OVER (
           PARTITION BY node_name,
             (bucket_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER)
           ORDER BY bucket_at DESC
         ) AS bucket_rank
       FROM operations_agent_rollups
       WHERE resolution_seconds = ? AND bucket_at < ?
     )
     INSERT INTO operations_agent_rollups(
       node_name, resolution_seconds, bucket_at, samples,
       rollup_writer_version, sample_counts_exact,
       cpu_samples, mem_used_samples, disk_used_samples,
       load1_samples, swap_used_samples, tcp_samples,
       cpu_avg, mem_used_avg, mem_total, disk_used_avg, disk_total,
       load1_avg, net_in_last, net_out_last, swap_used_avg, tcp_avg
     )
     SELECT
       node_name,
       ?,
       target_bucket,
       SUM(samples),
       2,
       MIN(sample_counts_exact),
       SUM(effective_cpu_samples),
       SUM(effective_mem_used_samples),
       SUM(effective_disk_used_samples),
       SUM(effective_load1_samples),
       SUM(effective_swap_used_samples),
       SUM(effective_tcp_samples),
       CASE WHEN SUM(effective_cpu_samples) = 0 THEN NULL
            ELSE SUM(cpu_avg * effective_cpu_samples) / SUM(effective_cpu_samples) END,
       CASE WHEN SUM(effective_mem_used_samples) = 0 THEN NULL
            ELSE SUM(mem_used_avg * effective_mem_used_samples) / SUM(effective_mem_used_samples) END,
       MAX(CASE WHEN bucket_rank = 1 THEN mem_total END),
       CASE WHEN SUM(effective_disk_used_samples) = 0 THEN NULL
            ELSE SUM(disk_used_avg * effective_disk_used_samples) / SUM(effective_disk_used_samples) END,
       MAX(CASE WHEN bucket_rank = 1 THEN disk_total END),
       CASE WHEN SUM(effective_load1_samples) = 0 THEN NULL
            ELSE SUM(load1_avg * effective_load1_samples) / SUM(effective_load1_samples) END,
       MAX(CASE WHEN bucket_rank = 1 THEN net_in_last END),
       MAX(CASE WHEN bucket_rank = 1 THEN net_out_last END),
       CASE WHEN SUM(effective_swap_used_samples) = 0 THEN NULL
            ELSE SUM(swap_used_avg * effective_swap_used_samples) / SUM(effective_swap_used_samples) END,
       CASE WHEN SUM(effective_tcp_samples) = 0 THEN NULL
            ELSE SUM(tcp_avg * effective_tcp_samples) / SUM(effective_tcp_samples) END
     FROM ranked
     GROUP BY node_name, target_bucket
     ON CONFLICT(node_name, resolution_seconds, bucket_at) DO UPDATE SET
       samples = excluded.samples,
       rollup_writer_version = excluded.rollup_writer_version,
       sample_counts_exact = excluded.sample_counts_exact,
       cpu_samples = excluded.cpu_samples,
       mem_used_samples = excluded.mem_used_samples,
       disk_used_samples = excluded.disk_used_samples,
       load1_samples = excluded.load1_samples,
       swap_used_samples = excluded.swap_used_samples,
       tcp_samples = excluded.tcp_samples,
       cpu_avg = excluded.cpu_avg,
       mem_used_avg = excluded.mem_used_avg,
       mem_total = excluded.mem_total,
       disk_used_avg = excluded.disk_used_avg,
       disk_total = excluded.disk_total,
       load1_avg = excluded.load1_avg,
       net_in_last = excluded.net_in_last,
       net_out_last = excluded.net_out_last,
       swap_used_avg = excluded.swap_used_avg,
       tcp_avg = excluded.tcp_avg`,
  ).bind(
    toResolution, toResolution,
    toResolution, toResolution,
    fromResolution, bound, toResolution,
  ).run();
  await db.prepare(
    'DELETE FROM operations_agent_rollups WHERE resolution_seconds = ? AND bucket_at < ?',
  ).bind(fromResolution, bound).run();
}

export async function retainOperationsTimeseries(db: D1Database, nowUnix: number): Promise<void> {
  try {
    await rollupResolution(db, 'samples', 60, 300, nowUnix - SAMPLE_RETENTION_SECONDS);
    await rollupResolution(db, 'rollups', 300, 3600, nowUnix - ROLLUP_5M_RETENTION_SECONDS);
    await db.prepare(
      'DELETE FROM operations_agent_rollups WHERE resolution_seconds = 3600 AND bucket_at <= ?',
    ).bind(nowUnix - ROLLUP_1H_RETENTION_SECONDS).run();
    await db.prepare('DELETE FROM operations_home_probe_samples WHERE probed_at <= ?')
      .bind(nowUnix - HOME_PROBE_RETENTION_SECONDS).run();
    await db.prepare('DELETE FROM operations_quality_samples WHERE observed_at <= ?')
      .bind(nowUnix - QUALITY_SAMPLE_RETENTION_SECONDS).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

function parseRangeSeconds(value: string | null): number {
  if (value === '7d') return 7 * 86400;
  if (value === '90d') return 90 * 86400;
  return 24 * 3600;
}

function thin<T extends { t: number }>(points: T[], limit: number): T[] {
  if (points.length <= limit) return points;
  const stride = Math.ceil(points.length / limit);
  const kept: T[] = [];
  for (let i = 0; i < points.length; i += stride) kept.push(points[i]);
  const last = points[points.length - 1];
  if (kept[kept.length - 1]?.t !== last.t) kept.push(last);
  return kept;
}

export async function queryAgentMetrics(
  db: D1Database,
  input: { range: string | null; node: string | null; nowUnix: number; fields?: string[] | null },
): Promise<{
  from: number;
  to: number;
  resolutionSeconds: number;
  series: Record<string, MetricPoint[]>;
}> {
  const span = parseRangeSeconds(input.range);
  const to = input.nowUnix;
  const from = to - span;
  const node = input.node ? nodeName(input.node) : null;
  const requested: MetricField[] = input.fields?.length
    ? input.fields.filter(isMetricField)
    : METRIC_FIELD_NAMES;
  let resolutionSeconds = 60;
  if (span > ROLLUP_5M_RETENTION_SECONDS) resolutionSeconds = 3600;
  else if (span > SAMPLE_RETENTION_SECONDS) resolutionSeconds = 300;

  const series: Record<string, MetricPoint[]> = {};
  const push = (name: string, row: Row) => {
    const point: MetricPoint = { t: Number(row.t) };
    for (const field of requested) point[field] = finite(row[field]);
    (series[name] ??= []).push(point);
  };

  // Thin in SQL when a tier holds more points than the point budget, so the
  // rows a chart would never draw are never materialized. Below the budget the
  // stride is 1 and nothing changes.
  const stride = (resolution: number, since: number) =>
    Math.max(1, Math.ceil((Math.floor((to - since) / resolution) + 1) / MAX_SERIES_POINTS));

  // Each tier only holds what has aged into it: hour buckets exist only for
  // data older than seven days, five-minute buckets only for data older than
  // forty-eight hours. Querying one tier alone therefore leaves a hole at the
  // recent end — a ninety-day view built from hour buckets stopped seven days
  // ago, which is the part of the chart anyone actually looks at. So the tiers
  // are stitched, coarsest first, and the finer points overwrite on collision.
  const readSamples = async (since: number) => {
    const columns = requested.map((field) => `${METRIC_FIELDS[field].sample} AS ${field}`).join(', ');
    const step = stride(60, since);
    // A rollup tier's buckets are dense, so every Nth bucket by the time column
    // is every Nth point. Samples are not: the collector's cadence is a setting,
    // and a stride over wall-clock minutes keeps only the minute numbers it
    // happens to name — none of them when the cadence is an aligned even number
    // of minutes, which silently ends the curve where this tier begins. The
    // stride here counts position within the node's own series instead, from
    // the newest end: counting from the oldest keeps the last row only when the
    // series length happens to be odd, and the newest sample is the one the
    // recent-minutes tier exists for.
    const position = step > 1
      ? ', ROW_NUMBER() OVER (PARTITION BY node_name ORDER BY observed_at DESC) AS position'
      : '';
    const rows = await db.prepare(
      `SELECT node_name, t, ${requested.join(', ')} FROM (
         SELECT node_name, observed_at AS t, ${columns}${position}
         FROM operations_agent_samples
         WHERE observed_at >= ? AND observed_at <= ?
           ${node ? 'AND node_name = ?' : ''}
       )
       ${step > 1 ? 'WHERE (position - 1) % CAST(? AS INTEGER) = 0' : ''}
       ORDER BY t ASC`,
    ).bind(...[
      since, to,
      ...(node ? [node] : []),
      ...(step > 1 ? [step] : []),
    ]).all<Row>();
    for (const row of rows.results) push(String(row.node_name), row);
  };

  const readRollups = async (resolution: number, since: number) => {
    const columns = requested.map((field) => `${METRIC_FIELDS[field].rollup} AS ${field}`).join(', ');
    const step = stride(resolution, since);
    const rows = await db.prepare(
      `SELECT node_name, bucket_at AS t, ${columns}
       FROM operations_agent_rollups
       WHERE resolution_seconds = ? AND bucket_at >= ? AND bucket_at <= ?
         ${step > 1 ? 'AND (bucket_at / CAST(? AS INTEGER)) % CAST(? AS INTEGER) = 0' : ''}
         ${node ? 'AND node_name = ?' : ''}
       ORDER BY bucket_at ASC`,
    ).bind(...[
      resolution, since, to,
      ...(step > 1 ? [resolution, step] : []),
      ...(node ? [node] : []),
    ]).all<Row>();
    for (const row of rows.results) push(String(row.node_name), row);
  };

  try {
    if (resolutionSeconds === 3600) {
      await readRollups(3600, from);
    }
    if (resolutionSeconds >= 300) {
      await readRollups(300, Math.max(from, to - ROLLUP_5M_RETENTION_SECONDS));
    }
    await readSamples(Math.max(from, to - SAMPLE_RETENTION_SECONDS));
  } catch (error) {
    if (!missingTable(error)) throw error;
  }

  for (const name of Object.keys(series)) {
    series[name].sort((a, b) => a.t - b.t);
    const deduped: MetricPoint[] = [];
    for (const point of series[name]) {
      if (deduped.length && deduped[deduped.length - 1].t === point.t) {
        deduped[deduped.length - 1] = point;
      } else {
        deduped.push(point);
      }
    }
    series[name] = thin(deduped, MAX_SERIES_POINTS);
  }

  return { from, to, resolutionSeconds, series };
}

export async function queryHomeProbeHistory(
  db: D1Database,
  homeExitId: string,
  nowUnix: number,
  range?: string | null,
): Promise<{
  from: number;
  to: number;
  alive: number;
  dead: number;
  uptimeRatio: number | null;
  samples: Array<{ t: number; status: string }>;
}> {
  const span = range == null ? HOME_PROBE_RETENTION_SECONDS : parseRangeSeconds(range);
  const from = nowUnix - span;
  // The ratio is counted over every retained probe, but the timeline is capped
  // at the same point budget as the metric series: ninety days of probes is
  // tens of thousands of rows for a sparkline that can show two thousand.
  const bucketSeconds = Math.max(1, Math.ceil(span / MAX_SERIES_POINTS));
  let alive = 0;
  let dead = 0;
  let samples: Array<{ t: number; status: string }> = [];
  try {
    const counts = await db.prepare(
      `SELECT
         SUM(CASE WHEN status = 'alive' THEN 1 ELSE 0 END) AS alive,
         SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS dead
       FROM operations_home_probe_samples
       WHERE home_exit_id = ? AND probed_at >= ?`,
    ).bind(homeExitId, from).first<Row>();
    alive = finite(counts?.alive) ?? 0;
    dead = finite(counts?.dead) ?? 0;
    const rows = await db.prepare(
      `SELECT MAX(probed_at) AS t, status
       FROM operations_home_probe_samples
       WHERE home_exit_id = ? AND probed_at >= ?
       GROUP BY probed_at / CAST(? AS INTEGER)
       ORDER BY t ASC`,
    ).bind(homeExitId, from, bucketSeconds).all<Row>();
    samples = rows.results.map((row) => ({
      t: Number(row.t),
      status: String(row.status),
    }));
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const total = alive + dead;
  return {
    from,
    to: nowUnix,
    alive,
    dead,
    uptimeRatio: total === 0 ? null : alive / total,
    samples: thin(samples, MAX_SERIES_POINTS),
  };
}
