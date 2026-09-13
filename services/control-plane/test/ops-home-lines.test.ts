import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  attributeClientRouteBytes,
  homeLineChores,
  homeLineSummary,
  patchHomeLine,
  recordHomeLineUsage,
  retainHomeLineUsage,
  type HomeLinePatch,
} from '../src/ops/home-lines';

const db = () => (env as unknown as { DB: D1Database }).DB;
const NOW = 1_800_000_000;
const DAY = 86_400;
const CYCLE_START = NOW - 10 * DAY;
const CYCLE_END = NOW + 20 * DAY;

async function seedHome(id: string, status = 'active') {
  await db().prepare(
    `INSERT INTO home_exits(id, proxy_name, display_name, status, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).bind(id, `proxy-${id}`, `Home ${id}`, status, NOW, NOW).run();
}

async function seedUser(id: string) {
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, created_at, updated_at)
     VALUES(?, ?, 'x', 'y', 'active', ?, ?)`,
  ).bind(id, `${id}@example.com`, NOW, NOW).run();
}

async function seedBinding(userId: string, homeExitId: string) {
  await db().prepare(
    `INSERT INTO user_home_bindings(user_id, home_exit_id, created_at, updated_at)
     VALUES(?, ?, ?, ?)`,
  ).bind(userId, homeExitId, NOW, NOW).run();
}

async function usageRow(homeExitId: string, dayAt: number, source: string) {
  return db().prepare(
    `SELECT bytes_up, bytes_down, users FROM home_line_usage_daily
     WHERE home_exit_id = ? AND day_at = ? AND source = ?`,
  ).bind(homeExitId, dayAt, source).first<{ bytes_up: number; bytes_down: number; users: number }>();
}

async function expectRejected(run: () => Promise<unknown>, status = 400, code = 'VALIDATION_ERROR') {
  await expect(run()).rejects.toMatchObject({ status, code });
}

describe('patchHomeLine', () => {
  it('writes commercial fields and rejects the validation matrix', async () => {
    await seedHome('h1');
    const monthly = await patchHomeLine(db(), 'h1', {
      providerAccountId: 'acct-1',
      isp: 'CMCC',
      region: '沪',
      price: 99.5,
      currency: 'cny',
      billingKind: 'monthly',
      meterSource: 'manual',
      expiresAt: NOW + 30 * DAY,
    }, NOW);
    expect(monthly).toMatchObject({
      id: 'h1',
      providerAccountId: 'acct-1',
      isp: 'CMCC',
      region: '沪',
      price: 99.5,
      currency: 'CNY',
      billingKind: 'monthly',
      meterSource: 'manual',
      expiresAt: NOW + 30 * DAY,
      updatedAt: NOW,
    });

    await seedHome('h-gb');
    await expect(patchHomeLine(db(), 'h-gb', { billingKind: 'per_gb', price: 0 }, NOW))
      .resolves.toMatchObject({ billingKind: 'per_gb', price: 0 });

    await seedHome('h-bundle');
    const bundle = await patchHomeLine(db(), 'h-bundle', {
      billingKind: 'bundle',
      bundleBytes: 1000,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      price: 80,
      currency: 'USD',
    }, NOW);
    expect(bundle).toMatchObject({
      billingKind: 'bundle',
      bundleBytes: 1000,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
    });
    const merged = await patchHomeLine(db(), 'h-bundle', { isp: 'CU' }, NOW + 1);
    expect(merged).toMatchObject({
      isp: 'CU',
      billingKind: 'bundle',
      bundleBytes: 1000,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
    });

    await seedHome('h-blank');
    const cases: Array<[HomeLinePatch, string]> = [
      [{ price: -1 }, 'h1'],
      [{ currency: 'US' }, 'h1'],
      [{ currency: 'USDT' }, 'h1'],
      [{ currency: '12$' }, 'h1'],
      [{ billingKind: 'weekly' as HomeLinePatch['billingKind'] }, 'h1'],
      [{ billingKind: 'bundle' }, 'h-blank'],
      [{ billingKind: 'bundle', bundleBytes: 100 }, 'h-blank'],
      [{ billingKind: 'bundle', bundleBytes: 100, cycleStart: NOW }, 'h-blank'],
      [{ billingKind: 'bundle', bundleBytes: 100, cycleStart: NOW + 10, cycleEnd: NOW }, 'h-blank'],
      [{ billingKind: 'per_gb' }, 'h-blank'],
      [{ meterSource: 'snmp' as HomeLinePatch['meterSource'] }, 'h1'],
      [{ bundleBytes: -5 }, 'h1'],
      [{ expiresAt: 0 }, 'h1'],
      [{ cycleStart: 10, cycleEnd: 10 }, 'h1'],
      [{ unexpected: 1 } as HomeLinePatch, 'h1'],
    ];
    for (const [patch, id] of cases) {
      await expectRejected(() => patchHomeLine(db(), id, patch, NOW));
    }
    await expectRejected(() => patchHomeLine(db(), 'missing', { isp: 'x' }, NOW), 404, 'NOT_FOUND');
  });
});

