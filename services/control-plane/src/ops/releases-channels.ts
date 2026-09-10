// 每个平台的更新源：有没有更新器，喂哪条 feed，Worker 是不是真的在渲染它。
//
// The table below is deliberately a constant rather than a query: which
// updater a platform ships with is a property of the client, not of the
// database, and pretending otherwise would let a missing row read as "no
// updater" when the truth is "we forgot to seed it".
//
// `wired` is the field that keeps this honest. macOS and Windows are the two
// feeds the Worker renders from `client_releases`; the rest have no updater at
// all, and the console must say 未接 rather than showing a path that answers
// nothing.

import { PLATFORMS, type Platform, type UpdateChannelDto, type UpdateChannelKind } from './contract';
import { currentRelease } from './releases';

type ChannelShape = {
  kind: UpdateChannelKind | null;
  feedPath: string | null;
  wired: boolean;
};

export const UPDATE_CHANNELS: Record<Platform, ChannelShape> = {
  macos: { kind: 'sparkle', feedPath: '/appcast.xml', wired: true },
  windows: { kind: 'tauri', feedPath: '/windows/latest.json', wired: true },
  linux: { kind: null, feedPath: null, wired: false },
  android: { kind: null, feedPath: null, wired: false },
  ios: { kind: null, feedPath: null, wired: false },
};

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

/**
 * One row per platform, in `PLATFORMS` order, so the console renders the same
 * five lines whether or not anything has ever been published. `current` is the
 * newest published, non-withdrawn stable release; null means the feed would
 * serve nothing today.
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
