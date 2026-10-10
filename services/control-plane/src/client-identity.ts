import { now, type Env } from './env';
import { recordApiPath } from './api-paths';
import { API_PATH_KINDS } from './ops/contract/api-paths';

// Which client build is talking to the control plane. Recorded on sign-in,
// token refresh and catalog fetch whatever the device's telemetry settings are,
// so operations can tell 0.0.72 from 0.0.73 even when no telemetry window or
// failure report arrives. The header carries a platform and a version string
// only: no account, network or user-typed data.

export const CLIENT_HEADER = 'X-Tono-Client';

const PLATFORMS = new Set(['macos', 'windows']);
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,39}$/;

export type ClientIdentity = { platform: string; version: string };

/** `X-Tono-Client: <macos|windows>/<version>`; anything else reads as absent. */
export function clientIdentity(req: Request): ClientIdentity | null {
  const raw = req.headers.get(CLIENT_HEADER)?.trim() ?? '';
  const slash = raw.indexOf('/');
  if (raw.length > 64 || slash <= 0) return null;
  const platform = raw.slice(0, slash).toLowerCase();
  const version = raw.slice(slash + 1);
  if (!PLATFORMS.has(platform) || !VERSION.test(version)) return null;
  return { platform, version };
}

export const PATH_HEADER = 'X-Tono-Path';

/**
 * Which transport carried this attempt (decision 077). A request through a
 * Tono API relay arrives from an exit node's address, so the edge ASN names the
 * node rather than the customer; the client's own word is the only truth.
 */
export const CLIENT_PATHS: ReadonlySet<string> = new Set(API_PATH_KINDS);
const PATH_SHAPE = /^[a-z_]{1,16}$/;

/** How old a stored path may get before the same path is stamped again. */
export const CLIENT_PATH_RESTAMP_SECONDS = 3_600;

/** `X-Tono-Path: <kind>` from the known set; anything else, even well formed, reads as absent. */
export function clientPath(req: Request): string | null {
  const raw = req.headers.get(PATH_HEADER)?.trim() ?? '';
  return PATH_SHAPE.test(raw) && CLIENT_PATHS.has(raw) ? raw : null;
}

export const PATH_FAILED_HEADER = 'X-Tono-Path-Failed';
/** Six known paths and their commas fit in 64; a longer value is not a list we read. */
const PATH_FAILED_MAX = 96;

/**
 * `X-Tono-Path-Failed: <kind>[,<kind>...]`: the paths this attempt tried and
 * lost before the one it arrived on (decision 080). Null when the header is
 * absent or over-long: that client does not report, so its arrival says
 * nothing about failure. Present but empty means "nothing failed first".
 * Unknown or malformed tokens are dropped, duplicates folded.
 */
export function clientPathFailures(req: Request): string[] | null {
  const raw = req.headers.get(PATH_FAILED_HEADER);
  if (raw === null || raw.length > PATH_FAILED_MAX) return null;
  const out = new Set<string>();
  for (const token of raw.split(',')) {
    const kind = token.trim();
    if (PATH_SHAPE.test(kind) && CLIENT_PATHS.has(kind)) out.add(kind);
  }
  return [...out];
}

/**
 * Stamp the device row with the calling build and the path it came by. Writes
 * nothing for a header that is absent or malformed (older clients keep their
 * last known value), nothing for a build that already matches, and nothing for
 * a path that matches and was stamped within the hour, so the five-minute
 * catalog poll costs no row write once a device has been seen. Best effort: by
 * the time a refresh records, the old token is already rotated away, so a
 * failed write here must never turn into a failed sign-in, refresh or catalog
 * response.
 */
export async function recordClient(e: Env, req: Request, deviceId: string): Promise<void> {
  const client = clientIdentity(req);
  const path = clientPath(req);
  if (client) {
    try {
      await e.DB.prepare(
        `UPDATE devices SET client_platform = ?, client_version = ?
         WHERE id = ? AND (client_platform IS NOT ? OR client_version IS NOT ?)`,
      ).bind(client.platform, client.version, deviceId, client.platform, client.version).run();
    } catch {
      // Observability only; the caller's response does not depend on it.
    }
  }
  if (path) {
    const t = now();
    try {
      const stamped = await e.DB.prepare(
        `UPDATE devices SET client_path = ?, client_path_at = ?
         WHERE id = ? AND (client_path IS NOT ? OR client_path_at IS NULL OR client_path_at <= ?)`,
      ).bind(path, t, deviceId, path, t - CLIENT_PATH_RESTAMP_SECONDS).run();
      // The daily ASN x path count rides the stamp's cadence: no stamp, no write.
      if (Number(stamped.meta?.changes ?? 0) > 0) await recordApiPath(e.DB, req, path, clientPathFailures(req), t);
    } catch {
      // Observability only, as above; a missing column or table before the migration lands is swallowed too.
    }
  }
}
