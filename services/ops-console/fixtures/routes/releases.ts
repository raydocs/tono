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

/** One object as the fixture file stores it; `guess` and `registered` are derived per request. */
export type ReleaseObjectFixture = {
  key: string;
  sizeBytes: number;
  uploadedAt: number;
  sha256: string | null;
  etag: string;
};

const MACOS_ZIP = /^Tono-(\d+(?:\.\d+)+)-build(\d+)-arm64\.zip$/;
const WINDOWS_SETUP = /^.+-(\d+(?:\.\d+)+)-setup\.exe$/;

/** The Worker's `guessReleaseFromKey`: the two publish file names, nothing else. */
function guessFromKey(key: string): unknown {
  const name = key.slice(key.lastIndexOf('/') + 1);
  const mac = MACOS_ZIP.exec(name);
  if (mac) return { platform: 'macos', channel: 'stable', version: mac[1], build: mac[2] };
  const win = WINDOWS_SETUP.exec(name);
  if (win) return { platform: 'windows', channel: 'stable', version: win[1], build: null };
  return null;
}

/** `GET releases/objects`: the bucket's files, flagged by what the loaded releases already point at. */
export function releaseObjects(
  file: ReleasesFixtureFile,
  objects: { items: ReleaseObjectFixture[] },
): unknown {
  const taken = new Set(file.list.items.map((row) => row.r2Key).filter((key) => typeof key === 'string'));
  const rows = [...objects.items]
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map((row) => ({ ...row, guess: guessFromKey(row.key), registered: taken.has(row.key) }));
  return { items: rows, nextCursor: null, total: rows.length, updatedAt: file.clock, truncated: false };
}

const REQUIRED = ['platform', 'channel', 'version', 'r2Key', 'sizeBytes', 'sha256'] as const;

/**
 * `POST releases`: the same refusals the Worker makes for a missing field and a
 * duplicate platform/channel/version, then a draft row (never published, never
 * withdrawn) that the next `GET releases` returns.
 */
export function registerRelease(
  file: ReleasesFixtureFile,
  body: Record<string, unknown>,
): { row: Record<string, unknown> } | { status: number; error: { code: string; message: string } } {
  for (const name of REQUIRED) {
    if (body[name] === undefined || body[name] === null || body[name] === '') {
      return { status: 400, error: { code: 'VALIDATION_ERROR', message: `Missing ${name}` } };
    }
  }
  const clash = file.list.items.some((row) => (
    row.platform === body.platform && row.channel === body.channel && row.version === body.version
  ));
  if (clash) {
    return {
      status: 409,
      error: {
        code: 'RELEASE_CONFLICT',
        message: 'A release with this platform, channel and version already exists',
      },
    };
  }
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  const r2Key = String(body.r2Key);
  const row = {
    id: `rel-new-${file.list.items.length + 1}`,
    platform: body.platform,
    channel: body.channel,
    version: body.version,
    build: text(body.build),
    r2Key,
    sha256: body.sha256,
    notes: text(body.notes),
    minSupportedVersion: null,
    publishedAt: null,
    withdrawnAt: null,
    createdAt: file.clock,
    updatedAt: file.clock,
    sizeBytes: body.sizeBytes,
    verifiedAt: file.clock,
    signed: text(body.signature) !== null,
    downloadUrl: `https://releases.afk.ccwu.cc/download/${r2Key}`,
    minOsVersion: text(body.minOsVersion),
  };
  file.list.items.push(row);
  return { row };
}
