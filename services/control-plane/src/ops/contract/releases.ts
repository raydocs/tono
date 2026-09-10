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
  enumList,
  fields,
  int,
  oneOf,
  optInt,
  optText,
  text,
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
];

export function assertRelease(value: unknown, path = 'release'): ReleaseDto {
  const row = fields(value, path, RELEASE_KEYS);
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
