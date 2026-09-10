import { ApiError } from '../errors';
import { sniffPlatform } from './platform';
import {
  UPDATE_CHANNELS,
  assertSignatureShape,
  isSha256Hex,
  verifyReleaseObject,
} from './releases-verify';
export { sniffPlatform };
// Adoption counting lives in ./adoption; re-exported so importers of this
// module keep their import path.
export {
  adoptionMatrix,
  backfillDeviceDaily,
  compareVersions,
  retainClientVersionDaily,
  rollupClientVersionsDaily,
  utcDay,
  versionBucket,
  type AdoptionCell,
  type AdoptionMatrix,
  type VersionBucket,
} from './adoption';

const PLATFORMS = ['windows', 'macos', 'linux', 'android', 'ios'] as const;
const CHANNELS = ['stable', 'candidate', 'internal'] as const;

export type Platform = (typeof PLATFORMS)[number];
export type Channel = (typeof CHANNELS)[number];
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
  /** The Sparkle / minisign signature the platform's updater checks. */
  signature: string | null;
  /** Lowest OS the build installs on, when the build declares one. */
  minOsVersion: string | null;
  /** When the object behind this row was last confirmed; null = never. */
  verifiedAt: number | null;
  /** The object's etag at that moment, so a replaced object is detectable. */
  objectEtag: string | null;
};

export type CreateReleaseInput = {
  platform: string;
  channel: string;
  version: string;
  build?: string | null;
  r2Key: string;
  sizeBytes: number;
  sha256: string;
  signature?: string | null;
  minOsVersion?: string | null;
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

function uniqueConflict(error: unknown): boolean {
  return String(error).includes('UNIQUE constraint failed');
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

function requiredCount(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

/**
 * A build for a platform whose updater checks a signature must carry one; a
 * platform with no updater may, and it is still shape-checked if it does.
 * Storing an unsigned build for macOS or Windows would be registering an update
 * that every client refuses, which the operator would only learn from silence.
 */
function releaseSignature(platform: Platform, value: unknown): string | null {
  const signature = optionalText(value, 'signature', 4000);
  if (signature === null) {
    if (UPDATE_CHANNELS[platform].wired) {
      throw new ApiError(400, 'VALIDATION_ERROR', `A ${platform} build must carry a signature`);
    }
    return null;
  }
  return assertSignatureShape(platform, signature);
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
    signature: nullable(row.signature),
    minOsVersion: nullable(row.min_os_version),
    verifiedAt: nullableInt(row.verified_at),
    objectEtag: nullable(row.object_etag),
  };
}

/**
 * Register a build — against the object an updater would actually download.
 *
 * `r2Key`, `sizeBytes` and `sha256` are required here rather than in the
 * column definitions because the rows already in the table predate all three;
 * making the columns NOT NULL would have meant either deleting that history or
 * inventing digests for it. The check that matters is on the way in, and it is
 * the bucket that answers it: a row is only written once the object is there,
 * is that many bytes, and hashes to that digest.
 */
export async function createRelease(
  db: D1Database,
  bucket: R2Bucket,
  input: CreateReleaseInput,
  nowSec: number,
): Promise<ClientRelease> {
  const platform = platformField(input.platform);
  const channel = channelField(input.channel);
  const version = versionField(input.version);
  const build = optionalText(input.build, 'build', 80);
  const r2Key = field(input.r2Key, 'r2Key', 1, 500);
  const sizeBytes = requiredCount(input.sizeBytes, 'sizeBytes');
  const sha256 = field(input.sha256, 'sha256', 64, 64);
  if (!isSha256Hex(sha256)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid sha256');
  const signature = releaseSignature(platform, input.signature);
  const minOsVersion = optionalText(input.minOsVersion, 'minOsVersion', 32);
  const notes = optionalText(input.notes, 'notes', 4000);
  const minSupportedVersion = input.minSupportedVersion == null || input.minSupportedVersion === ''
    ? null
    : versionField(input.minSupportedVersion, 'minSupportedVersion');
  const publishedAt = optionalUnix(input.publishedAt, 'publishedAt');
  const verified = await verifyReleaseObject(bucket, r2Key, sha256, sizeBytes);
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO client_releases(
         id, platform, channel, version, build, r2_key, size_bytes, sha256,
         notes, min_supported_version, published_at, yanked_at, yank_reason,
         created_at, updated_at, signature, min_os_version, verified_at, object_etag
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, platform, channel, version, build, r2Key, sizeBytes, sha256,
      notes, minSupportedVersion, publishedAt, nowSec, nowSec,
      signature, minOsVersion, nowSec, verified.etag,
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
  if (patch.publish === true) {
    assertPublishable(current);
    publishedAt = current.publishedAt ?? nowSec;
  }
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

/**
 * The two ways publishing a build would be a lie, refused before it is one.
 *
 * A row that was never checked against its object is a feed entry that 404s or
 * fails its signature check on every client at once; a platform with no updater
 * has nowhere for the row to be published *to*, so calling it published would
 * put a version in the adoption matrix that nothing will ever upgrade towards.
 * Both are 409 rather than 400: the request is well formed, the release simply
 * is not in a state that can be published yet.
 */
function assertPublishable(release: ClientRelease): void {
  if (release.publishedAt !== null) return;
  if (release.verifiedAt === null) {
    throw new ApiError(
      409,
      'RELEASE_UNVERIFIED',
      'This release has not been checked against the object it points at',
    );
  }
  if (!UPDATE_CHANNELS[release.platform].wired) {
    throw new ApiError(
      409,
      'RELEASE_CHANNEL_UNWIRED',
      `${release.platform} has no update feed to publish to`,
    );
  }
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

/**
 * What the platform's feed would serve right now: newest published, still
 * verified, not withdrawn. The verified condition is the same one the feed
 * renderer applies, so 更新源 in the console and the XML a client fetches can
 * never disagree about which build is current.
 */
export async function currentRelease(
  db: D1Database,
  platform: string,
  channel: string,
): Promise<ClientRelease | null> {
  const row = await db.prepare(
    `SELECT * FROM client_releases
     WHERE platform = ? AND channel = ?
       AND published_at IS NOT NULL AND yanked_at IS NULL
       AND verified_at IS NOT NULL
     ORDER BY published_at DESC
     LIMIT 1`,
  ).bind(platformField(platform), channelField(channel)).first<Row>();
  return row ? publicRelease(row) : null;
}
