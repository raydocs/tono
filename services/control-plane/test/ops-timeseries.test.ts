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
      `SELECT samples, cpu_avg FROM operations_agent_rollups
       WHERE node_name = 'Split' AND resolution_seconds = 300 AND bucket_at = ?`,
    ).bind(bucket).first<Record<string, any>>();

    expect(rollup).not.toBeNull();
    // Five samples went in; the bucket must account for five.
    expect(Number(rollup!.samples)).toBe(5);
    // Mean of 10,20,30,40,50.
    expect(Number(rollup!.cpu_avg)).toBeCloseTo(30, 5);
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
