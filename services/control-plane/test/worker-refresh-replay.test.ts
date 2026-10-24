import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../src/crypto';
import { refreshSession } from '../src/sessions';
import { type Env } from '../src/env';
import { api, json, createAccount, useWorkerHarness } from './worker-harness';

const refresh = (token: string) => api('auth/refresh', json({ refreshToken: token }));
const me = (token: string) => api('me', { headers: { authorization: `Bearer ${token}` } });
const row = async (token: string) => env.DB.prepare('SELECT * FROM sessions WHERE refresh_hash = ?')
  .bind(await sha256(token)).first<any>();

describe('refresh response-loss recovery stays anchored to the original token', () => {
  useWorkerHarness();

  it('recovers two consecutive lost responses without giving superseded tokens replay authority', async () => {
    const account = await createAccount('second-replay');
    const first = await refresh(account.refreshToken);
    expect(first.status).toBe(200);
    const s1 = await first.json() as any;
    const original = await row(account.refreshToken);
    const replay = await refresh(account.refreshToken);
    expect(replay.status).toBe(200);
    const s2 = await replay.json() as any;
    const recovered = await refresh(account.refreshToken);
    expect(recovered.status).toBe(200);
    const s3 = await recovered.json() as any;
    const current = await row(s3.refreshToken);
    expect(await row(account.refreshToken)).toMatchObject({ successor_id: current.id, rotated_at: original.rotated_at });
    expect(await row(s1.refreshToken)).toMatchObject({ rotated_at: null });
    expect(await row(s2.refreshToken)).toMatchObject({ rotated_at: null });
    expect((await refresh(s1.refreshToken)).status).toBe(401);
    expect((await refresh(s2.refreshToken)).status).toBe(401);
    expect((await me(s1.accessToken)).status).toBe(401);
    expect((await me(s2.accessToken)).status).toBe(401);
    expect((await me(s3.accessToken)).status).toBe(200);
    expect((await env.DB.prepare('SELECT COUNT(*) n FROM sessions WHERE device_id = ? AND revoked_at IS NULL')
      .bind(account.device.id).first<any>()).n).toBe(1);
  });

  it('does not extend the original 600-second grace when recovery happens near its deadline', async () => {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = 'false';
    const t = Math.floor(Date.now() / 1000);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t * 1000);
    try {
      const account = await createAccount('replay-deadline');
      expect((await refresh(account.refreshToken)).status).toBe(200);
      clock.mockReturnValue((t + 599) * 1000);
      expect((await refresh(account.refreshToken)).status).toBe(200);
      expect((await refresh(account.refreshToken)).status).toBe(200);
      clock.mockReturnValue((t + 600) * 1000);
      expect((await refresh(account.refreshToken)).status).toBe(401);
      expect((await row(account.refreshToken)).rotated_at).toBe(t);
    } finally {
      clock.mockRestore();
    }
  });

  it('stops recovery from the original token once its delivered successor rotates normally', async () => {
    const account = await createAccount('replay-normal-advance');
    expect((await refresh(account.refreshToken)).status).toBe(200);
    const replay = await refresh(account.refreshToken);
    expect(replay.status).toBe(200);
    const recovered = await replay.json() as any;
    const next = await refresh(recovered.refreshToken);
    expect(next.status).toBe(200);
    const current = await next.json() as any;
    expect((await refresh(account.refreshToken)).status).toBe(401);
    expect((await me(current.accessToken)).status).toBe(200);
  });

  it('keeps logout authoritative over every outstanding recovery token', async () => {
    const account = await createAccount('replay-logout');
    expect((await refresh(account.refreshToken)).status).toBe(200);
    const replay = await refresh(account.refreshToken);
    const current = await replay.json() as any;
    expect((await api('auth/logout', json({ refreshToken: current.refreshToken }, current.accessToken))).status).toBe(204);
    expect((await refresh(account.refreshToken)).status).toBe(401);
    expect((await refresh(current.refreshToken)).status).toBe(401);
  });

  it('rejects a stale replay CAS without retiring a concurrent recovery winner', async () => {
    const account = await createAccount('replay-cas');
    expect((await refresh(account.refreshToken)).status).toBe(200);
    let ready!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { ready = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const db = (env as unknown as Env).DB;
    const held = new Proxy(db, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          ready();
          await released;
          return target.batch(statements);
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    // Capture rejection immediately; the controlled event holds the transaction,
    // not a wall-clock sleep or a promise that can reject unobserved.
    const loser = refreshSession({ ...env, DB: held } as unknown as Env,
      new Request('https://test/api/v1/auth/refresh'), account.refreshToken)
      .then(() => ({ status: 200 }), (error: unknown) => error);
    await entered;
    let winner: any;
    try {
      const response = await refresh(account.refreshToken);
      expect(response.status).toBe(200);
      winner = await response.json();
    } finally {
      release();
    }
    expect(await loser).toMatchObject({ status: 401, code: 'INVALID_REFRESH_TOKEN' });
    expect((await me(winner.accessToken)).status).toBe(200);
    expect((await row(account.refreshToken)).successor_id).toBe((await row(winner.refreshToken)).id);
  });
});
