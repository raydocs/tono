// Client-version adoption: what the fleet is actually running.
//
// Adoption is a question about *devices*, not about device-days. The daily
// rollup in `ops_client_version_daily` answers "how many devices reported
// 0.0.34 on the 8th"; summing it over a range turns one device seen on thirty
// days into thirty devices. `ops_client_version_device_daily` keeps one row per
// (UTC day, device) with the version that device last reported that day, so a
// range can take the newest row per device and count each device once.

import { ApiError } from '../errors';
import { ADOPTION_BUCKETS, PLATFORMS, type AdoptionBucket, type Platform, type RangeKey } from './contract';
import { readCronState, writeCronState } from './cron-state';
import { isPlatform, sniffPlatform } from './platform';

const DAY = 86400;
const UPSERT_CHUNK = 50;
const BACKFILL_KEY = 'adoption_device_backfill';
const BACKFILL_CURSOR_KEY = 'adoption_device_backfill_cursor';
const BACKFILL_DAYS = 30;
const BACKFILL_CHUNK = 5;

export type VersionBucket = AdoptionBucket;

export type AdoptionCell = {
  platform: Platform;
  bucket: VersionBucket;
  users: number;
  devices: number;
};

export type AdoptionMatrix = {
  cells: AdoptionCell[];
  released: Platform[];
  latest: Record<Platform, string | null>;
};

type Row = Record<string, any>;

type DeviceRow = {
  platform: Platform;
  deviceId: string;
  userId: string;
  version: string;
  seenAt: number;
};

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export function utcDay(unix: number): number {
  return Math.floor(unix / DAY) * DAY;
}

function rangeDays(range: RangeKey | undefined): number {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  if (range === '90d') return 90;
  return 1;
}

function parseVersion(value: string): { core: number[]; pre: string | null } {
  const noBuild = value.split('+')[0] ?? '';
  const dash = noBuild.indexOf('-');
  const core = dash === -1 ? noBuild : noBuild.slice(0, dash);
  const pre = dash === -1 ? null : noBuild.slice(dash + 1);
  const segments = core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return { core: segments.length === 0 ? [0] : segments, pre };
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < length; i++) {
    const da = left.core[i] ?? 0;
    const db = right.core[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  if (left.pre < right.pre) return -1;
  if (left.pre > right.pre) return 1;
  return 0;
}

export function versionBucket(observed: string, latest: readonly string[]): VersionBucket {
  if (typeof observed !== 'string' || observed.length === 0 || latest.length === 0) {
    return 'unreported';
  }
  const published = [...new Set(latest.filter((value) => typeof value === 'string' && value.length > 0))];
  if (published.length === 0) return 'unreported';
  published.sort((a, b) => compareVersions(b, a));
  const index = published.findIndex((value) => compareVersions(value, observed) === 0);
  if (index === 0) return 'current';
  if (index === 1) return 'behind_one';
  if (index >= 2) return 'behind_more';
  return 'unreported';
}

async function runChunks(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += UPSERT_CHUNK) {
    await db.batch(statements.slice(i, i + UPSERT_CHUNK));
  }
}

function rowPlatform(row: Row): Platform | null {
  const named = row.platform;
  if (typeof named === 'string' && isPlatform(named)) return named;
  return sniffPlatform(String(row.os_version ?? ''));
}

async function windowsForDay(db: D1Database, day: number): Promise<Row[]> {
  const windows = await db.prepare(
    `SELECT os_version, client_version, device_id, user_id, received_at,
            json_extract(payload_json, '$.platform') AS platform
     FROM telemetry_windows
     WHERE received_at >= ? AND received_at < ?`,
  ).bind(day, day + DAY).all<Row>();
  return windows.results ?? [];
}

/** The version each device last reported, one row per device. */
function deviceRowsFrom(rows: readonly Row[]): DeviceRow[] {
  const best = new Map<string, DeviceRow>();
  for (const row of rows) {
    const platform = rowPlatform(row);
    if (!platform) continue;
    const version = String(row.client_version ?? '');
    const deviceId = row.device_id ? String(row.device_id) : '';
    const userId = row.user_id ? String(row.user_id) : '';
    if (!version || !deviceId || !userId) continue;
    const seenAt = Number(row.received_at ?? 0);
    const current = best.get(deviceId);
    if (!current || seenAt >= current.seenAt) {
      best.set(deviceId, { platform, deviceId, userId, version, seenAt });
    }
  }
  return [...best.values()];
}