describe('recordHomeLineUsage', () => {
  it('accumulates client_route/node_stats and replaces manual/provider_api', async () => {
    await seedHome('h1');
    const dayAt = NOW;
    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt, source: 'client_route', bytesUp: 10, bytesDown: 20, users: 1,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt: dayAt + 100, source: 'client_route', bytesUp: 5, bytesDown: 7, users: 1,
    }, NOW + 1);
    expect(await usageRow('h1', dayFloor(dayAt), 'client_route')).toEqual({
      bytes_up: 15, bytes_down: 27, users: 2,
    });

    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt, source: 'node_stats', bytesUp: 40, bytesDown: 60, users: 1,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt, source: 'node_stats', bytesUp: 4, bytesDown: 6, users: 1,
    }, NOW + 1);
    expect(await usageRow('h1', dayFloor(dayAt), 'node_stats')).toEqual({
      bytes_up: 44, bytes_down: 66, users: 2,
    });

    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt, source: 'manual', bytesUp: 100, bytesDown: 200, users: 3,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt, source: 'manual', bytesUp: 8, bytesDown: 9, users: 1,
    }, NOW + 1);
    expect(await usageRow('h1', dayFloor(dayAt), 'manual')).toEqual({
      bytes_up: 8, bytes_down: 9, users: 1,
    });

    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt, source: 'provider_api', bytesUp: 50, bytesDown: 50, users: 1,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt, source: 'provider_api', bytesUp: 1, bytesDown: 2, users: 9,
    }, NOW + 1);
    expect(await usageRow('h1', dayFloor(dayAt), 'provider_api')).toEqual({
      bytes_up: 1, bytes_down: 2, users: 9,
    });
  });
});

describe('attributeClientRouteBytes', () => {
  it('records residential bytes on the bound home and no-ops without a binding', async () => {
    await seedHome('h1');
    await seedHome('h2');
    await seedUser('u1');
    await seedUser('u2');
    await seedBinding('u1', 'h1');
    const dayAt = NOW;
    const attributed = await attributeClientRouteBytes(db(), {
      userId: 'u1', dayAt, residentialBytesUp: 11, residentialBytesDown: 22,
    }, NOW);
    expect(attributed).toEqual({ homeExitId: 'h1' });
    expect(await usageRow('h1', dayFloor(dayAt), 'client_route')).toEqual({
      bytes_up: 11, bytes_down: 22, users: 1,
    });
    expect(await usageRow('h2', dayFloor(dayAt), 'client_route')).toBeNull();

    await attributeClientRouteBytes(db(), {
      userId: 'u1', dayAt, residentialBytesUp: 4, residentialBytesDown: 5,
    }, NOW + 1);
    expect(await usageRow('h1', dayFloor(dayAt), 'client_route')).toEqual({
      bytes_up: 15, bytes_down: 27, users: 2,
    });

    expect(await attributeClientRouteBytes(db(), {
      userId: 'u2', dayAt, residentialBytesUp: 9, residentialBytesDown: 9,
    }, NOW)).toBeNull();
    expect(await usageRow('h1', dayFloor(dayAt), 'client_route')).toEqual({
      bytes_up: 15, bytes_down: 27, users: 2,
    });
  });
});

