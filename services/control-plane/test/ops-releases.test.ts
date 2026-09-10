import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  adoptionMatrix,
  backfillDeviceDaily,
  compareVersions,
  createRelease,
  currentRelease,
  listReleases,
  retainClientVersionDaily,
  rollupClientVersionsDaily,
  sniffPlatform,
  updateRelease,
  utcDay,
  versionBucket,
} from '../src/ops/releases';

const db = () => (env as unknown as { DB: D1Database }).DB;
const DAY = 86400;
const NOW = 1_800_000_000;
const DAY_AT = utcDay(NOW);

async function seedUser(id: string, email: string) {
  await db().prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES (?, ?, 'x', 'y', 'active', 0, 1, 1)`,
  ).bind(id, email).run();
}

async function seedWindow(input: {
  id: string;
  userId: string;
  deviceId: string | null;
  receivedAt: number;
  version: string;
  os: string;
}) {
  await db().prepare(
    `INSERT INTO telemetry_windows(
       id, user_id, device_id, received_at, window_start_ms, window_end_ms,
       client_version, os_version, payload_json
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
  ).bind(
    input.id, input.userId, input.deviceId, input.receivedAt,
    input.receivedAt * 1000, input.receivedAt * 1000 + 60_000,
    input.version, input.os,
  ).run();
}

