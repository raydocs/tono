import type { AdoptionBucket, Platform, ReleaseDto, UpdateChannelDto } from '@contract';

/**
 * Version arithmetic, on the console's side of the wire.
 *
 * The Worker has its own copy of this in `ops/releases.ts` and that one is
 * the authority: it decides the buckets the adoption matrix is counted into.
 * This one exists because the 客户 page has to answer the same question about
 * rows it already holds — clicking a matrix cell must filter the customer
 * list, and refetching the whole list per bucket to have the server say so
 * would be a request per click for an answer already on screen.
 *
 * Kept to the same rules on purpose: numeric segments compared left to right,
 * missing segments read as zero, a pre-release tag sorting below the release
 * it leads to.
 */
function parse(value: string): { core: number[]; pre: string | null } {
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
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < length; i += 1) {
    const da = left.core[i] ?? 0;
    const db = right.core[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** Published, not withdrawn, newest first. What a client could be running. */
export function publishedVersions(
  releases: readonly ReleaseDto[],
  platform: Platform,
): string[] {
  const seen = releases
    .filter((row) => row.platform === platform && row.publishedAt !== null && row.withdrawnAt === null)
    .map((row) => row.version);
  return [...new Set(seen)].sort((a, b) => compareVersions(b, a));
}

/**
 * Which bucket a reported version falls in.
 *
 * A client that has never said what it runs is `unreported`, never `current`:
 * silence is not a version (R1). A version newer than anything published —
 * an internal build on somebody's own laptop — counts as current rather than
 * as an error, because it is not behind.
 */
export function bucketFor(observed: string | null, published: readonly string[]): AdoptionBucket {
  if (!observed || published.length === 0) return 'unreported';
  const index = published.findIndex((value) => compareVersions(value, observed) === 0);
  if (index === 0) return 'current';
  if (index === 1) return 'behind_one';
  if (index > 1) return 'behind_more';
  return compareVersions(observed, published[0]) > 0 ? 'current' : 'behind_more';
}

/** The newest published version per platform: what "current" means today. */
export function currentVersions(releases: readonly ReleaseDto[]): Partial<Record<Platform, string>> {
  const out: Partial<Record<Platform, string>> = {};
  for (const row of releases) {
    if (row.publishedAt === null || row.withdrawnAt !== null) continue;
    const held = out[row.platform];
    if (held === undefined || compareVersions(row.version, held) > 0) out[row.platform] = row.version;
  }
  return out;
}

/**
 * The floor each platform will still serve, taken from its newest published
 * release — an older release's floor is history, not policy.
 */
export function minSupportedVersions(
  releases: readonly ReleaseDto[],
): Partial<Record<Platform, string>> {
  const newest = new Map<Platform, ReleaseDto>();
  for (const row of releases) {
    if (row.publishedAt === null || row.withdrawnAt !== null) continue;
    const held = newest.get(row.platform);
    if (!held || compareVersions(row.version, held.version) > 0) newest.set(row.platform, row);
  }
  const out: Partial<Record<Platform, string>> = {};
  for (const [platform, row] of newest) {
    if (row.minSupportedVersion) out[platform] = row.minSupportedVersion;
  }
  return out;
}

/** Platforms with at least one release row at all — published or not. */
export function releasedPlatformSet(releases: readonly ReleaseDto[]): Set<Platform> {
  return new Set(releases.map((row) => row.platform));
}

/** Has the Worker checked this build against the file an updater downloads? */
export function isVerified(row: ReleaseDto): boolean {
  return row.verifiedAt != null;
}

/** The words `publishBlockReason` needs; a slice of `copy`, passed in. */
export type PublishWords = {
  platform: Record<Platform, string>;
  publishBlocked: {
    unwired: (platform: string) => string;
    unverified: string;
    unsigned: string;
  };
};

/**
 * Why this build cannot be published, or null when it can.
 *
 * The Worker refuses all three of these, and it is the authority. The console
 * asks the same three questions first so the operator reads the reason on the
 * button instead of discovering it in a dialog that failed — and so the answer
 * is the same answer, in the same order, on both sides of the wire.
 *
 * A channel that has not loaded yet blocks nothing: unknown is not 未接, and
 * greying a button on a pending request is how a page teaches people to reload.
 */
export function publishBlockReason(
  row: ReleaseDto,
  channel: UpdateChannelDto | null,
  words: PublishWords,
): string | null {
  if (channel !== null && !channel.wired) {
    return words.publishBlocked.unwired(words.platform[row.platform]);
  }
  if (!isVerified(row)) return words.publishBlocked.unverified;
  if (channel !== null && channel.wired && row.signed !== true) {
    return words.publishBlocked.unsigned;
  }
  return null;
}

