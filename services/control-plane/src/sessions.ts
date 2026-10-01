import { jwtSign, randomToken, sha256 } from './crypto';
import { type Env, type Row, now, id, envInt, requiredSecret } from './env';
import { ApiError } from './errors';
import { recordClient } from './client-identity';

// Long enough to cover a 45 s request timeout plus the clients' next five-minute
// sync, short enough that an old copy of a rotated token is not a standing credential.
const REFRESH_REPLAY_GRACE_SECONDS = 600;

export async function tokens(
  e: Env,
  user: string,
  device: string,
  installation: string,
  rotate?: { from: string; replay: boolean; also: D1PreparedStatement[] },
) {
  const refresh = randomToken();
  const t = now();
  const sid = id();
  // Every API request re-checks the session, user and device rows in auth(), so
  // revocation does not depend on JWT expiry. A one-day access token avoids
  // rotating three D1 rows every fifteen minutes on every idle client.
  const accessTTL = envInt(e, 'ACCESS_TOKEN_TTL_SECONDS', 86_400);
  const refreshTTL = envInt(e, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000);
  const insert = 'INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id)';
  const values = [sid, user, await sha256(refresh), t + refreshTTL, t, device];
  try {
    if (rotate) {
      // Revoke and successor insert commit together, and only the request that
      // won the revoke inserts. A session superseded by a replay records no
      // rotated_at, so its own token never opens a second grace replay.
      const [revoked] = await e.DB.batch([
        e.DB.prepare(
          'UPDATE sessions SET revoked_at = ?, rotated_at = ?, successor_id = ? WHERE id = ? AND revoked_at IS NULL',
        ).bind(t, rotate.replay ? null : t, sid, rotate.from),
        e.DB.prepare(
          `${insert} SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ? AND successor_id = ?)`,
        ).bind(...values, rotate.from, sid),
        ...rotate.also,
      ]);
      if (!revoked.meta.changes) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token was already used');
    } else {
      await e.DB.prepare(`${insert} VALUES(?, ?, ?, ?, ?, ?)`).bind(...values).run();
    }
  } catch (x) {
    if (String(x).includes('SESSION_DEVICE_INELIGIBLE')) {
      throw new ApiError(
        409,
        'DEVICE_AUTHORIZATION_CHANGED',
        'Device authorization changed during sign-in; start sign-in again',
      );
    }
    throw x;
  }
  return {
    accessToken: await jwtSign(
      { sub: user, sid, did: device, iid: installation, iat: t, exp: t + accessTTL },
      requiredSecret(e.JWT_SECRET),
    ),
    refreshToken: refresh,
  };
}

export async function refreshSession(e: Env, req: Request, raw: string) {
  const t = now();
  const session = (where: string, key: string) => e.DB.prepare(
    `SELECT sessions.*, users.status user_status, users.quota_bytes, users.usage_bytes, users.expires_at user_expires_at,
            devices.installation_id, devices.status device_status, devices.pending_expires_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     JOIN devices ON devices.id = sessions.device_id
     WHERE ${where} AND sessions.expires_at > ?`,
  ).bind(key, t).first<Row>();
  let s = await session('refresh_hash = ?', await sha256(raw));
  // A client whose rotation response was lost still holds the token it just
  // rotated. Inside the grace window, while the successor is live and has
  // never been rotated itself, rotate that successor for it instead of
  // declaring the session dead. Anything else is reuse and stays 401.
  const replay = !!s && s.revoked_at !== null;
  if (s && replay) {
    s = s.successor_id && s.rotated_at !== null && s.rotated_at > t - REFRESH_REPLAY_GRACE_SECONDS
      ? await session('sessions.id = ?', s.successor_id)
      : null;
  }
  if (
    !s ||
    s.revoked_at !== null ||
    s.user_status !== 'active' ||
    !['active', 'pending'].includes(s.device_status) ||
    (s.device_status === 'pending' && s.pending_expires_at <= t) ||
    (s.user_expires_at !== null && s.user_expires_at <= t) ||
    (s.quota_bytes !== null && s.usage_bytes >= s.quota_bytes)
  ) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
  }
  const issued = await tokens(e, s.user_id, s.device_id, s.installation_id, {
    from: s.id,
    replay,
    also: [e.DB.prepare('UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?').bind(t, t, s.device_id)],
  });
  // Only after the rotation committed, as on the pre-#329 path (#578).
  await recordClient(e, req, String(s.device_id));
  return issued;
}
