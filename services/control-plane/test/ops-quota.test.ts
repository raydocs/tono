import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  cycleBounds,
  detectCounterReset,
  projectExhaustion,
  quotaLevel,
  usedBytes,
  rollNodeCycle,
  rollAllNodeCycles,
  quotaSummary,
  upsertErrorDaily,
  readErrorTrend,
  readAgentNetCounters,
} from '../src/ops/quota';

const db = () => (env as unknown as { DB: D1Database }).DB;

const utc = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;

async function insertProfile(name: string, extra: Record<string, unknown> = {}) {
  const columns = [
    'id', 'catalog_name', 'status', 'created_at', 'updated_at',
    'traffic_quota_bytes', 'quota_counts', 'cycle_kind', 'cycle_anchor_day', 'auto_unlist_at_pct',
  ];
  const values = [
    extra.id ?? `p-${name}`,
    name,
    extra.status ?? 'active',
    extra.created_at ?? 1,
    extra.updated_at ?? 1,
    extra.traffic_quota_bytes ?? 1_000,
    extra.quota_counts ?? 'in_out',
    extra.cycle_kind ?? 'calendar_day',
    extra.cycle_anchor_day ?? 1,
    extra.auto_unlist_at_pct ?? 95,
  ];
  await db().prepare(
    `INSERT INTO ops_node_profiles(${columns.join(', ')}) VALUES(${columns.map(() => '?').join(', ')})`,
  ).bind(...values).run();
}

describe('cycleBounds', () => {
  it('clamps calendar_day 30 in February and splits on the anchor', () => {
    const feb15 = utc(2025, 2, 15, 12);
    const febClamped = cycleBounds('calendar_day', 30, feb15);
    expect(febClamped).toEqual({ start: utc(2025, 1, 30), end: utc(2025, 2, 28) });

    const leap = cycleBounds('calendar_day', 30, utc(2024, 2, 15, 12));
    expect(leap).toEqual({ start: utc(2024, 1, 30), end: utc(2024, 2, 29) });

    const afterAnchor = cycleBounds('calendar_day', 10, utc(2025, 3, 15, 8));
    expect(afterAnchor).toEqual({ start: utc(2025, 3, 10), end: utc(2025, 4, 10) });

    const beforeAnchor = cycleBounds('calendar_day', 20, utc(2025, 3, 15, 8));
    expect(beforeAnchor).toEqual({ start: utc(2025, 2, 20), end: utc(2025, 3, 20) });
  });

  it('builds rolling 30-day windows and anniversary months from a start', () => {
    const origin = utc(2025, 1, 1);
    const now = origin + 45 * 86400 + 3600;
    const rolling = cycleBounds('rolling_30d', origin, now);
    expect(rolling?.start).toBe(origin + 30 * 86400);
    expect(rolling?.end).toBe(origin + 60 * 86400);

    const anniversary = cycleBounds('anniversary', utc(2025, 1, 15), utc(2025, 3, 1));
    expect(anniversary).toEqual({ start: utc(2025, 2, 15), end: utc(2025, 3, 15) });

    expect(cycleBounds('manual', 1, now)).toBeNull();
  });
});

describe('detectCounterReset / usedBytes / projection / level', () => {
  it('treats a drop as a reset and a new baseline', () => {
    expect(detectCounterReset(null, 40)).toEqual({ reset: false, delta: 0, baseline: 40 });
    expect(detectCounterReset(100, 140)).toEqual({ reset: false, delta: 40, baseline: 100 });
    expect(detectCounterReset(1000, 50)).toEqual({ reset: true, delta: 50, baseline: 50 });
  });

  it('selects in, out, or both', () => {
    expect(usedBytes('in', 10, 3)).toBe(10);
    expect(usedBytes('out', 10, 3)).toBe(3);
    expect(usedBytes('in_out', 10, 3)).toBe(13);
    expect(usedBytes(null, 10, 3)).toBe(13);
  });

  it('projects exhaustion from a 7-day slope and refuses a flat or short series', () => {
    const t = 1_800_000_000;
    expect(projectExhaustion([{ at: t, used: 10 }, { at: t + 10, used: 20 }], 100, t + 1000)).toBeNull();
    expect(projectExhaustion([
      { at: t, used: 10 },
      { at: t + 10, used: 10 },
      { at: t + 20, used: 10 },
    ], 100, t + 1000)).toBeNull();
    const hit = projectExhaustion([
      { at: t, used: 0 },
      { at: t + 100, used: 50 },
      { at: t + 200, used: 100 },
    ], 200, t + 10_000);
    expect(hit).toBe(t + 400);
  });

  it('maps percent onto ok / chore / warn / severe', () => {
    expect(quotaLevel(0)).toBe('ok');
    expect(quotaLevel(69.9)).toBe('ok');
    expect(quotaLevel(70)).toBe('chore');
    expect(quotaLevel(89.9)).toBe('chore');
    expect(quotaLevel(90)).toBe('warn');
    expect(quotaLevel(99)).toBe('warn');
    expect(quotaLevel(100)).toBe('severe');
    expect(quotaLevel(80, { warn: 50, alert: 80, exhausted: 95 })).toBe('warn');
  });
});

