import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sha256 } from '../src/crypto';
import worker, { type Env } from '../src/index';
import { refreshSession, revokeOnLogout } from '../src/sessions';

const db = () => (env as unknown as Env).DB;

const api = async (path: string, init: RequestInit = {}) => {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://test/api/v1/${path}`, init),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
};

async function seedLiveSession() {
  const t = Math.floor(Date.now() / 1000);
  const userId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const refresh = `refresh-${userId}`;
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'x', 'active', 0, ?, ?)`,
  ).bind(userId, `${userId}@example.com`, t, t).run();
  await db().prepare(
    `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
     VALUES(?, ?, ?, 'Test', 'active', ?, ?)`,
  ).bind(deviceId, userId, `inst-${userId}`, t, t).run();
  await db().prepare(
    `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, userId, await sha256(refresh), t + 86_400, t, deviceId).run();
  return { userId, sessionId, refresh };
}

async function liveSessionCount(userId: string) {
  const rows = await db().prepare(
    'SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL',
  ).bind(userId).all<{ id: string }>();
  return rows.results.length;
}

describe('logout versus refresh', () => {
  beforeAll(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('unused', { status: 599 }));
  });

  it('revokes the successor when refresh committed before logout finished', async () => {
    const seeded = await seedLiveSession();
    const issued = await refreshSession(
      env as unknown as Env,
      new Request('https://test/api/v1/auth/refresh'),
      seeded.refresh,
    );
    expect(issued.refreshToken).not.toBe(seeded.refresh);
    await revokeOnLogout(env as unknown as Env, seeded.userId, seeded.sessionId, seeded.refresh);
    expect(await liveSessionCount(seeded.userId)).toBe(0);
    const me = await api('me', { headers: { authorization: `Bearer ${issued.accessToken}` } });
    expect(me.status).toBe(401);
  });
});
