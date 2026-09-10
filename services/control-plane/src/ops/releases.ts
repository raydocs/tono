import { ApiError } from '../errors';
import { sniffPlatform } from './platform';
export { sniffPlatform };

const DAY = 86400;
const PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'] as const;
const CHANNELS = ['stable', 'candidate', 'internal'] as const;

export type Platform = (typeof PLATFORMS)[number];
export type Channel = (typeof CHANNELS)[number];
export type VersionBucket = 'current' | 'behind_one' | 'behind_more' | 'unreported';

type Row = Record<string, any>;

export type ClientRelease = {
  id: string;
  platform: Platform;
  channel: Channel;
  version: string;
  build: string | null;
  r2Key: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  notes: string | null;
  minSupportedVersion: string | null;
  publishedAt: number | null;
  yankedAt: number | null;
  yankReason: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateReleaseInput = {
  platform: string;
  channel: string;
  version: string;
  build?: string | null;
  r2Key?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  notes?: string | null;
  minSupportedVersion?: string | null;
  publishedAt?: number | null;
};

export type ReleasePatch = {
  notes?: string | null;
  minSupportedVersion?: string | null;
  publish?: boolean;
  yank?: boolean;
  yankReason?: string | null;
};

export type AdoptionMatrix = {
  days: Array<{
    day: number;
    platform: Platform;
    versions: Array<{
      version: string;
      devices: number;
      users: number;
      bucket: VersionBucket;
    }>;
    unreleased?: true;
  }>;
  latest: Record<Platform, string | null>;
  unreleased: Partial<Record<Platform, true>>;
};

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function uniqueConflict(error: unknown): boolean {
  return String(error).includes('UNIQUE constraint failed');
}

export function utcDay(unix: number): number {
  return Math.floor(unix / DAY) * DAY;
}

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

function field(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value;
}

function optionalText(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return field(value, name, 1, max);
}

function optionalUnix(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

function optionalCount(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

function platformField(value: unknown): Platform {
  const platform = field(value, 'platform', 1, 20);
  if (!isPlatform(platform)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid platform');
  return platform;
}

function channelField(value: unknown): Channel {
  const channel = field(value, 'channel', 1, 20);
  if (!isChannel(channel)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid channel');
  return channel;
}

function versionField(value: unknown, name = 'version'): string {
  return field(value, name, 1, 40);
}

function nullable(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

function nullableInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function publicRelease(row: Row): ClientRelease {
  return {
    id: String(row.id),
    platform: row.platform as Platform,
    channel: row.channel as Channel,
    version: String(row.version),
    build: nullable(row.build),
    r2Key: nullable(row.r2_key),
    sizeBytes: nullableInt(row.size_bytes),
    sha256: nullable(row.sha256),
    notes: nullable(row.notes),
    minSupportedVersion: nullable(row.min_supported_version),
    publishedAt: nullableInt(row.published_at),
    yankedAt: nullableInt(row.yanked_at),
    yankReason: nullable(row.yank_reason),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
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

export async function createRelease(
  db: D1Database,
  input: CreateReleaseInput,
  nowSec: number,
): Promise<ClientRelease> {
  const platform = platformField(input.platform);
  const channel = channelField(input.channel);
  const version = versionField(input.version);
  const build = optionalText(input.build, 'build', 80);
  const r2Key = optionalText(input.r2Key, 'r2Key', 500);
  const sizeBytes = optionalCount(input.sizeBytes, 'sizeBytes');
  const sha256 = optionalText(input.sha256, 'sha256', 64);
  const notes = optionalText(input.notes, 'notes', 4000);
  const minSupportedVersion = input.minSupportedVersion == null || input.minSupportedVersion === ''
    ? null
    : versionField(input.minSupportedVersion, 'minSupportedVersion');
  const publishedAt = optionalUnix(input.publishedAt, 'publishedAt');
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO client_releases(
         id, platform, channel, version, build, r2_key, size_bytes, sha256,
         notes, min_supported_version, published_at, yanked_at, yank_reason,
         created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).bind(
      id, platform, channel, version, build, r2Key, sizeBytes, sha256,
      notes, minSupportedVersion, publishedAt, nowSec, nowSec,
    ).run();
  } catch (error) {
    if (uniqueConflict(error)) {
      throw new ApiError(409, 'RELEASE_CONFLICT', 'A release with this platform, channel and version already exists');
    }
    throw error;
  }
  const row = await db.prepare('SELECT * FROM client_releases WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new ApiError(500, 'INTERNAL_ERROR', 'Release insert failed');
  return publicRelease(row);
}

export async function updateRelease(
  db: D1Database,
  id: string,
  patch: ReleasePatch,
  nowSec: number,
): Promise<ClientRelease> {
  const existing = await db.prepare('SELECT * FROM client_releases WHERE id = ?').bind(id).first<Row>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Release not found');
  const current = publicRelease(existing);
  const notes = 'notes' in patch ? optionalText(patch.notes, 'notes', 4000) : current.notes;
  const minSupportedVersion = 'minSupportedVersion' in patch
    ? (patch.minSupportedVersion == null || patch.minSupportedVersion === ''
      ? null
      : versionField(patch.minSupportedVersion, 'minSupportedVersion'))
    : current.minSupportedVersion;
  let publishedAt = current.publishedAt;
  if (patch.publish === true) publishedAt = current.publishedAt ?? nowSec;
  let yankedAt = current.yankedAt;
  let yankReason = current.yankReason;
  if (patch.yank === true) {
    yankedAt = current.yankedAt ?? nowSec;
    if ('yankReason' in patch) yankReason = optionalText(patch.yankReason, 'yankReason', 400);
  } else if (patch.yank === false) {
    yankedAt = null;
    yankReason = null;
  } else if ('yankReason' in patch) {
    yankReason = optionalText(patch.yankReason, 'yankReason', 400);
  }
  await db.prepare(
    `UPDATE client_releases
     SET notes = ?, min_supported_version = ?, published_at = ?, yanked_at = ?,
         yank_reason = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(notes, minSupportedVersion, publishedAt, yankedAt, yankReason, nowSec, id).run();
  const row = await db.prepare('SELECT * FROM client_releases WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Release not found');
  return publicRelease(row);
}

export async function listReleases(
  db: D1Database,
  filter: { platform?: string; channel?: string } = {},
): Promise<ClientRelease[]> {
  const clauses: string[] = [];
  const binds: string[] = [];
  if (filter.platform !== undefined) {
    clauses.push('platform = ?');
    binds.push(platformField(filter.platform));
  }
  if (filter.channel !== undefined) {
    clauses.push('channel = ?');
    binds.push(channelField(filter.channel));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db.prepare(
    `SELECT * FROM client_releases ${where}
     ORDER BY platform, channel, COALESCE(published_at, 0) DESC, created_at DESC`,
  ).bind(...binds).all<Row>();
  return (rows.results ?? []).map(publicRelease);
}

export async function currentRelease(
  db: D1Database,
  platform: string,
  channel: string,
): Promise<ClientRelease | null> {
  const row = await db.prepare(
    `SELECT * FROM client_releases
     WHERE platform = ? AND channel = ?
       AND published_at IS NOT NULL AND yanked_at IS NULL
     ORDER BY published_at DESC
     LIMIT 1`,
  ).bind(platformField(platform), channelField(channel)).first<Row>();
  return row ? publicRelease(row) : null;
}

async function publishedStableVersions(db: D1Database, platform: Platform): Promise<string[]> {
  const rows = await db.prepare(
    `SELECT version FROM client_releases
     WHERE platform = ? AND channel = 'stable'
       AND published_at IS NOT NULL AND yanked_at IS NULL`,
  ).bind(platform).all<{ version: string }>();
  return (rows.results ?? []).map((row) => String(row.version));
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
      if (existing) return { skipped: true, rows: 0 };
    } else {
      await db.prepare('DELETE FROM ops_client_version_daily WHERE day_at = ?').bind(day).run();
    }
    const windows = await db.prepare(
      `SELECT os_version, client_version, device_id, user_id,
              json_extract(payload_json, '$.platform') AS platform
       FROM telemetry_windows
       WHERE received_at >= ? AND received_at < ?`,
    ).bind(day, day + DAY).all<Row>();
    const groups = new Map<string, { platform: Platform; version: string; devices: Set<string>; users: Set<string> }>();
    for (const row of windows.results ?? []) {
      const platform = typeof row.platform === 'string' && isPlatform(row.platform)
        ? row.platform
        : sniffPlatform(String(row.os_version ?? ''));
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
    if (statements.length > 0) await db.batch(statements);
    return { skipped: false, rows: statements.length };
  } catch (error) {
    if (missingTable(error)) return { skipped: true, rows: 0 };
    throw error;
  }
}

export async function adoptionMatrix(
  db: D1Database,
  opts: { days?: number; nowSec?: number } = {},
): Promise<AdoptionMatrix> {
  const days = opts.days ?? 30;
  if (!Number.isSafeInteger(days) || days <= 0 || days > 4000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid days');
  }
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const end = utcDay(nowSec);
  const start = end - days * DAY;
  const latest = {} as Record<Platform, string | null>;
  const unreleased: Partial<Record<Platform, true>> = {};
  const published: Record<Platform, string[]> = {} as Record<Platform, string[]>;
  try {
    for (const platform of PLATFORMS) {
      const any = await db.prepare(
        'SELECT 1 AS ok FROM client_releases WHERE platform = ? LIMIT 1',
      ).bind(platform).first();
      if (!any) unreleased[platform] = true;
      const current = await currentRelease(db, platform, 'stable');
      latest[platform] = current?.version ?? null;
      published[platform] = await publishedStableVersions(db, platform);
    }
    const rows = await db.prepare(
      `SELECT day_at, platform, app_version, devices, users
       FROM ops_client_version_daily
       WHERE day_at >= ? AND day_at <= ?
       ORDER BY day_at ASC, platform ASC, app_version ASC`,
    ).bind(start, end).all<Row>();
    const grouped = new Map<string, AdoptionMatrix['days'][number]>();
    for (const row of rows.results ?? []) {
      const platform = String(row.platform);
      if (!isPlatform(platform)) continue;
      const day = Number(row.day_at);
      const key = `${day}:${platform}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = { day, platform, versions: [] };
        if (unreleased[platform]) entry.unreleased = true;
        grouped.set(key, entry);
      }
      entry.versions.push({
        version: String(row.app_version),
        devices: Number(row.devices),
        users: Number(row.users),
        bucket: versionBucket(String(row.app_version), published[platform] ?? []),
      });
    }
    for (const entry of grouped.values()) {
      entry.versions.sort((a, b) => compareVersions(b.version, a.version));
    }
    return { days: [...grouped.values()], latest, unreleased };
  } catch (error) {
    if (!missingTable(error)) throw error;
    for (const platform of PLATFORMS) {
      latest[platform] = null;
      unreleased[platform] = true;
    }
    return { days: [], latest, unreleased };
  }
}

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
  try {
    const result = await db.prepare(
      `DELETE FROM ops_client_version_daily WHERE rowid IN (
         SELECT rowid FROM ops_client_version_daily
         WHERE day_at < ?
         ORDER BY day_at ASC
         LIMIT ?
       )`,
    ).bind(cutoff, limit).run();
    return Number(result.meta.changes ?? 0);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}
