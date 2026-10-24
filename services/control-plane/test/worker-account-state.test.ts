import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { type Env } from '../src/env';
import { enforceUser, revokeDevice } from '../src/devices';
import { api, json, createAccount, emailSignIn, startEmailSignIn, useWorkerHarness } from './worker-harness';

describe('account state is not authentication failure', () => {
  useWorkerHarness();

  it('preserves an expired account session through enforcement and reports renewal separately', async () => {
    const account = await createAccount('expired-contract');
    await env.DB.prepare('UPDATE users SET expires_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000) - 60, account.user.id).run();
    const me = () => api('me', { headers: { authorization: `Bearer ${account.accessToken}` } });
    const response = await me();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'PLAN_EXPIRED' } });
    await enforceUser(env as unknown as Env, account.user.id, false);
    expect((await me()).status).toBe(403);
    const refreshed = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(refreshed.status).toBe(403);
    expect(await refreshed.json()).toMatchObject({ error: { code: 'PLAN_EXPIRED' } });
    const session = await env.DB.prepare('SELECT revoked_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL')
      .bind(account.user.id).first();
    expect(session).not.toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM device_exit_credentials WHERE device_id = ?')
      .bind(account.device.id).first()).toBeNull();
    await env.DB.prepare('UPDATE users SET expires_at = NULL WHERE id = ?').bind(account.user.id).run();
    const renewed = await me();
    expect(renewed.status).toBe(403);
    expect(await renewed.json()).toMatchObject({ error: { code: 'DEVICE_REAUTH_REQUIRED' } });
    const signedIn = await emailSignIn({ email: account.email, deviceName: 'Phone', installationId: 'expired-contract-installation-one' });
    expect(signedIn.status).toBe(200);
    const restored = await signedIn.json() as any;
    expect((await api('me', { headers: { authorization: `Bearer ${restored.accessToken}` } })).status).toBe(200);
    expect((await env.DB.prepare('SELECT entitlement_suspended FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>()).entitlement_suspended).toBe(0);
  });

  it('returns quota state on access, refresh and verified email without suppressing the email', async () => {
    const account = await createAccount('quota-contract');
    await env.DB.prepare('UPDATE users SET quota_bytes = 1, usage_bytes = 1 WHERE id = ?').bind(account.user.id).run();
    const response = await api('me', { headers: { authorization: `Bearer ${account.accessToken}` } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'QUOTA_EXHAUSTED' } });
    const refreshed = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(refreshed.status).toBe(403);
    expect(await refreshed.json()).toMatchObject({ error: { code: 'QUOTA_EXHAUSTED' } });
    const start = await startEmailSignIn({ email: account.email, deviceName: 'Phone', installationId: 'quota-contract-phone' });
    expect(start.code).toMatch(/^\d{6}$/);
    const verified = await api('auth/email/verify', json({ challengeId: start.challengeId, code: start.code }));
    expect(verified.status).toBe(403);
    expect(await verified.json()).toMatchObject({ error: { code: 'QUOTA_EXHAUSTED' } });
  });

  it('keeps explicit device revocation authoritative even during account suspension', async () => {
    const account = await createAccount('revoked-contract');
    await env.DB.prepare('UPDATE users SET expires_at = 1 WHERE id = ?').bind(account.user.id).run();
    await enforceUser(env as unknown as Env, account.user.id, false);
    const device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(account.device.id).first<any>();
    await revokeDevice(env as unknown as Env, device);
    expect((await api('me', { headers: { authorization: `Bearer ${account.accessToken}` } })).status).toBe(401);
    expect((await api('auth/refresh', json({ refreshToken: account.refreshToken }))).status).toBe(401);
  });
});