describe('homeLineSummary', () => {
  it('computes cycle usage, mismatch, remainingPct and level', async () => {
    await seedHome('h1');
    await patchHomeLine(db(), 'h1', {
      billingKind: 'bundle',
      bundleBytes: 1000,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      expiresAt: NOW + 30 * DAY,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt: NOW, source: 'client_route', bytesUp: 100, bytesDown: 100, users: 1,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt: NOW, source: 'node_stats', bytesUp: 100, bytesDown: 105, users: 1,
    }, NOW);
    const close = await homeLineSummary(db(), 'h1', NOW);
    expect(close.usedThisCycle).toEqual({
      client_route: 200, node_stats: 205, provider_api: 0, manual: 0,
    });
    expect(close.reconciliation.mismatch).toBe(false);
    expect(close.remainingPct).toBeCloseTo(79.5, 5);
    expect(close.level).toBe('ok');
    expect(close.daysToExpiry).toBe(30);

    await recordHomeLineUsage(db(), {
      homeExitId: 'h1', dayAt: NOW, source: 'node_stats', bytesUp: 200, bytesDown: 0, users: 0,
    }, NOW);
    const mismatched = await homeLineSummary(db(), 'h1', NOW);
    expect(mismatched.usedThisCycle.node_stats).toBe(405);
    expect(mismatched.reconciliation.clientRoute).toBe(200);
    expect(mismatched.reconciliation.nodeStats).toBe(405);
    expect(mismatched.reconciliation.deltaPct).toBeCloseTo((205 / 405) * 100, 5);
    expect(mismatched.reconciliation.mismatch).toBe(true);

    await seedHome('h-70');
    await patchHomeLine(db(), 'h-70', {
      billingKind: 'bundle', bundleBytes: 1000, cycleStart: CYCLE_START, cycleEnd: CYCLE_END,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h-70', dayAt: NOW, source: 'manual', bytesUp: 700, bytesDown: 0, users: 1,
    }, NOW);
    expect((await homeLineSummary(db(), 'h-70', NOW)).level).toBe('chore');
    expect((await homeLineSummary(db(), 'h-70', NOW)).remainingPct).toBe(30);

    await seedHome('h-90');
    await patchHomeLine(db(), 'h-90', {
      billingKind: 'bundle', bundleBytes: 1000, cycleStart: CYCLE_START, cycleEnd: CYCLE_END,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h-90', dayAt: NOW, source: 'manual', bytesUp: 900, bytesDown: 0, users: 1,
    }, NOW);
    expect((await homeLineSummary(db(), 'h-90', NOW)).level).toBe('warn');

    await seedHome('h-100');
    await patchHomeLine(db(), 'h-100', {
      billingKind: 'bundle', bundleBytes: 1000, cycleStart: CYCLE_START, cycleEnd: CYCLE_END,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h-100', dayAt: NOW, source: 'manual', bytesUp: 1000, bytesDown: 0, users: 1,
    }, NOW);
    expect((await homeLineSummary(db(), 'h-100', NOW)).level).toBe('severe');
    expect((await homeLineSummary(db(), 'h-100', NOW)).remainingPct).toBe(0);

    await seedHome('h-exp');
    await patchHomeLine(db(), 'h-exp', { expiresAt: NOW + 7 * DAY }, NOW);
    expect((await homeLineSummary(db(), 'h-exp', NOW)).level).toBe('chore');
    expect((await homeLineSummary(db(), 'h-exp', NOW)).daysToExpiry).toBe(7);
    await patchHomeLine(db(), 'h-exp', { expiresAt: NOW + 3 * DAY }, NOW);
    expect((await homeLineSummary(db(), 'h-exp', NOW)).level).toBe('warn');
    await patchHomeLine(db(), 'h-exp', { expiresAt: NOW - 1 }, NOW);
    expect((await homeLineSummary(db(), 'h-exp', NOW)).level).toBe('severe');
    expect((await homeLineSummary(db(), 'h-exp', NOW)).daysToExpiry).toBe(0);

    await seedHome('h-both');
    await patchHomeLine(db(), 'h-both', {
      billingKind: 'bundle',
      bundleBytes: 1000,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      expiresAt: NOW + 7 * DAY,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h-both', dayAt: NOW, source: 'manual', bytesUp: 1000, bytesDown: 0, users: 1,
    }, NOW);
    expect((await homeLineSummary(db(), 'h-both', NOW)).level).toBe('severe');
  });
});