function deviceStatement(db: D1Database, day: number, row: DeviceRow): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO ops_client_version_device_daily(
       day_at, platform, device_id, user_id, app_version, last_seen_at
     ) VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(day_at, device_id) DO UPDATE SET
       platform = excluded.platform,
       user_id = excluded.user_id,
       app_version = excluded.app_version,
       last_seen_at = excluded.last_seen_at`,
  ).bind(day, row.platform, row.deviceId, row.userId, row.version, row.seenAt);
}

/**
 * Fill `ops_client_version_device_daily` for the last 30 UTC days, ≤5 days per
 * call so one cron tick never walks a month of telemetry. The cursor is the
 * next day to write, walking backwards; the done-marker is a separate key so
 * "absent" keeps meaning "never finished".
 */
export async function backfillDeviceDaily(
  db: D1Database,
  nowSec: number,
): Promise<{ done: boolean; days: number }> {
  try {
    if (await readCronState(db, BACKFILL_KEY) != null) return { done: true, days: 0 };
    const today = utcDay(nowSec);
    const oldest = today - (BACKFILL_DAYS - 1) * DAY;
    let day = await readCronState(db, BACKFILL_CURSOR_KEY) ?? today;
    let days = 0;
    while (day >= oldest && days < BACKFILL_CHUNK) {
      const rows = deviceRowsFrom(await windowsForDay(db, day));
      await runChunks(db, rows.map((row) => deviceStatement(db, day, row)));
      day -= DAY;
      days += 1;
    }
    if (day < oldest) {
      await writeCronState(db, BACKFILL_KEY, nowSec);
      return { done: true, days };
    }
    await writeCronState(db, BACKFILL_CURSOR_KEY, day);
    return { done: false, days };
  } catch (error) {
    if (missingTable(error)) return { done: false, days: 0 };
    throw error;
  }
}

export async function rollupClientVersionsDaily(
  db: D1Database,
  dayAt: number,
  force = false,
): Promise<{ skipped: boolean; rows: number }> {
  const day = utcDay(dayAt);
  try {
    if (!force) {
      const existing = await db.prepare(
        'SELECT 1 AS ok FROM ops_client_version_daily WHERE day_at = ? LIMIT 1',
      ).bind(day).first();
      if (existing) {
        await backfillDeviceDaily(db, dayAt);
        return { skipped: true, rows: 0 };
      }
    } else {
      await db.prepare('DELETE FROM ops_client_version_daily WHERE day_at = ?').bind(day).run();
      await db.prepare('DELETE FROM ops_client_version_device_daily WHERE day_at = ?').bind(day).run();
    }
    const rows = await windowsForDay(db, day);
    const groups = new Map<string, { platform: Platform; version: string; devices: Set<string>; users: Set<string> }>();
    for (const row of rows) {
      const platform = rowPlatform(row);
      if (!platform) continue;
      const version = String(row.client_version ?? '');
      if (!version) continue;
      const key = `${platform}\0${version}`;
      let group = groups.get(key);
      if (!group) {
        group = { platform, version, devices: new Set(), users: new Set() };
        groups.set(key, group);
      }
      if (row.device_id) group.devices.add(String(row.device_id));
      if (row.user_id) group.users.add(String(row.user_id));
    }
    const statements = [...groups.values()].map((group) => db.prepare(
      `INSERT INTO ops_client_version_daily(day_at, platform, app_version, devices, users)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(day_at, platform, app_version) DO UPDATE SET
         devices = excluded.devices,
         users = excluded.users`,
    ).bind(day, group.platform, group.version, group.devices.size, group.users.size));
    const written = statements.length;
    for (const device of deviceRowsFrom(rows)) statements.push(deviceStatement(db, day, device));
    await runChunks(db, statements);
    await backfillDeviceDaily(db, dayAt);
    return { skipped: false, rows: written };
  } catch (error) {
    if (missingTable(error)) return { skipped: true, rows: 0 };
    throw error;
  }
}

async function publishedStableVersions(db: D1Database, platform: Platform): Promise<string[]> {
  const rows = await db.prepare(
    `SELECT version FROM client_releases
     WHERE platform = ? AND channel = 'stable'
       AND published_at IS NOT NULL AND yanked_at IS NULL`,
  ).bind(platform).all<{ version: string }>();
  return (rows.results ?? []).map((row) => String(row.version));
}

async function latestStableVersion(db: D1Database, platform: Platform): Promise<string | null> {
  const row = await db.prepare(
    `SELECT version FROM client_releases
     WHERE platform = ? AND channel = 'stable'
       AND published_at IS NOT NULL AND yanked_at IS NULL
     ORDER BY published_at DESC
     LIMIT 1`,
  ).bind(platform).first<{ version: string }>();
  return row ? String(row.version) : null;
}

async function devicesInRange(
  db: D1Database,
  rangeStart: number,
  today: number,
  platform: Platform | null,
): Promise<DeviceRow[]> {
  const best = new Map<string, DeviceRow & { day: number }>();
  const keep = (row: DeviceRow & { day: number }) => {
    if (platform && row.platform !== platform) return;
    const current = best.get(row.deviceId);
    if (!current || row.day > current.day
      || (row.day === current.day && row.seenAt >= current.seenAt)) {
      best.set(row.deviceId, row);
    }
  };
  try {
    const stored = await db.prepare(
      `SELECT day_at, platform, device_id, user_id, app_version, last_seen_at
       FROM ops_client_version_device_daily
       WHERE day_at >= ?`,
    ).bind(rangeStart).all<Row>();
    for (const row of stored.results ?? []) {
      const name = String(row.platform);
      if (!isPlatform(name)) continue;
      keep({
        platform: name,
        deviceId: String(row.device_id),
        userId: String(row.user_id),
        version: String(row.app_version),
        seenAt: Number(row.last_seen_at ?? 0),
        day: Number(row.day_at),
      });
    }
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  // Today has not been rolled up yet — the daily pass writes yesterday. Union
  // the live windows so a device that upgraded this morning is not reported at
  // whatever it ran last night.
  for (const row of deviceRowsFrom(await windowsForDay(db, today))) keep({ ...row, day: today });
  return [...best.values()];
}

/**
 * Platform × version-bucket for a range, counting each device once at the last
 * version it reported inside the range. A customer with devices in two buckets
 * is counted in both cells: the cell answers "how many customers have at least
 * one device here", which is the question an upgrade nag is planned against.
 */
export async function adoptionMatrix(
  db: D1Database,
  opts: { platform?: string | null; range?: RangeKey; nowSec?: number } = {},
): Promise<AdoptionMatrix> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const only = opts.platform == null || opts.platform === '' ? null : String(opts.platform);
  if (only !== null && !isPlatform(only)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid platform');
  }
  const today = utcDay(nowSec);
  const rangeStart = today - (rangeDays(opts.range) - 1) * DAY;
  const wanted = only === null ? PLATFORMS : PLATFORMS.filter((name) => name === only);
  const latest = {} as Record<Platform, string | null>;
  const released: Platform[] = [];
  const published: Record<Platform, string[]> = {} as Record<Platform, string[]>;
  const users = new Map<string, Set<string>>();
  const devices = new Map<string, number>();
  try {
    for (const platform of PLATFORMS) {
      const any = await db.prepare(
        'SELECT 1 AS ok FROM client_releases WHERE platform = ? LIMIT 1',
      ).bind(platform).first();
      if (any) released.push(platform);
      latest[platform] = await latestStableVersion(db, platform);
      published[platform] = await publishedStableVersions(db, platform);
    }
    for (const device of await devicesInRange(db, rangeStart, today, only)) {
      const key = `${device.platform}:${versionBucket(device.version, published[device.platform] ?? [])}`;
      devices.set(key, (devices.get(key) ?? 0) + 1);
      let seen = users.get(key);
      if (!seen) {
        seen = new Set();
        users.set(key, seen);
      }
      seen.add(device.userId);
    }
  } catch (error) {
    if (!missingTable(error)) throw error;
    for (const platform of PLATFORMS) latest[platform] = null;
    released.length = 0;
    devices.clear();
    users.clear();
  }
  const cells: AdoptionCell[] = [];
  for (const platform of wanted) {
    for (const bucket of ADOPTION_BUCKETS) {
      const key = `${platform}:${bucket}`;
      cells.push({
        platform,
        bucket,
        users: users.get(key)?.size ?? 0,
        devices: devices.get(key) ?? 0,
      });
    }
  }
  return { cells, released, latest };
}

/** Prunes both adoption rollups; returns the rows deleted across the two. */
export async function retainClientVersionDaily(
  db: D1Database,
  nowSec: number,
  days = 400,
  limit = 500,
): Promise<number> {
  if (!Number.isSafeInteger(days) || days <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid days');
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 5_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid limit');
  }
  const cutoff = nowSec - days * DAY;
  let deleted = 0;
  for (const table of ['ops_client_version_daily', 'ops_client_version_device_daily']) {
    try {
      const result = await db.prepare(
        `DELETE FROM ${table} WHERE rowid IN (
           SELECT rowid FROM ${table}
           WHERE day_at < ?
           ORDER BY day_at ASC
           LIMIT ?
         )`,
      ).bind(cutoff, limit).run();
      deleted += Number(result.meta.changes ?? 0);
    } catch (error) {
      if (!missingTable(error)) throw error;
    }
  }
  return deleted;
}
