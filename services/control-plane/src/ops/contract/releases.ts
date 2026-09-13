// 发布：客户端有哪些版本在跑，谁还没升上来。

import type {
  Platform,
  RangeKey,
  ReleaseChannel,
} from './vocabulary';
import {
  PLATFORMS,
  RANGE_KEYS,
  RELEASE_CHANNELS,
} from './vocabulary';
import {
  arrayOf,
  bool,
  enumList,
  fields,
  int,
  oneOf,
  optInt,
  optOneOf,
  optText,
  text,
  violation,
} from './checkers';

export interface ReleaseDto {
  id: string;
  platform: Platform;
  channel: ReleaseChannel;
  version: string;
  build: string | null;
  r2Key: string | null;
  sha256: string | null;
  notes: string | null;
  /** Drives the 版本过旧 chore; null means nothing is too old yet. */
  minSupportedVersion: string | null;
  publishedAt: number | null;
  withdrawnAt: number | null;
  createdAt: number;
  updatedAt: number;
  // The five keys below are optional on the wire (org plan v2 §0.3: new
  // fields never break a captured fixture); the Worker always sends them.
  /** Bytes of the R2 object, when the upload recorded one. */
  sizeBytes?: number | null;
  /** Epoch seconds of the last successful R2 object check; null until D3 verifies. */
  verifiedAt?: number | null;
  /** True once a Sparkle/minisign signature is stored beside the build. */
  signed?: boolean;
  /** `https://releases.afk.ccwu.cc/download/<r2Key>`; null while no object is attached. */
  downloadUrl?: string | null;
  /** Lowest OS the build installs on, when the build declares one. */
  minOsVersion?: string | null;
}

export const ADOPTION_BUCKETS = ['current', 'behind_one', 'behind_more', 'unreported'] as const;
export type AdoptionBucket = (typeof ADOPTION_BUCKETS)[number];

export interface AdoptionCellDto {
  platform: Platform;
  bucket: AdoptionBucket;
  users: number;
  devices: number;
}

/**
 * 平台 × 版本档.
 *
 * `released` is the platforms that have ever published a build. A platform
 * absent from it renders 未发布 rather than a column of zeros — a zero there
 * would read as "nobody upgraded" when the truth is "nothing shipped".
 */
export interface AdoptionMatrixDto {
  range: RangeKey;
  released: Platform[];
  cells: AdoptionCellDto[];
  updatedAt: number;
}

const RELEASE_KEYS = [
  'id', 'platform', 'channel', 'version', 'build', 'r2Key', 'sha256', 'notes',
  'minSupportedVersion', 'publishedAt', 'withdrawnAt', 'createdAt', 'updatedAt',
  'sizeBytes', 'verifiedAt', 'signed', 'downloadUrl', 'minOsVersion',
];

export function assertRelease(value: unknown, path = 'release'): ReleaseDto {
  const row = fields(value, path, RELEASE_KEYS);
  const sizeBytes = row.sizeBytes === undefined ? undefined : optInt(row, path, 'sizeBytes');
  if (sizeBytes != null && sizeBytes < 0) violation(`${path}.sizeBytes`);
  const verifiedAt = row.verifiedAt === undefined ? undefined : optInt(row, path, 'verifiedAt');
  if (verifiedAt != null && verifiedAt <= 0) violation(`${path}.verifiedAt`);
  return {
    id: text(row, path, 'id'),
    platform: oneOf<Platform>(row, path, 'platform', PLATFORMS),
    channel: oneOf<ReleaseChannel>(row, path, 'channel', RELEASE_CHANNELS),
    version: text(row, path, 'version'),
    build: optText(row, path, 'build'),
    r2Key: optText(row, path, 'r2Key'),
    sha256: optText(row, path, 'sha256'),
    notes: optText(row, path, 'notes'),
    minSupportedVersion: optText(row, path, 'minSupportedVersion'),
    publishedAt: optInt(row, path, 'publishedAt'),
    withdrawnAt: optInt(row, path, 'withdrawnAt'),
    createdAt: int(row, path, 'createdAt'),
    updatedAt: int(row, path, 'updatedAt'),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
    ...(row.signed === undefined ? {} : { signed: bool(row, path, 'signed') }),
    ...(row.downloadUrl === undefined ? {} : { downloadUrl: optText(row, path, 'downloadUrl') }),
    ...(row.minOsVersion === undefined ? {} : { minOsVersion: optText(row, path, 'minOsVersion') }),
  };
}

const ADOPTION_CELL_KEYS = ['platform', 'bucket', 'users', 'devices'];

export function assertAdoptionCell(value: unknown, path = 'adoptionCell'): AdoptionCellDto {
  const row = fields(value, path, ADOPTION_CELL_KEYS);
  return {
    platform: oneOf<Platform>(row, path, 'platform', PLATFORMS),
    bucket: oneOf<AdoptionBucket>(row, path, 'bucket', ADOPTION_BUCKETS),
    users: int(row, path, 'users'),
    devices: int(row, path, 'devices'),
  };
}

const ADOPTION_KEYS = ['range', 'released', 'cells', 'updatedAt'];

export function assertAdoptionMatrix(value: unknown, path = 'adoption'): AdoptionMatrixDto {
  const row = fields(value, path, ADOPTION_KEYS);
  return {
    range: oneOf<RangeKey>(row, path, 'range', RANGE_KEYS),
    released: enumList<Platform>(row, path, 'released', PLATFORMS),
    cells: arrayOf(row, path, 'cells', assertAdoptionCell),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

/** The two updaters the client ships with; a platform may have neither. */
export const UPDATE_CHANNEL_KINDS = ['sparkle', 'tauri'] as const;
export type UpdateChannelKind = (typeof UPDATE_CHANNEL_KINDS)[number];

/**
 * What a platform's auto-update actually points at.
 *
 * `wired` is the honest half: a feed path with `wired: false` is a path the
 * Worker does not render yet, and 未接 is the only thing the console may say
 * about it — an unwired feed rendered as configured is how a platform ends up
 * silently never updating.
 */
export interface UpdateChannelDto {
  platform: Platform;
  /** null = no updater exists for this platform. */
  kind: UpdateChannelKind | null;
  /** '/appcast.xml' | '/windows/latest.json' | null. */
  feedPath: string | null;
  /** True only when the Worker renders this feed from `client_releases`. */
  wired: boolean;
  /** Newest published, non-withdrawn stable row, else null. */
  current: { releaseId: string; version: string } | null;
}

const CHANNEL_KEYS = ['platform', 'kind', 'feedPath', 'wired', 'current'];
const CHANNEL_CURRENT_KEYS = ['releaseId', 'version'];

function assertChannelCurrent(
  value: unknown,
  path: string,
): { releaseId: string; version: string } | null {
  if (value === null) return null;
  const row = fields(value, path, CHANNEL_CURRENT_KEYS);
  return {
    releaseId: text(row, path, 'releaseId'),
    version: text(row, path, 'version'),
  };
}

export function assertUpdateChannel(value: unknown, path = 'updateChannel'): UpdateChannelDto {
  const row = fields(value, path, CHANNEL_KEYS);
  return {
    platform: oneOf<Platform>(row, path, 'platform', PLATFORMS),
    kind: optOneOf<UpdateChannelKind>(row, path, 'kind', UPDATE_CHANNEL_KINDS),
    feedPath: optText(row, path, 'feedPath'),
    wired: bool(row, path, 'wired'),
    current: assertChannelCurrent(row.current, `${path}.current`),
  };
}
