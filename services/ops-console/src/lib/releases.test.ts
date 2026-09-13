import { describe, expect, it } from 'vitest';
import type { ReleaseDto } from '@contract';
import {
  bucketFor,
  compareVersions,
  currentVersions,
  minSupportedVersions,
  publishedVersions,
} from './releases';

function release(over: Partial<ReleaseDto>): ReleaseDto {
  return {
    id: over.version ?? 'r',
    platform: 'macos',
    channel: 'stable',
    version: '1.0.0',
    build: null,
    r2Key: null,
    sha256: null,
    notes: null,
    minSupportedVersion: null,
    publishedAt: 1_700_000_000,
    withdrawnAt: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    sizeBytes: null,
    verifiedAt: null,
    signed: false,
    downloadUrl: null,
    minOsVersion: null,
    ...over,
  };
}

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.8', '1.8.0')).toBe(0);
  });

  it('sorts a pre-release below the version it leads to', () => {
    expect(compareVersions('1.8.0-rc1', '1.8.0')).toBe(-1);
  });
});

describe('bucketFor', () => {
  const published = ['1.8.1', '1.8.0', '1.7.9'];

  it('counts silence as unreported, never as current', () => {
    expect(bucketFor(null, published)).toBe('unreported');
    expect(bucketFor('', published)).toBe('unreported');
  });

  it('places the newest, the one behind it, and everything older', () => {
    expect(bucketFor('1.8.1', published)).toBe('current');
    expect(bucketFor('1.8.0', published)).toBe('behind_one');
    expect(bucketFor('1.7.9', published)).toBe('behind_more');
  });

  it('an unpublished version older than the newest is still behind', () => {
    expect(bucketFor('1.7.0', published)).toBe('behind_more');
  });

  it('a build newer than anything published is not behind', () => {
    expect(bucketFor('1.9.0', published)).toBe('current');
  });

  it('a platform with nothing published has nothing to be behind', () => {
    expect(bucketFor('1.8.1', [])).toBe('unreported');
  });
});

describe('what the release list says about a platform', () => {
  const rows = [
    release({ version: '1.8.1' }),
    release({ version: '1.8.0', minSupportedVersion: '1.7.0' }),
    release({ version: '1.9.0', withdrawnAt: 1_700_000_100 }),
    release({ version: '2.0.0', publishedAt: null }),
    release({ version: '3.0.0', platform: 'windows' }),
  ];

  it('published versions exclude the withdrawn and the unpublished', () => {
    expect(publishedVersions(rows, 'macos')).toEqual(['1.8.1', '1.8.0']);
  });

  it('current is the newest that is actually being served', () => {
    expect(currentVersions(rows)).toEqual({ macos: '1.8.1', windows: '3.0.0' });
  });

  it('the floor comes from the newest release, not from an older one', () => {
    // 1.8.1 sets no floor, so macOS has none — 1.8.0's is history.
    expect(minSupportedVersions(rows)).toEqual({});
    const withFloor = [...rows, release({ version: '1.8.2', minSupportedVersion: '1.8.0' })];
    expect(minSupportedVersions(withFloor)).toEqual({ macos: '1.8.0' });
  });
});
