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

export type MetricPoint = {
  t: number;
  cpu: number | null;
  memUsed: number | null;
  memTotal: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
  load1: number | null;
  netIn: number | null;
  netOut: number | null;
  swapUsed: number | null;
  tcpConnections: number | null;
};

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
  if (source === 'samples') {
    await db.prepare(
      `INSERT INTO operations_agent_rollups(
         node_name, resolution_seconds, bucket_at, samples,
         cpu_avg, mem_used_avg, mem_total, disk_used_avg, disk_total,
         load1_avg, net_in_last, net_out_last, swap_used_avg, tcp_avg
       )
       SELECT
         node_name,
         ?,
         (observed_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER),
         COUNT(*),
         AVG(cpu),
         AVG(mem_used),
         MAX(mem_total),
         AVG(disk_used),
         MAX(disk_total),
         AVG(load1),
         MAX(net_in),
         MAX(net_out),
         AVG(swap_used),
         AVG(tcp_connections)
       FROM operations_agent_samples
       WHERE observed_at < ?
       GROUP BY node_name, (observed_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER)
       ON CONFLICT(node_name, resolution_seconds, bucket_at) DO UPDATE SET
         samples = excluded.samples,
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
    ).bind(toResolution, toResolution, toResolution, cutoff, toResolution, toResolution).run();
    await db.prepare('DELETE FROM operations_agent_samples WHERE observed_at < ?')
      .bind(cutoff).run();
    return;
  }
  await db.prepare(
    `INSERT INTO operations_agent_rollups(
       node_name, resolution_seconds, bucket_at, samples,
       cpu_avg, mem_used_avg, mem_total, disk_used_avg, disk_total,
       load1_avg, net_in_last, net_out_last, swap_used_avg, tcp_avg
     )
     SELECT
       node_name,
       ?,
       (bucket_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER),
       SUM(samples),
       AVG(cpu_avg),
       AVG(mem_used_avg),
       MAX(mem_total),
       AVG(disk_used_avg),
       MAX(disk_total),
       AVG(load1_avg),
       MAX(net_in_last),
       MAX(net_out_last),
       AVG(swap_used_avg),
       AVG(tcp_avg)
     FROM operations_agent_rollups
     WHERE resolution_seconds = ? AND bucket_at < ?
     GROUP BY node_name, (bucket_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER)
     ON CONFLICT(node_name, resolution_seconds, bucket_at) DO UPDATE SET
       samples = excluded.samples,
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
    toResolution, toResolution, toResolution,
    fromResolution, cutoff,
    toResolution, toResolution,
  ).run();
  await db.prepare(
    'DELETE FROM operations_agent_rollups WHERE resolution_seconds = ? AND bucket_at < ?',
  ).bind(fromResolution, cutoff).run();
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
  input: { range: string | null; node: string | null; nowUnix: number },
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
  let resolutionSeconds = 60;
  if (span > ROLLUP_5M_RETENTION_SECONDS) resolutionSeconds = 3600;
  else if (span > SAMPLE_RETENTION_SECONDS) resolutionSeconds = 300;

  const series: Record<string, MetricPoint[]> = {};
  const push = (name: string, point: MetricPoint) => {
    (series[name] ??= []).push(point);
  };

  // Each tier only holds what has aged into it: hour buckets exist only for
  // data older than seven days, five-minute buckets only for data older than
  // forty-eight hours. Querying one tier alone therefore leaves a hole at the
  // recent end — a ninety-day view built from hour buckets stopped seven days
  // ago, which is the part of the chart anyone actually looks at. So the tiers
  // are stitched, coarsest first, and the finer points overwrite on collision.
  const readSamples = async (since: number) => {
    const rows = await db.prepare(
      node
        ? `SELECT node_name, observed_at AS t, cpu, mem_used, mem_total, disk_used, disk_total,
                  load1, net_in, net_out, swap_used, tcp_connections
           FROM operations_agent_samples
           WHERE observed_at >= ? AND observed_at <= ? AND node_name = ?
           ORDER BY observed_at ASC`
        : `SELECT node_name, observed_at AS t, cpu, mem_used, mem_total, disk_used, disk_total,
                  load1, net_in, net_out, swap_used, tcp_connections
           FROM operations_agent_samples
           WHERE observed_at >= ? AND observed_at <= ?
           ORDER BY observed_at ASC`,
    ).bind(...(node ? [since, to, node] : [since, to])).all<Row>();
    for (const row of rows.results) {
      push(String(row.node_name), {
        t: Number(row.t),
        cpu: finite(row.cpu),
        memUsed: finite(row.mem_used),
        memTotal: finite(row.mem_total),
        diskUsed: finite(row.disk_used),
        diskTotal: finite(row.disk_total),
        load1: finite(row.load1),
        netIn: finite(row.net_in),
        netOut: finite(row.net_out),
        swapUsed: finite(row.swap_used),
        tcpConnections: finite(row.tcp_connections),
      });
    }
  };

  const readRollups = async (resolution: number, since: number) => {
    const rows = await db.prepare(
      node
        ? `SELECT node_name, bucket_at AS t, cpu_avg, mem_used_avg, mem_total, disk_used_avg,
                  disk_total, load1_avg, net_in_last, net_out_last, swap_used_avg, tcp_avg
           FROM operations_agent_rollups
           WHERE resolution_seconds = ? AND bucket_at >= ? AND bucket_at <= ? AND node_name = ?
           ORDER BY bucket_at ASC`
        : `SELECT node_name, bucket_at AS t, cpu_avg, mem_used_avg, mem_total, disk_used_avg,
                  disk_total, load1_avg, net_in_last, net_out_last, swap_used_avg, tcp_avg
           FROM operations_agent_rollups
           WHERE resolution_seconds = ? AND bucket_at >= ? AND bucket_at <= ?
           ORDER BY bucket_at ASC`,
    ).bind(...(node
      ? [resolution, since, to, node]
      : [resolution, since, to])).all<Row>();
    for (const row of rows.results) {
      push(String(row.node_name), {
        t: Number(row.t),
        cpu: finite(row.cpu_avg),
        memUsed: finite(row.mem_used_avg),
        memTotal: finite(row.mem_total),
        diskUsed: finite(row.disk_used_avg),
        diskTotal: finite(row.disk_total),
        load1: finite(row.load1_avg),
        netIn: finite(row.net_in_last),
        netOut: finite(row.net_out_last),
        swapUsed: finite(row.swap_used_avg),
        tcpConnections: finite(row.tcp_avg),
      });
    }
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
): Promise<{
  from: number;
  to: number;
  alive: number;
  dead: number;
  uptimeRatio: number | null;
  samples: Array<{ t: number; status: string }>;
}> {
  const from = nowUnix - HOME_PROBE_RETENTION_SECONDS;
  let samples: Array<{ t: number; status: string }> = [];
  try {
    const rows = await db.prepare(
      `SELECT probed_at, status FROM operations_home_probe_samples
       WHERE home_exit_id = ? AND probed_at >= ?
       ORDER BY probed_at ASC`,
    ).bind(homeExitId, from).all<Row>();
    samples = rows.results.map((row) => ({
      t: Number(row.probed_at),
      status: String(row.status),
    }));
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const alive = samples.filter((sample) => sample.status === 'alive').length;
  const dead = samples.filter((sample) => sample.status === 'dead').length;
  const total = alive + dead;
  return {
    from,
    to: nowUnix,
    alive,
    dead,
    uptimeRatio: total === 0 ? null : alive / total,
    samples,
  };
}