async function seedDeviceDay(input: {
  day: number;
  deviceId: string;
  userId: string;
  version: string;
  platform?: string;
  seenAt?: number;
}) {
  await db().prepare(
    `INSERT INTO ops_client_version_device_daily(
       day_at, platform, device_id, user_id, app_version, last_seen_at
     ) VALUES(?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.day, input.platform ?? 'windows', input.deviceId, input.userId,
    input.version, input.seenAt ?? input.day,
  ).run();
}

async function seedWindowsStable() {
  await createRelease(db(), {
    platform: 'windows', channel: 'stable', version: '0.0.34', publishedAt: NOW - 20,
  }, NOW - 20);
  await createRelease(db(), {
    platform: 'windows', channel: 'stable', version: '0.0.33', publishedAt: NOW - 40,
  }, NOW - 40);
}

function cellOf(
  matrix: Awaited<ReturnType<typeof adoptionMatrix>>,
  platform: string,
  bucket: string,
) {
  const found = matrix.cells.find((row) => row.platform === platform && row.bucket === bucket);
  return { users: found?.users ?? -1, devices: found?.devices ?? -1 };
}

describe('sniffPlatform', () => {
  it.each([
    ['Windows 11 Pro 23H2', 'windows'],
    ['macOS 15.2', 'macos'],
    ['Mac OS X 10.15.7', 'macos'],
    ['Linux 6.8.0-generic', 'linux'],
    ['Android 14', 'android'],
    ['Linux; Android 14', 'android'],
    ['iOS 18.1', 'ios'],
    ['iPadOS 18.1', 'ios'],
    ['FreeBSD 14', null],
    ['', null],
  ] as const)('%s → %s', (os, platform) => {
    expect(sniffPlatform(os)).toBe(platform);
  });
});

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.1', -1],
    ['1.0.1', '1.0.0', 1],
    ['1.0', '1.0.0', 0],
    ['1.2.3+abc', '1.2.3', 0],
    ['1.2.3+1', '1.2.3+9', 0],
    ['1.2.3-beta', '1.2.3', -1],
    ['1.2.3', '1.2.3-beta', 1],
    ['1.2.3-alpha', '1.2.3-beta', -1],
    ['2.0.0', '1.9.9', 1],
    ['0.0.34', '0.0.33', 1],
    ['10.0.0', '9.0.0', 1],
    ['0.0.10', '0.0.9', 1],
  ] as const)('%s vs %s', (a, b, sign) => {
    const got = compareVersions(a, b);
    if (sign === 0) expect(got).toBe(0);
    else expect(Math.sign(got)).toBe(sign);
  });
});

describe('versionBucket', () => {
  const published = ['0.0.34', '0.0.33', '0.0.32'];

  it.each([
    ['0.0.34', published, 'current'],
    ['0.0.33', published, 'behind_one'],
    ['0.0.32', published, 'behind_more'],
    ['0.0.31', published, 'unreported'],
    ['0.0.34-beta', published, 'unreported'],
    ['0.0.34', [], 'unreported'],
    ['0.0.34', ['0.0.32', '0.0.34', '0.0.33'], 'current'],
    ['0.0.33', ['0.0.32', '0.0.34', '0.0.33'], 'behind_one'],
  ] as const)('%s in %j → %s', (observed, latest, bucket) => {
    expect(versionBucket(observed, latest)).toBe(bucket);
  });
});

describe('client release CRUD', () => {
  it('creates, lists, publishes, yanks and enforces the unique key', async () => {
    const windows = await createRelease(db(), {
      platform: 'windows',
      channel: 'stable',
      version: '0.0.34',
      build: '34',
      notes: 'polish',
    }, NOW);
    expect(windows).toMatchObject({
      platform: 'windows', channel: 'stable', version: '0.0.34',
      build: '34', notes: 'polish', publishedAt: null, yankedAt: null,
    });
    await createRelease(db(), {
      platform: 'windows', channel: 'candidate', version: '0.0.34',
    }, NOW);
    await createRelease(db(), {
      platform: 'macos', channel: 'stable', version: '0.0.34',
    }, NOW);

    await expect(createRelease(db(), {
      platform: 'windows', channel: 'stable', version: '0.0.34',
    }, NOW + 1)).rejects.toMatchObject({
      status: 409, code: 'RELEASE_CONFLICT',
    });
    await expect(createRelease(db(), {
      platform: 'amiga', channel: 'stable', version: '1',
    }, NOW)).rejects.toBeInstanceOf(ApiError);

    const listed = await listReleases(db(), { platform: 'windows' });
    expect(listed.map((row) => `${row.channel}:${row.version}`)).toEqual([
      'candidate:0.0.34', 'stable:0.0.34',
    ]);
    expect(await currentRelease(db(), 'windows', 'stable')).toBeNull();

    const published = await updateRelease(db(), windows.id, { publish: true }, NOW + 10);
    expect(published.publishedAt).toBe(NOW + 10);
    expect(await currentRelease(db(), 'windows', 'stable')).toMatchObject({
      id: windows.id, version: '0.0.34',
    });

    const noted = await updateRelease(db(), windows.id, {
      notes: 'yank incoming',
      minSupportedVersion: '0.0.30',
    }, NOW + 20);
    expect(noted).toMatchObject({ notes: 'yank incoming', minSupportedVersion: '0.0.30' });
    expect(noted.publishedAt).toBe(NOW + 10);

    const yanked = await updateRelease(db(), windows.id, {
      yank: true, yankReason: 'bad signature',
    }, NOW + 30);
    expect(yanked.yankedAt).toBe(NOW + 30);
    expect(yanked.yankReason).toBe('bad signature');
    expect(await currentRelease(db(), 'windows', 'stable')).toBeNull();

    await expect(updateRelease(db(), 'missing', { publish: true }, NOW))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('client version daily rollup', () => {
  it('counts distinct devices and users per sniffed platform and version', async () => {
    await seedUser('u-a', 'a@example.com');
    await seedUser('u-b', 'b@example.com');
    await seedUser('u-c', 'c@example.com');
    await seedWindow({
      id: 'w1', userId: 'u-a', deviceId: 'd-a', receivedAt: DAY_AT + 10,
      version: '0.0.34', os: 'Windows 11 Pro 23H2',
    });
    await seedWindow({
      id: 'w2', userId: 'u-b', deviceId: 'd-b', receivedAt: DAY_AT + 20,
      version: '0.0.34', os: 'Windows 11 Home',
    });
    await seedWindow({
      id: 'w3', userId: 'u-b', deviceId: 'd-b2', receivedAt: DAY_AT + 30,
      version: '0.0.33', os: 'Windows 10',
    });
    await seedWindow({
      id: 'w4', userId: 'u-c', deviceId: 'd-c', receivedAt: DAY_AT + 40,
      version: '0.0.32', os: 'macOS 15.2',
    });
    await seedWindow({
      id: 'w5', userId: 'u-c', deviceId: 'd-c', receivedAt: DAY_AT + 50,
      version: '0.0.32', os: 'macOS 15.2',
    });
    await seedWindow({
      id: 'w-out', userId: 'u-a', deviceId: 'd-old', receivedAt: DAY_AT - 1,
      version: '0.0.10', os: 'Windows 11',
    });

    const first = await rollupClientVersionsDaily(db(), NOW);
    expect(first).toEqual({ skipped: false, rows: 3 });
    const rows = await db().prepare(
      `SELECT platform, app_version, devices, users
       FROM ops_client_version_daily WHERE day_at = ?
       ORDER BY platform, app_version`,
    ).bind(DAY_AT).all<{ platform: string; app_version: string; devices: number; users: number }>();
    expect(rows.results).toEqual([
      { platform: 'macos', app_version: '0.0.32', devices: 1, users: 1 },
      { platform: 'windows', app_version: '0.0.33', devices: 1, users: 1 },
      { platform: 'windows', app_version: '0.0.34', devices: 2, users: 2 },
    ]);
  });

  it('skips a day that already has rows unless force is set', async () => {
    await seedUser('u-a', 'a@example.com');
    await seedWindow({
      id: 'w1', userId: 'u-a', deviceId: 'd-a', receivedAt: DAY_AT + 10,
      version: '0.0.34', os: 'Windows 11',
    });
    await rollupClientVersionsDaily(db(), DAY_AT);
    await seedWindow({
      id: 'w2', userId: 'u-a', deviceId: 'd-b', receivedAt: DAY_AT + 20,
      version: '0.0.34', os: 'Windows 11',
    });
    expect(await rollupClientVersionsDaily(db(), DAY_AT)).toEqual({ skipped: true, rows: 0 });
    const guarded = await db().prepare(
      'SELECT devices FROM ops_client_version_daily WHERE day_at = ? AND app_version = ?',
    ).bind(DAY_AT, '0.0.34').first<{ devices: number }>();
    expect(Number(guarded?.devices)).toBe(1);

    expect(await rollupClientVersionsDaily(db(), DAY_AT, true)).toEqual({ skipped: false, rows: 1 });
    const forced = await db().prepare(
      'SELECT devices FROM ops_client_version_daily WHERE day_at = ? AND app_version = ?',
    ).bind(DAY_AT, '0.0.34').first<{ devices: number }>();
    expect(Number(forced?.devices)).toBe(2);
  });
});

describe('adoption matrix', () => {
  it('counts a device once however many days it reported inside the range', async () => {
    await seedWindowsStable();
    for (const back of [0, 1, 2]) {
      await seedDeviceDay({ day: DAY_AT - back * DAY, deviceId: 'd-a', userId: 'u-a', version: '0.0.34' });
    }
    for (const range of ['7d', '30d'] as const) {
      const matrix = await adoptionMatrix(db(), { range, nowSec: NOW });
      expect(cellOf(matrix, 'windows', 'current'), range).toEqual({ users: 1, devices: 1 });
    }
  });

  it('takes the newest version a device reported, not every version it passed through', async () => {
    await seedWindowsStable();
    await seedDeviceDay({ day: DAY_AT - 3 * DAY, deviceId: 'd-a', userId: 'u-a', version: '0.0.33' });
    await seedDeviceDay({ day: DAY_AT - DAY, deviceId: 'd-a', userId: 'u-a', version: '0.0.34' });

    const matrix = await adoptionMatrix(db(), { range: '7d', nowSec: NOW });
    expect(cellOf(matrix, 'windows', 'current')).toEqual({ users: 1, devices: 1 });
    expect(cellOf(matrix, 'windows', 'behind_one')).toEqual({ users: 0, devices: 0 });
  });

  it('excludes a device whose last report is before the range start', async () => {
    await seedWindowsStable();
    await seedDeviceDay({ day: DAY_AT - 10 * DAY, deviceId: 'd-old', userId: 'u-a', version: '0.0.34' });

    const week = await adoptionMatrix(db(), { range: '7d', nowSec: NOW });
    expect(cellOf(week, 'windows', 'current')).toEqual({ users: 0, devices: 0 });
    const month = await adoptionMatrix(db(), { range: '30d', nowSec: NOW });
    expect(cellOf(month, 'windows', 'current')).toEqual({ users: 1, devices: 1 });
  });

  it('counts a customer once per cell and in every bucket a device of theirs lands in', async () => {
    await seedWindowsStable();
    await seedDeviceDay({ day: DAY_AT - DAY, deviceId: 'd-1', userId: 'u-a', version: '0.0.34' });
    await seedDeviceDay({ day: DAY_AT - DAY, deviceId: 'd-2', userId: 'u-a', version: '0.0.34' });
    await seedDeviceDay({ day: DAY_AT - DAY, deviceId: 'd-3', userId: 'u-a', version: '0.0.33' });

    const matrix = await adoptionMatrix(db(), { range: '30d', nowSec: NOW });
    expect(cellOf(matrix, 'windows', 'current')).toEqual({ users: 1, devices: 2 });
    expect(cellOf(matrix, 'windows', 'behind_one')).toEqual({ users: 1, devices: 1 });
  });

  it("unions today's live windows, which no rollup has written yet", async () => {
    await seedWindowsStable();
    await seedUser('u-a', 'a@example.com');
    await seedDeviceDay({ day: DAY_AT - DAY, deviceId: 'd-live', userId: 'u-a', version: '0.0.33' });
    await seedWindow({
      id: 'w-live', userId: 'u-a', deviceId: 'd-live', receivedAt: DAY_AT + 10,
      version: '0.0.34', os: 'Windows 11 Pro 23H2',
    });

    const today = await adoptionMatrix(db(), { range: '24h', nowSec: NOW });
    expect(cellOf(today, 'windows', 'current')).toEqual({ users: 1, devices: 1 });
    expect(cellOf(today, 'windows', 'behind_one')).toEqual({ users: 0, devices: 0 });
    // Yesterday's row is outside 24h and must not resurrect the old version.
    const week = await adoptionMatrix(db(), { range: '7d', nowSec: NOW });
    expect(cellOf(week, 'windows', 'current')).toEqual({ users: 1, devices: 1 });
    expect(cellOf(week, 'windows', 'behind_one')).toEqual({ users: 0, devices: 0 });
  });

  it('reports released platforms, buckets unknown versions, and filters by platform', async () => {
    await seedWindowsStable();
    await seedDeviceDay({ day: DAY_AT - DAY, deviceId: 'd-a', userId: 'u-a', version: '0.0.31' });
    await seedDeviceDay({
      day: DAY_AT - DAY, deviceId: 'd-m', userId: 'u-b', version: '0.0.67', platform: 'macos',
    });

    const matrix = await adoptionMatrix(db(), { range: '30d', nowSec: NOW });
    expect(matrix.released).toEqual(['windows']);
    expect(matrix.latest.windows).toBe('0.0.34');
    expect(matrix.latest.macos).toBeNull();
    expect(cellOf(matrix, 'windows', 'unreported')).toEqual({ users: 1, devices: 1 });
    expect(cellOf(matrix, 'macos', 'unreported')).toEqual({ users: 1, devices: 1 });
    expect(matrix.cells).toHaveLength(20);

    const only = await adoptionMatrix(db(), { platform: 'windows', range: '30d', nowSec: NOW });
    expect(new Set(only.cells.map((row) => row.platform))).toEqual(new Set(['windows']));
    expect(only.cells).toHaveLength(4);
    await expect(adoptionMatrix(db(), { platform: 'amiga', range: '30d', nowSec: NOW }))
      .rejects.toBeInstanceOf(ApiError);
  });
});

describe('client version device daily', () => {
  it('writes one row per device at the version it last reported, and a re-run replaces it', async () => {
    await seedUser('u-a', 'a@example.com');
    await seedWindow({
      id: 'w1', userId: 'u-a', deviceId: 'd-a', receivedAt: DAY_AT + 10,
      version: '0.0.33', os: 'Windows 11 Pro 23H2',
    });
    await seedWindow({
      id: 'w2', userId: 'u-a', deviceId: 'd-a', receivedAt: DAY_AT + 20,
      version: '0.0.34', os: 'Windows 11 Pro 23H2',
    });

    await rollupClientVersionsDaily(db(), NOW);
    const first = await db().prepare(
      `SELECT platform, device_id, user_id, app_version, last_seen_at
       FROM ops_client_version_device_daily WHERE day_at = ?`,
    ).bind(DAY_AT).all<Record<string, unknown>>();
    expect(first.results).toEqual([{
      platform: 'windows', device_id: 'd-a', user_id: 'u-a',
      app_version: '0.0.34', last_seen_at: DAY_AT + 20,
    }]);

    await seedWindow({
      id: 'w3', userId: 'u-a', deviceId: 'd-a', receivedAt: DAY_AT + 30,
      version: '0.0.35', os: 'Windows 11 Pro 23H2',
    });
    await rollupClientVersionsDaily(db(), NOW, true);
    const again = await db().prepare(
      'SELECT app_version, COUNT(*) AS c FROM ops_client_version_device_daily WHERE day_at = ?',
    ).bind(DAY_AT).first<{ app_version: string; c: number }>();
    expect(again?.app_version).toBe('0.0.35');
    expect(Number(again?.c)).toBe(1);
  });

  it('backfills thirty days in chunks, once, then stays done', async () => {
    await seedUser('u-a', 'a@example.com');
    await seedWindow({
      id: 'w-near', userId: 'u-a', deviceId: 'd-a', receivedAt: DAY_AT - 3 * DAY + 10,
      version: '0.0.34', os: 'Windows 11',
    });
    await seedWindow({
      id: 'w-far', userId: 'u-a', deviceId: 'd-b', receivedAt: DAY_AT - 20 * DAY + 10,
      version: '0.0.33', os: 'Windows 11',
    });
    await seedWindow({
      id: 'w-past', userId: 'u-a', deviceId: 'd-c', receivedAt: DAY_AT - 40 * DAY + 10,
      version: '0.0.30', os: 'Windows 11',
    });

    const first = await backfillDeviceDaily(db(), NOW);
    expect(first).toEqual({ done: false, days: 5 });
    let calls = 1;
    let done = first.done;
    while (!done && calls < 20) {
      done = (await backfillDeviceDaily(db(), NOW)).done;
      calls += 1;
    }
    expect(calls).toBe(6);

    const rows = await db().prepare(
      'SELECT day_at, device_id FROM ops_client_version_device_daily ORDER BY day_at DESC',
    ).all<{ day_at: number; device_id: string }>();
    expect(rows.results).toEqual([
      { day_at: DAY_AT - 3 * DAY, device_id: 'd-a' },
      { day_at: DAY_AT - 20 * DAY, device_id: 'd-b' },
    ]);

    // Idempotent: the marker is set, so nothing is walked again.
    expect(await backfillDeviceDaily(db(), NOW)).toEqual({ done: true, days: 0 });
    const after = await db().prepare(
      'SELECT COUNT(*) AS c FROM ops_client_version_device_daily',
    ).first<{ c: number }>();
    expect(Number(after?.c)).toBe(2);
  });
});

describe('client version daily retention', () => {
  it('deletes aged rows oldest-first up to the limit', async () => {
    const recent = DAY_AT;
    await db().prepare(
      `INSERT INTO ops_client_version_daily(day_at, platform, app_version, devices, users)
       VALUES
         (?, 'windows', 'a', 1, 1),
         (?, 'windows', 'b', 1, 1),
         (?, 'windows', 'c', 1, 1),
         (?, 'windows', 'keep', 1, 1)`,
    ).bind(recent - 3 * DAY, recent - 2 * DAY, recent - DAY, recent).run();

    const first = await retainClientVersionDaily(db(), recent + 10, 1, 2);
    expect(first).toBe(2);
    const leftover = await db().prepare(
      'SELECT app_version FROM ops_client_version_daily ORDER BY day_at, app_version',
    ).all<{ app_version: string }>();
    expect(leftover.results.map((row) => row.app_version)).toEqual(['c', 'keep']);

    const second = await retainClientVersionDaily(db(), recent + 10, 1, 500);
    expect(second).toBe(1);
    const kept = await db().prepare(
      'SELECT app_version FROM ops_client_version_daily',
    ).all<{ app_version: string }>();
    expect(kept.results.map((row) => row.app_version)).toEqual(['keep']);
  });

  it('prunes the per-device table on the same cutoff', async () => {
    await seedDeviceDay({ day: DAY_AT - 3 * DAY, deviceId: 'd-old', userId: 'u-a', version: '0.0.30' });
    await seedDeviceDay({ day: DAY_AT, deviceId: 'd-new', userId: 'u-a', version: '0.0.34' });

    expect(await retainClientVersionDaily(db(), DAY_AT + 10, 1, 500)).toBe(1);
    const left = await db().prepare(
      'SELECT device_id FROM ops_client_version_device_daily',
    ).all<{ device_id: string }>();
    expect(left.results.map((row) => row.device_id)).toEqual(['d-new']);
  });
});
