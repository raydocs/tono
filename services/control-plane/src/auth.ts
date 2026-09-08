import { type Env, type Row, now, requiredSecret } from './env';
import { jwtVerify, sha256 } from './crypto';
import { ApiError } from './errors';
import { exitCredentialRolloutPhase } from './catalog';

export function bearer(req: Request) {
  const h = req.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHORIZED', 'Bearer token required');
  const token = h.slice(7);
  if (!token || token.length > 4_096 || /\s/.test(token)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid bearer token');
  }
  return token;
}

export function clientIp(req: Request) {
  return req.headers.get('cf-connecting-ip') || '0.0.0.0';
}

export async function auth(req: Request, e: Env) {
  const p = await jwtVerify(bearer(req), requiredSecret(e.JWT_SECRET));
  if (
    typeof p?.sub !== 'string' ||
    p.sub.length === 0 ||
    typeof p.sid !== 'string' ||
    p.sid.length === 0
  ) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired access token');
  }
  const t = now();
  const s = await e.DB.prepare(
    `SELECT sessions.*, users.status user_status, users.quota_bytes, users.usage_bytes, users.expires_at user_expires_at,
            devices.status device_status, devices.pending_expires_at, devices.installation_id
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     JOIN devices ON devices.id = sessions.device_id
     WHERE sessions.id = ? AND sessions.user_id = ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ?`,
  ).bind(p.sid, p.sub, t).first<Row>();
  if (
    !s ||
    s.user_status !== 'active' ||
    !['active', 'pending'].includes(s.device_status) ||
    (s.device_status === 'pending' && s.pending_expires_at <= t) ||
    (s.user_expires_at !== null && s.user_expires_at <= t) ||
    (s.quota_bytes !== null && s.usage_bytes >= s.quota_bytes)
  ) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Session is no longer active');
  }
  return {
    userId: String(s.user_id),
    sessionId: String(s.id),
    deviceId: String(s.device_id),
    installationId: String(s.installation_id),
  };
}

export async function userId(req: Request, e: Env) {
  return (await auth(req, e)).userId;
}

export async function privileged(req: Request, expected: string) {
  const actualHash = await sha256(bearer(req));
  const expectedHash = await sha256(requiredSecret(expected));
  let difference = actualHash.length ^ expectedHash.length;
  for (let index = 0; index < Math.max(actualHash.length, expectedHash.length); index++) {
    difference |= (actualHash.charCodeAt(index) || 0) ^ (expectedHash.charCodeAt(index) || 0);
  }
  if (difference !== 0) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Invalid token');
  }
}

export type ExitNodeIdentity = { id: string; name: string };

export async function authenticateExitNode(
  req: Request,
  e: Env,
  allowLegacyRead = false,
): Promise<ExitNodeIdentity | null> {
  const token = bearer(req);
  const tokenHash = await sha256(token);
  const node = await e.DB.prepare(
    `SELECT id, name FROM exit_nodes
     WHERE token_hash = ? AND status = 'active'`,
  ).bind(tokenHash).first<Row>();
  if (node) return { id: String(node.id), name: String(node.name) };
  if (allowLegacyRead && await exitCredentialRolloutPhase(e) === 'dual') {
    await privileged(req, e.HOME_AGENT_TOKEN);
    return null;
  }
  throw new ApiError(401, 'UNAUTHORIZED', 'Invalid exit node token');
}
