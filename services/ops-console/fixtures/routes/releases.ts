// 更新源 — the fixture half of `GET releases/channels`.
//
// It lives here rather than in `vite.config.ts` because the channel table is
// department D's, not the dev server's: E owns the middleware registration and
// gets one `if` for this route, while the five rows and the "newest published
// stable" rule stay in a file D can change without touching a shared config.

/** Only the two fields of the loaded releases fixture this route reads. */
export type ReleasesFixtureFile = {
  clock: number;
  list: { items: Array<Record<string, unknown>> };
};

/**
 * The same five rows the Worker's `releases/channels` returns. Only macOS and
 * Windows have a feed the Worker renders; the rest say so rather than showing
 * a path that answers nothing.
 */
const UPDATE_CHANNELS = [
  { platform: 'macos', kind: 'sparkle', feedPath: '/appcast.xml', wired: true },
  { platform: 'windows', kind: 'tauri', feedPath: '/windows/latest.json', wired: true },
  { platform: 'linux', kind: null, feedPath: null, wired: false },
  { platform: 'android', kind: null, feedPath: null, wired: false },
  { platform: 'ios', kind: null, feedPath: null, wired: false },
] as const;

/** Newest published, verified, non-withdrawn stable row per platform in the loaded set. */
export function updateChannels(file: ReleasesFixtureFile): unknown {
  const rows = UPDATE_CHANNELS.map((channel) => {
    const newest = file.list.items
      .filter((row) => (
        row.platform === channel.platform
        && row.channel === 'stable'
        && typeof row.publishedAt === 'number'
        && typeof row.verifiedAt === 'number'
        && row.withdrawnAt === null
      ))
      .sort((a, b) => Number(b.publishedAt) - Number(a.publishedAt))[0];
    return {
      platform: channel.platform,
      kind: channel.kind,
      feedPath: channel.feedPath,
      wired: channel.wired,
      current: newest ? { releaseId: String(newest.id), version: String(newest.version) } : null,
    };
  });
  return { items: rows, nextCursor: null, total: rows.length, updatedAt: file.clock };
}
