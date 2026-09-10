// 每个平台的更新源：有没有更新器，喂哪条 feed，Worker 是不是真的在渲染它。
//
// The table itself lives in `./releases-verify`, beside the signature shapes it
// decides — `kind` is what says whether a build needs a Sparkle or a minisign
// signature — and is re-exported here so this stays the module you look in for
// 更新源. Keeping it there is also what keeps `releases.ts` (which refuses an
// unsigned build for a wired platform) and this file (which needs the release
// lookup) from importing each other.

import { PLATFORMS, type UpdateChannelDto } from './contract';
import { currentRelease } from './releases';
import { UPDATE_CHANNELS } from './releases-verify';

export { UPDATE_CHANNELS };

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

/**
 * One row per platform, in `PLATFORMS` order, so the console renders the same
 * five lines whether or not anything has ever been published. `current` is the
 * newest published, verified, non-withdrawn stable release; null means the feed
 * would serve nothing today — which is now the same question the feed itself
 * answers, because `currentRelease` and `/appcast.xml` read the same rows. A
 * published row that was never checked against its object is deliberately not
 * `current`: it is exactly the row that would 404 every updater at once.
 */
export async function listUpdateChannels(
  db: D1Database,
  nowSec: number,
): Promise<UpdateChannelDto[]> {
  void nowSec;
  const rows: UpdateChannelDto[] = [];
  for (const platform of PLATFORMS) {
    const shape = UPDATE_CHANNELS[platform];
    let current: UpdateChannelDto['current'] = null;
    try {
      const release = await currentRelease(db, platform, 'stable');
      if (release) current = { releaseId: release.id, version: release.version };
    } catch (error) {
      if (!missingTable(error)) throw error;
    }
    rows.push({ platform, kind: shape.kind, feedPath: shape.feedPath, wired: shape.wired, current });
  }
  return rows;
}