describe('rollNodeCycle', () => {
  it('opens a cycle, accumulates deltas, and rolls across the end', async () => {
    const start = utc(2025, 3, 1);
    const mid = start + 3600;
    const end = utc(2025, 4, 1);
    await insertProfile('Tokyo · North', {
      cycle_kind: 'calendar_day',
      cycle_anchor_day: 1,
      traffic_quota_bytes: 1_000,
    });

    const first = await rollNodeCycle(
      db(),
      'Tokyo · North',
      { cycle_kind: 'calendar_day', cycle_anchor_day: 1, traffic_quota_bytes: 1_000, quota_counts: 'in_out' },
      { in: 100, out: 20, at: mid },
      mid,
    );
    expect(first?.status).toBe('open');
    expect(Number(first?.used_bytes)).toBe(0);
    expect(Number(first?.cycle_start)).toBe(start);
    expect(Number(first?.cycle_end)).toBe(end);

    const grown = await rollNodeCycle(
      db(),
      'Tokyo · North',
      { cycle_kind: 'calendar_day', cycle_anchor_day: 1, traffic_quota_bytes: 1_000, quota_counts: 'in_out' },
      { in: 150, out: 40, at: mid + 60 },
      mid + 60,
    );
    expect(Number(grown?.used_bytes)).toBe(70);
    expect(Number(grown?.resets_detected)).toBe(0);

    const reset = await rollNodeCycle(
      db(),
      'Tokyo · North',
      { cycle_kind: 'calendar_day', cycle_anchor_day: 1, traffic_quota_bytes: 1_000, quota_counts: 'out' },
      { in: 10, out: 5, at: mid + 120 },
      mid + 120,
    );
    expect(Number(reset?.resets_detected)).toBe(2);
    expect(Number(reset?.used_bytes)).toBe(75);

    const afterEnd = end + 3600;
    const rolled = await rollNodeCycle(
      db(),
      'Tokyo · North',
      { cycle_kind: 'calendar_day', cycle_anchor_day: 1, traffic_quota_bytes: 1_000, quota_counts: 'in_out' },
      { in: 10, out: 5, at: afterEnd },
      afterEnd,
    );
    expect(rolled?.status).toBe('open');
    expect(Number(rolled?.used_bytes)).toBe(0);
    expect(Number(rolled?.cycle_start)).toBe(end);
    expect(String(rolled?.id)).not.toBe(String(first?.id));

    const closed = await db().prepare(
      "SELECT used_bytes, peak_day_bytes, status FROM node_traffic_cycles WHERE id = ?",
    ).bind(first!.id).first<Record<string, unknown>>();
    expect(closed?.status).toBe('closed');
    expect(Number(closed?.used_bytes)).toBe(75);
    expect(Number(closed?.peak_day_bytes)).toBe(75);

    const summary = await quotaSummary(db(), 'Tokyo · North');
    expect(summary.used).toBe(0);
    expect(summary.quota).toBe(1_000);
    expect(summary.level).toBe('ok');
    expect(summary.autoUnlistAtPct).toBe(95);
  });

  it('rolls every active profile through injected counters', async () => {
    await insertProfile('A');
    await insertProfile('B');
    const now = utc(2025, 5, 10, 4);
    const result = await rollAllNodeCycles(db(), now, async (node) => {
      if (node === 'A') return { in: 8, out: 2, at: now };
      return null;
    });
    expect(result).toEqual({ rolled: 1, skipped: 1 });
    expect(await openCount('A')).toBe(1);
    expect(await openCount('B')).toBe(0);
  });
});

async function openCount(name: string) {
  const row = await db().prepare(
    "SELECT COUNT(*) AS c FROM node_traffic_cycles WHERE node_name = ? AND status = 'open'",
  ).bind(name).first<{ c: number }>();
  return Number(row?.c ?? 0);
}

describe('error digest', () => {
  it('upserts daily counts and reads a 7-day trend', async () => {
    const day = utc(2026, 9, 1);
    await upsertErrorDaily(db(), 'Tokyo · North', day + 3600, {
      dial_timeout: 2,
      handshake_fail: 1,
    }, { dial_timeout: 'connect: timeout' });
    await upsertErrorDaily(db(), 'Tokyo · North', day + 7200, {
      dial_timeout: 3,
    }, { dial_timeout: 'connect: timeout again' });
    await upsertErrorDaily(db(), 'Tokyo · North', day + 86400, {
      auth_reject: 4,
    });

    const trend = await readErrorTrend(db(), 'Tokyo · North', 7, day + 86400);
    expect(trend.totals.dial_timeout).toBe(5);
    expect(trend.totals.auth_reject).toBe(4);
    expect(trend.byDay).toHaveLength(2);
    expect(trend.byDay[0].counts.dial_timeout).toBe(5);
    expect(trend.byDay[0].samples.dial_timeout).toBe('connect: timeout again');
  });
});

describe('agent net counters', () => {
  it('reads net_in_last / net_out_last from operations_agent_rollups', async () => {
    const bucket = 1_800_000_000;
    await db().prepare(
      `INSERT INTO operations_agent_rollups(
         node_name, resolution_seconds, bucket_at, samples,
         rollup_writer_version, sample_counts_exact,
         net_in_last, net_out_last
       ) VALUES('Tokyo · North', 300, ?, 1, 2, 1, 111, 222)`,
    ).bind(bucket).run();
    expect(await readAgentNetCounters(db(), 'Tokyo · North')).toEqual({
      in: 111, out: 222, at: bucket,
    });
  });
});
