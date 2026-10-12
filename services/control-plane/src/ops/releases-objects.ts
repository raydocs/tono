// The release bucket as the console's register-release drawer sees it: what is in R2, what the
// key says it is, and whether a `client_releases` row already points at it.
//
// Nothing here writes. Registering still goes through `POST releases`, which
// re-checks the object itself; the guess below only pre-fills a form.

import type { ReleaseObjectDto, ReleaseObjectGuessDto } from './contract';
import { isSha256Hex } from './releases-verify';

/** Most objects one request will look at before sorting; the bucket is small. */
export const SCAN_CAP = 2000;
const PAGE = 1000;

const MACOS_ZIP = /^Tono-(\d+(?:\.\d+)+)-build(\d+)-arm64\.zip$/;
const WINDOWS_SETUP = /^.+-(\d+(?:\.\d+)+)-setup\.exe$/;

/**
 * Platform, version and build the object key spells out; null when it spells
 * nothing we recognise. Publishing tooling names the files, so this reads
 * those two shapes and refuses to invent a third.
 */
export function guessReleaseFromKey(key: string): ReleaseObjectGuessDto | null {
  const name = key.slice(key.lastIndexOf('/') + 1);
  const [, macVersion, macBuild] = MACOS_ZIP.exec(name) ?? [];
  if (macVersion && macBuild) {
    return { platform: 'macos', channel: 'stable', version: macVersion, build: macBuild };
  }
  const [, winVersion] = WINDOWS_SETUP.exec(name) ?? [];
  if (winVersion) return { platform: 'windows', channel: 'stable', version: winVersion, build: null };
  return null;
}

function hex(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, '0');
  return out;
}

function storedSha256(object: R2Object): string | null {
  const custom = object.customMetadata?.sha256?.toLowerCase();
  if (custom && isSha256Hex(custom)) return custom;
  const checksum = object.checksums?.sha256;
  return checksum ? hex(checksum) : null;
}

/**
 * R2 lists keys in lexicographic order, not upload order, so a scan that stops
 * at `scanCap` keys may have missed newer objects. `truncated` says so; the
 * caller must show it rather than present the list as the whole bucket.
 */
export async function listReleaseObjects(
  bucket: R2Bucket,
  db: D1Database,
  limit: number,
  scan: { cap?: number; page?: number } = {},
): Promise<{ items: ReleaseObjectDto[]; truncated: boolean }> {
  const scanCap = scan.cap ?? SCAN_CAP;
  const pageSize = scan.page ?? PAGE;
  const seen: R2Object[] = [];
  let cursor: string | undefined;
  let more = false;
  do {
    // Never ask for more than the budget left, so the scan cannot pass the cap.
    const page = await bucket.list({
      limit: Math.min(pageSize, scanCap - seen.length),
      cursor,
      include: ['customMetadata', 'httpMetadata'],
    });
    seen.push(...page.objects);
    more = page.truncated;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && seen.length < scanCap);

  const newest = seen
    .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime() || (a.key < b.key ? -1 : 1))
    .slice(0, limit);

  const rows = await db.prepare(
    'SELECT r2_key FROM client_releases WHERE r2_key IS NOT NULL',
  ).all<{ r2_key: string }>();
  const registered = new Set((rows.results ?? []).map((row) => row.r2_key));

  const items = newest.map((object) => ({
    key: object.key,
    sizeBytes: object.size,
    uploadedAt: Math.floor(object.uploaded.getTime() / 1000),
    sha256: storedSha256(object),
    etag: object.etag,
    guess: guessReleaseFromKey(object.key),
    registered: registered.has(object.key),
  }));
  return { items, truncated: more };
}
