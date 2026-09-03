import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hourFloor, queryUserUsageHours, snapshotUserUsageHours, usageHourDeltas } from '../src/ops-usage-hours';

const db = () => (env as unknown as { DB: D1Database }).DB;

describe('customer usage hour deltas', () => {
  it('refuses to invent a first-hour reading or a cycle reset', () => {
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
      { t: hour + 14_400, bytes: null },
    ]);
  });
});

describe('customer usage hour snapshots', () => {
  it('overwrites the open hour and only deltas closed adjacent hours', async () => {
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

    const open = await db().prepare(
      'SELECT usage_bytes FROM operations_user_usage_hours WHERE user_id = ? AND hour_at = ?',
    ).bind('u-hour', hour).first<{ usage_bytes: number }>();
    expect(Number(open?.usage_bytes)).toBe(180);

    const queried = await queryUserUsageHours(db(), hour + 3600 + 30, 24);
    const user = queried.users.find((row) => row.userId === 'u-hour');
    expect(user?.points).toEqual([
      { t: hour, bytes: null },
    ]);
    expect(queried.fleet).toEqual([{ t: hour, bytes: null }]);
  });
});
