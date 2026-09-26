import type { Env } from './env';

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

/**
 * Stamp the device row with the calling build. Writes nothing when the header
 * is absent or malformed (older clients keep their last known value) or when
 * the stored pair already matches, so the five-minute catalog poll costs no
 * row write once a device has been seen. Best effort: by the time a refresh
 * records, the old token is already rotated away, so a failed write here must
 * never turn into a failed sign-in, refresh or catalog response.
 */
export async function recordClient(e: Env, req: Request, deviceId: string): Promise<void> {
  const client = clientIdentity(req);
  if (!client) return;
  try {
    await e.DB.prepare(
      `UPDATE devices SET client_platform = ?, client_version = ?
       WHERE id = ? AND (client_platform IS NOT ? OR client_version IS NOT ?)`,
    ).bind(client.platform, client.version, deviceId, client.platform, client.version).run();
  } catch {
    // Observability only; the caller's response does not depend on it.
  }
}