describe('homeLineChores', () => {
  it('emits expiring, bundle_low, meter_mismatch and probe_failing', async () => {
    await seedHome('h-exp');
    await patchHomeLine(db(), 'h-exp', { expiresAt: NOW + 2 * DAY }, NOW);

    await seedHome('h-bundle');
    await patchHomeLine(db(), 'h-bundle', {
      billingKind: 'bundle', bundleBytes: 100, cycleStart: CYCLE_START, cycleEnd: CYCLE_END,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h-bundle', dayAt: NOW, source: 'manual', bytesUp: 80, bytesDown: 0, users: 1,
    }, NOW);

    await seedHome('h-mis');
    await patchHomeLine(db(), 'h-mis', {
      billingKind: 'monthly', cycleStart: CYCLE_START, cycleEnd: CYCLE_END,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h-mis', dayAt: NOW, source: 'client_route', bytesUp: 10, bytesDown: 0, users: 1,
    }, NOW);
    await recordHomeLineUsage(db(), {
      homeExitId: 'h-mis', dayAt: NOW, source: 'node_stats', bytesUp: 50, bytesDown: 0, users: 1,
    }, NOW);

    await seedHome('h-probe');
    await seedHome('h-alive');
    await seedHome('h-short');
    await db().batch([
      db().prepare(
        `INSERT INTO operations_home_probe_samples(home_exit_id, probed_at, status)
         VALUES('h-probe', ?, 'dead'), ('h-probe', ?, 'dead'), ('h-probe', ?, 'dead')`,
      ).bind(NOW - 3, NOW - 2, NOW - 1),
      db().prepare(
        `INSERT INTO operations_home_probe_samples(home_exit_id, probed_at, status)
         VALUES('h-alive', ?, 'dead'), ('h-alive', ?, 'dead'), ('h-alive', ?, 'alive')`,
      ).bind(NOW - 3, NOW - 2, NOW - 1),
      db().prepare(
        `INSERT INTO operations_home_probe_samples(home_exit_id, probed_at, status)
         VALUES('h-short', ?, 'dead'), ('h-short', ?, 'dead')`,
      ).bind(NOW - 2, NOW - 1),
    ]);

    const chores = await homeLineChores(db(), NOW);
    expect(chores.filter((c) => c.kind === 'expiring').map((c) => c.homeExitId)).toEqual(['h-exp']);
    expect(chores.filter((c) => c.kind === 'bundle_low').map((c) => c.homeExitId)).toEqual(['h-bundle']);
    expect(chores.filter((c) => c.kind === 'meter_mismatch').map((c) => c.homeExitId)).toEqual(['h-mis']);
    expect(chores.filter((c) => c.kind === 'probe_failing').map((c) => c.homeExitId)).toEqual(['h-probe']);
    expect(chores.find((c) => c.homeExitId === 'h-probe' && c.kind === 'probe_failing')?.detail)
      .toBe('last 3 probes dead');
  });
});

describe('retainHomeLineUsage', () => {
  it('deletes rows older than the window, capped by limit', async () => {
    await seedHome('h1');
    const keep = NOW - 10 * DAY;
    const drop = NOW - 401 * DAY;
    const drop2 = NOW - 402 * DAY;
    const drop3 = NOW - 403 * DAY;
    for (const [dayAt, source] of [
      [keep, 'manual'],
      [drop, 'manual'],
      [drop2, 'manual'],
      [drop3, 'client_route'],
    ] as const) {
      await recordHomeLineUsage(db(), {
        homeExitId: 'h1', dayAt, source, bytesUp: 1, bytesDown: 1, users: 1,
      }, NOW);
    }
    expect(await retainHomeLineUsage(db(), NOW, 400, 2)).toBe(2);
    const remaining = await db().prepare(
      'SELECT day_at FROM home_line_usage_daily ORDER BY day_at ASC',
    ).all<{ day_at: number }>();
    expect(remaining.results.map((row) => Number(row.day_at))).toEqual([
      dayFloor(drop),
      dayFloor(keep),
    ]);
    expect(await retainHomeLineUsage(db(), NOW, 400, 500)).toBe(1);
    const kept = await db().prepare(
      'SELECT day_at FROM home_line_usage_daily',
    ).all<{ day_at: number }>();
    expect(kept.results.map((row) => Number(row.day_at))).toEqual([dayFloor(keep)]);
  });
});

function dayFloor(unix: number): number {
  return Math.floor(unix / DAY) * DAY;
}
