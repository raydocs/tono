import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hourFloor, queryUserUsageHours, snapshotUserUsageHours, usageHourDeltas } from '../src/ops-usage-hours';

const db = () => (env as unknown as { DB: D1Database }).DB;

describe('customer usage hour deltas', () => {
  it('refuses to invent a first reading or a cycle reset across sparse changes', () => {
    const hour = 1_800_000_000;
    expect(usageHourDeltas([
      { hourAt: hour, usageBytes: 100 },
      { hourAt: hour + 3600, usageBytes: 140 },
      { hourAt: hour + 7200, usageBytes: 20 },
      { hourAt: hour + 14_400, usageBytes: 50 },
    ])).toEqual([
      { t: hour, bytes: null },
      { t: hour + 3600, bytes: 40 },
      { t: hour + 7200, bytes: null },
      { t: hour + 14_400, bytes: 30 },
    ]);
  });
});

describe('customer usage hour snapshots', () => {
  it('writes only changed counters and reconstructs unchanged hours as zero', async () => {
    const hour = hourFloor(1_800_003_600);
    await db().prepare(
      `INSERT INTO users (id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
       VALUES ('u-hour', 'hour@example.com', 'x', 'y', 'active', 100, 1, 1)`,
    ).run();
    await snapshotUserUsageHours(db(), hour + 60);
    await db().prepare('UPDATE users SET usage_bytes = 180 WHERE id = ?').bind('u-hour').run();
    await snapshotUserUsageHours(db(), hour + 120);
    await db().prepare('UPDATE users SET usage_bytes = 220 WHERE id = ?').bind('u-hour').run();
    await snapshotUserUsageHours(db(), hour + 3600 + 30);
    await snapshotUserUsageHours(db(), hour + 7200 + 30);

    const open = await db().prepare(
      'SELECT usage_bytes FROM operations_user_usage_hours WHERE user_id = ? AND hour_at = ?',
    ).bind('u-hour', hour).first<{ usage_bytes: number }>();
    // The five-minute cron may call this twelve times in an hour. The first
    // sample in an hour is immutable and later calls must be no-ops.
    expect(Number(open?.usage_bytes)).toBe(100);
    expect(await db().prepare(
      "SELECT COUNT(*) AS count FROM operations_user_usage_hours WHERE user_id = 'u-hour'",
    ).first()).toMatchObject({ count: 2 });

    const queried = await queryUserUsageHours(db(), hour + 10_800 + 30, 24);
    const user = queried.users.find((row) => row.userId === 'u-hour');
    expect(user?.points).toEqual([
      { t: hour, bytes: null },
      { t: hour + 3600, bytes: 120 },
      { t: hour + 7200, bytes: 0 },
    ]);
    expect(queried.fleet).toEqual([
      { t: hour, bytes: null },
      { t: hour + 3600, bytes: 120 },
      { t: hour + 7200, bytes: 0 },
    ]);
  });
});
