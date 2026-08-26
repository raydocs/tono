// The rollup path, which nothing else exercises.
//
// The suite covers "minutes are kept and served as metrics". It does not cover
// what happens when those minutes age out — which is where the history that the
// 7-day and 90-day views are built from actually comes from.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordAgentSamples, retainOperationsTimeseries, queryAgentMetrics } from '../src/ops-timeseries';

const db = () => (env as unknown as { DB: D1Database }).DB;

const sample = (name: string, observedAt: number, cpu: number) => ({
  name,
  cpu,
  cpuCores: 2,
  memTotal: 1000,
  memUsed: 500,
  diskTotal: 1000,
  diskUsed: 100,
  netIn: 10,
  netOut: 10,
  load1: 1,
  load5: 1,
  load15: 1,
  swapTotal: 0,
  swapUsed: 0,
  tcpConnections: 5,
  processes: 10,
  uptime: 100,
  observedAt,
});

describe('operations timeseries retention', () => {
  beforeEach(async () => {
    await db().prepare('DELETE FROM operations_agent_samples').run();
    await db().prepare('DELETE FROM operations_agent_rollups').run();
  });

  it('fences the pre-migration rollup writer before it can update or delete source rows', async () => {
    const bucket = 1_800_000_000;
    await recordAgentSamples(db(), [
      sample('Fence existing', bucket, 20),
      sample('Fence new', bucket, 40),
    ], bucket);
    await db().prepare(
      `INSERT INTO operations_agent_rollups(
         node_name, resolution_seconds, bucket_at, samples,
         rollup_writer_version, sample_counts_exact, cpu_samples, cpu_avg
       ) VALUES('Fence existing', 300, ?, 7, 2, 1, 7, 77)`,
    ).bind(bucket).run();

    const oldWorkerAttempt = async () => {
      // This is deliberately the old column list. BEFORE INSERT must run before
      // SQLite chooses the UPSERT branch, aborting both the conflicting and new
      // candidates as one statement.
      await db().prepare(
        `INSERT INTO operations_agent_rollups(
           node_name, resolution_seconds, bucket_at, samples, cpu_avg
         )
         SELECT node_name, 300, ?, COUNT(*), AVG(cpu)
         FROM operations_agent_samples
         GROUP BY node_name
         ON CONFLICT(node_name, resolution_seconds, bucket_at) DO UPDATE SET
           samples = excluded.samples,
           cpu_avg = excluded.cpu_avg`,
      ).bind(bucket).run();
      // The real retention path awaits the UPSERT before issuing this separate
      // DELETE. A trigger rejection must keep this line unreachable.
      await db().prepare('DELETE FROM operations_agent_samples').run();
    };

    await expect(oldWorkerAttempt()).rejects.toThrow(/requires rollup writer v2/);
    const existing = await db().prepare(
      `SELECT samples, cpu_avg FROM operations_agent_rollups
       WHERE node_name = 'Fence existing'`,
    ).first<Record<string, any>>();
    const inserted = await db().prepare(
      `SELECT samples FROM operations_agent_rollups
       WHERE node_name = 'Fence new'`,
    ).first<Record<string, any>>();
    const source = await db().prepare(
      'SELECT COUNT(*) AS c FROM operations_agent_samples',
    ).first<Record<string, any>>();
    expect(Number(existing!.samples)).toBe(7);
    expect(Number(existing!.cpu_avg)).toBe(77);
    expect(inserted).toBeNull();
    expect(Number(source!.c)).toBe(2);
  });

  it('does not lose the early half of a bucket that ages out across two runs', async () => {
    // One 5-minute bucket, aligned, with a sample every minute.
    const bucket = 1_800_000_000; // divisible by 300
    const minutes = [0, 60, 120, 180, 240].map((offset) => bucket + offset);
    await recordAgentSamples(db(), minutes.map((t, i) => sample('Split', t, (i + 1) * 10)), bucket);

    // Retention runs every five minutes and `now - 48h` is not bucket-aligned,
    // so the boundary lands inside a bucket on essentially every run.
    const retentionSpan = 48 * 3600;
    await retainOperationsTimeseries(db(), bucket + 150 + retentionSpan);
    await retainOperationsTimeseries(db(), bucket + 400 + retentionSpan);

    const rollup = await db().prepare(
      `SELECT samples, cpu_samples, cpu_avg,
              rollup_writer_version, sample_counts_exact
       FROM operations_agent_rollups
       WHERE node_name = 'Split' AND resolution_seconds = 300 AND bucket_at = ?`,
    ).bind(bucket).first<Record<string, any>>();

    expect(rollup).not.toBeNull();
    // Five samples went in; the bucket must account for five.
    expect(Number(rollup!.samples)).toBe(5);
    expect(Number(rollup!.cpu_samples)).toBe(5);
    // Mean of 10,20,30,40,50.
    expect(Number(rollup!.cpu_avg)).toBeCloseTo(30, 5);
    expect(Number(rollup!.rollup_writer_version)).toBe(2);
    expect(Number(rollup!.sample_counts_exact)).toBe(1);
  });

  it('actually reduces rows when it rolls up', async () => {
    // The bucket key was `(observed_at / ?) * ?` with the divisor bound as a
    // parameter. D1 binds a JS number as REAL, so that is float division and
    // the multiply restores the timestamp — every sample became its own
    // "five-minute bucket" and the retention policy reduced nothing. At sixteen
    // nodes and a sample a minute that is ~2.07M rollup rows over ninety days
    // instead of a few tens of thousands.
    const bucket = 1_800_000_000;
    const minutes = Array.from({ length: 60 }, (_, i) => bucket + i * 60);
    await recordAgentSamples(
      db(), minutes.map((t, i) => sample('Bulk', t, i)), bucket + 3_600,
    );
    await retainOperationsTimeseries(db(), bucket + 3_600 + 48 * 3600);

    const rollups = await db().prepare(
      `SELECT COUNT(*) AS c FROM operations_agent_rollups
       WHERE node_name = 'Bulk' AND resolution_seconds = 300`,
    ).first<Record<string, any>>();
    // Sixty minutes at five-minute resolution is twelve buckets, not sixty.
    expect(Number(rollups!.c)).toBe(12);
  });

  it('keeps the last counter in each bucket across a node restart', async () => {
    const hour = Math.floor(1_800_000_000 / 3_600) * 3_600;
    const points = [
      { ...sample('Restarted', hour + 60, 10), netIn: 900, netOut: 1_800 },
      { ...sample('Restarted', hour + 120, 20), netIn: 1_000, netOut: 2_000 },
      // Counter reset inside the first five-minute bucket.
      { ...sample('Restarted', hour + 180, 30), netIn: 20, netOut: 40 },
      { ...sample('Restarted', hour + 360, 40), netIn: 50, netOut: 100 },
      { ...sample('Restarted', hour + 660, 50), netIn: 100, netOut: 200 },
    ];
    await recordAgentSamples(db(), points, hour + 660);

    // First age raw minutes into five-minute buckets, but not into hours yet.
    await retainOperationsTimeseries(db(), hour + 3_600 + 48 * 3_600);
    const firstBucket = await db().prepare(
      `SELECT net_in_last, net_out_last FROM operations_agent_rollups
       WHERE node_name = 'Restarted' AND resolution_seconds = 300 AND bucket_at = ?`,
    ).bind(hour).first<Record<string, any>>();
    expect(Number(firstBucket!.net_in_last)).toBe(20);
    expect(Number(firstBucket!.net_out_last)).toBe(40);

    // Then age those five-minute buckets into the 90-day hourly tier. The hour
    // must end at the latest bucket's counters, not the pre-restart maximum.
    await retainOperationsTimeseries(db(), hour + 3_600 + 8 * 86_400);
    const hourly = await db().prepare(
      `SELECT net_in_last, net_out_last FROM operations_agent_rollups
       WHERE node_name = 'Restarted' AND resolution_seconds = 3600 AND bucket_at = ?`,
    ).bind(hour).first<Record<string, any>>();
    expect(Number(hourly!.net_in_last)).toBe(100);
    expect(Number(hourly!.net_out_last)).toBe(200);
  });

  it('weights hourly gauges by their real non-null sample counts', async () => {
    const hour = Math.floor(1_800_200_000 / 3_600) * 3_600;
    const points = [
      { ...sample('Irregular', hour, 10), memTotal: 1_000, memUsed: 100, diskUsed: null, load1: 1, swapUsed: null, tcpConnections: 1 },
      { ...sample('Irregular', hour + 60, 20), memTotal: 1_000, memUsed: null, diskUsed: 200, load1: 2, swapUsed: null, tcpConnections: 2 },
      { ...sample('Irregular', hour + 120, 0), cpu: null, memTotal: 1_000, memUsed: null, diskUsed: 300, load1: 3, swapUsed: null, tcpConnections: 3 },
      { ...sample('Irregular', hour + 180, 0), cpu: null, memTotal: 1_000, memUsed: null, diskUsed: null, load1: null, swapUsed: 4, tcpConnections: 4 },
      { ...sample('Irregular', hour + 240, 0), cpu: null, memTotal: 1_000, memUsed: null, diskUsed: null, load1: null, swapUsed: null, tcpConnections: 5 },
      // The later bucket has only one sample and the machine reports a smaller
      // memory total after reconfiguration.
      {
        ...sample('Irregular', hour + 360, 100),
        memTotal: 800,
        memUsed: 700,
        diskTotal: 750,
        diskUsed: 900,
        load1: 10,
        swapUsed: 8,
        tcpConnections: null,
      },
    ];
    await recordAgentSamples(db(), points, hour + 360);

    await retainOperationsTimeseries(db(), hour + 3_600 + 48 * 3_600);
    const firstBucket = await db().prepare(
      `SELECT samples, cpu_samples, mem_used_samples, disk_used_samples,
              load1_samples, swap_used_samples, tcp_samples, cpu_avg
       FROM operations_agent_rollups
       WHERE node_name = 'Irregular' AND resolution_seconds = 300 AND bucket_at = ?`,
    ).bind(hour).first<Record<string, any>>();
    expect(Number(firstBucket!.samples)).toBe(5);
    expect(Number(firstBucket!.cpu_samples)).toBe(2);
    expect(Number(firstBucket!.mem_used_samples)).toBe(1);
    expect(Number(firstBucket!.disk_used_samples)).toBe(2);
    expect(Number(firstBucket!.load1_samples)).toBe(3);
    expect(Number(firstBucket!.swap_used_samples)).toBe(1);
    expect(Number(firstBucket!.tcp_samples)).toBe(5);
    expect(Number(firstBucket!.cpu_avg)).toBeCloseTo(15, 5);

    await retainOperationsTimeseries(db(), hour + 3_600 + 8 * 86_400);
    const hourly = await db().prepare(
      `SELECT samples, cpu_samples, mem_used_samples, disk_used_samples,
              load1_samples, swap_used_samples, tcp_samples,
              cpu_avg, mem_used_avg, mem_total, disk_used_avg, disk_total,
              load1_avg, swap_used_avg, tcp_avg
       FROM operations_agent_rollups
       WHERE node_name = 'Irregular' AND resolution_seconds = 3600 AND bucket_at = ?`,
    ).bind(hour).first<Record<string, any>>();
    expect(Number(hourly!.samples)).toBe(6);
    expect(Number(hourly!.cpu_samples)).toBe(3);
    expect(Number(hourly!.mem_used_samples)).toBe(2);
    expect(Number(hourly!.disk_used_samples)).toBe(3);
    expect(Number(hourly!.load1_samples)).toBe(4);
    expect(Number(hourly!.swap_used_samples)).toBe(2);
    expect(Number(hourly!.tcp_samples)).toBe(5);
    expect(Number(hourly!.cpu_avg)).toBeCloseTo((10 + 20 + 100) / 3, 5);
    expect(Number(hourly!.mem_used_avg)).toBeCloseTo((100 + 700) / 2, 5);
    expect(Number(hourly!.disk_used_avg)).toBeCloseTo((200 + 300 + 900) / 3, 5);
    expect(Number(hourly!.load1_avg)).toBeCloseTo((1 + 2 + 3 + 10) / 4, 5);
    expect(Number(hourly!.swap_used_avg)).toBeCloseTo((4 + 8) / 2, 5);
    expect(Number(hourly!.tcp_avg)).toBeCloseTo((1 + 2 + 3 + 4 + 5) / 5, 5);
    expect(Number(hourly!.mem_total)).toBe(800);
    expect(Number(hourly!.disk_total)).toBe(750);
  });

  it('keeps legacy rollups usable without claiming their sample counts are exact', async () => {
    const hour = Math.floor(1_800_300_000 / 3_600) * 3_600;
    await db().batch([
      db().prepare(
        `INSERT INTO operations_agent_rollups(
           node_name, resolution_seconds, bucket_at, samples,
           rollup_writer_version, sample_counts_exact, cpu_samples, cpu_avg
         ) VALUES('Legacy mix', 300, ?, 5, 2, 0, 1, 20)`,
      ).bind(hour),
      db().prepare(
        `INSERT INTO operations_agent_rollups(
           node_name, resolution_seconds, bucket_at, samples,
           rollup_writer_version, sample_counts_exact, cpu_samples, cpu_avg
         ) VALUES('Legacy mix', 300, ?, 2, 2, 1, 2, 100)`,
      ).bind(hour + 300),
    ]);

    await retainOperationsTimeseries(db(), hour + 3_600 + 8 * 86_400);
    const hourly = await db().prepare(
      `SELECT samples, cpu_samples, cpu_avg,
              rollup_writer_version, sample_counts_exact
       FROM operations_agent_rollups
       WHERE node_name = 'Legacy mix' AND resolution_seconds = 3600 AND bucket_at = ?`,
    ).bind(hour).first<Record<string, any>>();

    expect(Number(hourly!.samples)).toBe(7);
    // The legacy row's stale count of 1 is ignored in favour of its historical
    // `samples` denominator, while the v2 row keeps its exact count of 2.
    expect(Number(hourly!.cpu_samples)).toBe(7);
    expect(Number(hourly!.cpu_avg)).toBeCloseTo((20 * 5 + 100 * 2) / 7, 5);
    expect(Number(hourly!.rollup_writer_version)).toBe(2);
    expect(Number(hourly!.sample_counts_exact)).toBe(0);
  });

  it('pins invalid or far-future clocks to receipt time without rewriting old samples', async () => {
    const receivedAt = 1_800_100_123;
    await recordAgentSamples(db(), [
      // A millisecond timestamp is the collector failure this guard primarily
      // addresses: without pinning, it lands centuries outside query/retention.
      sample('Future clock', receivedAt * 1_000, 10),
      sample('Invalid clock', 0, 20),
      sample('Old probe', receivedAt - 7_200, 30),
    ], receivedAt);

    const rows = await db().prepare(
      `SELECT node_name, observed_at FROM operations_agent_samples
       ORDER BY node_name`,
    ).all<Record<string, any>>();
    const observed = Object.fromEntries(rows.results.map((row) => [
      String(row.node_name),
      Number(row.observed_at),
    ]));
    expect(observed).toEqual({
      'Future clock': Math.floor(receivedAt / 60) * 60,
      'Invalid clock': Math.floor(receivedAt / 60) * 60,
      'Old probe': Math.floor((receivedAt - 7_200) / 60) * 60,
    });
  });

  it('serves the most recent week in a 90-day view', async () => {
    const now = 1_800_000_000;
    // A sample from yesterday: inside the 48h sample window, so it lives in
    // `operations_agent_samples` and has never been rolled up to an hour.
    await recordAgentSamples(db(), [sample('Recent', now - 86_400, 42)], now);

    const metrics = await queryAgentMetrics(db(), { range: '90d', node: null, nowUnix: now });
    const points = metrics.series['Recent'] ?? [];
    expect(points.length).toBeGreaterThan(0);
  });
});
