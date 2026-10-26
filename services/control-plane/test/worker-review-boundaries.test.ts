import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { type Env } from '../src/env';
import { enforceUser, ensureDevice } from '../src/devices';
import macClient from '../../../apps/macos/Tono/Services/TonoAPIClient.swift?raw';
import windowsClient from '../../../apps/windows/crates/tono-core/src/auth.rs?raw';
import { api, json, createAccount, emailSignIn, useWorkerHarness } from './worker-harness';

const macCodes = macClient.match(/static let entitlementCodes[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
const windowsCodes = windowsClient.match(/const ENTITLEMENT_CODES[^=]*=\s*&\[([\s\S]*?)\]/)?.[1] ?? '';
const me = (token: string) => api('me', { headers: { authorization: `Bearer ${token}` } });

function expectDesktopEntitlement(code: string) {
  expect(macCodes).toContain(`"${code}"`);
  expect(windowsCodes).toContain(`"${code}"`);
}

describe('reviewed desktop compatibility and reactivation boundaries', () => {
  useWorkerHarness();

  it('reports expiry using the established macOS and Windows entitlement code', async () => {
    const account = await createAccount('desktop-expired');
    await env.DB.prepare('UPDATE users SET expires_at = 1 WHERE id = ?').bind(account.user.id).run();
    const response = await me(account.accessToken);
    expect(response.status).toBe(403);
    const result = await response.json() as any;
    expectDesktopEntitlement(result.error.code);
    expect(result.error.code).toBe('ACCOUNT_EXPIRED');
    const refresh = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(refresh.status).toBe(403);
    expect(await refresh.json()).toMatchObject({ error: { code: 'ACCOUNT_EXPIRED' } });
  });

  it('reports exhausted quota using the established macOS and Windows entitlement code', async () => {
    const account = await createAccount('desktop-quota');
    await env.DB.prepare('UPDATE users SET quota_bytes = 1, usage_bytes = 1 WHERE id = ?').bind(account.user.id).run();
    const response = await me(account.accessToken);
    expect(response.status).toBe(403);
    const result = await response.json() as any;
    expectDesktopEntitlement(result.error.code);
    expect(result.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('requires established 401 sign-in recovery only after the account is eligible again', async () => {
    const account = await createAccount('desktop-renewed');
    await env.DB.prepare('UPDATE users SET expires_at = 1 WHERE id = ?').bind(account.user.id).run();
    await enforceUser(env as unknown as Env, account.user.id, false);
    expect((await me(account.accessToken)).status).toBe(403);
    await env.DB.prepare('UPDATE users SET expires_at = NULL WHERE id = ?').bind(account.user.id).run();
    const access = await me(account.accessToken);
    expect(access.status).toBe(401);
    expect(await access.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    const refresh = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(refresh.status).toBe(401);
    expect(await refresh.json()).toMatchObject({ error: { code: 'INVALID_REFRESH_TOKEN' } });
    expect(await env.DB.prepare('SELECT 1 FROM device_exit_credentials WHERE device_id = ?')
      .bind(account.device.id).first()).toBeNull();
  });

  async function rejectsPreReactivationSession(enrollment: boolean) {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = enrollment ? 'true' : 'false';
    const account = await createAccount('reactivation-token-failure');
    await env.DB.prepare('UPDATE users SET expires_at = 1 WHERE id = ?').bind(account.user.id).run();
    await enforceUser(env as unknown as Env, account.user.id, false);
    await env.DB.prepare('UPDATE users SET expires_at = NULL WHERE id = ?').bind(account.user.id).run();
    await env.DB.prepare(`CREATE TRIGGER test_fail_session_authorization BEFORE INSERT ON sessions
      WHEN NEW.device_id = '${account.device.id}'
      BEGIN SELECT RAISE(ABORT, 'SESSION_DEVICE_INELIGIBLE'); END`).run();
    const failed = await emailSignIn({ email: account.email, deviceName: 'Phone', installationId: 'reactivation-token-failure-installation-one' });
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: { code: 'DEVICE_AUTHORIZATION_CHANGED' } });
    const device = await env.DB.prepare('SELECT status, entitlement_suspended FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>();
    expect(device).toEqual({ status: enrollment ? 'pending' : 'active', entitlement_suspended: 0 });
    expect((await env.DB.prepare('SELECT COUNT(*) n FROM sessions WHERE device_id = ? AND revoked_at IS NULL')
      .bind(account.device.id).first<any>()).n).toBe(0);
    await env.DB.prepare('DROP TRIGGER test_fail_session_authorization').run();
    expect((await me(account.accessToken)).status).toBe(401);
    expect((await api('auth/refresh', json({ refreshToken: account.refreshToken }))).status).toBe(401);
  }

  it('retires old sessions atomically when active reactivation is followed by token insertion failure', async () => {
    await rejectsPreReactivationSession(false);
  });

  it('retires old sessions atomically when pending reactivation is followed by token insertion failure', async () => {
    await rejectsPreReactivationSession(true);
  });
  it('rolls back session retirement with a failed reactivation batch without reviving authorization', async () => {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = 'false';
    const account = await createAccount('reactivation-batch-rollback');
    await env.DB.prepare('UPDATE users SET expires_at = 1 WHERE id = ?').bind(account.user.id).run();
    await enforceUser(env as unknown as Env, account.user.id, false);
    await env.DB.prepare('UPDATE users SET expires_at = NULL WHERE id = ?').bind(account.user.id).run();
    await env.DB.prepare(`CREATE TRIGGER test_fail_activation BEFORE UPDATE OF status ON devices
      WHEN OLD.id = '${account.device.id}' AND OLD.status = 'revoked' AND NEW.status = 'active'
      BEGIN SELECT RAISE(ABORT, 'TEST_REACTIVATION_ABORT'); END`).run();
    await expect(ensureDevice(env as unknown as Env, account.user.id, 'Phone', 'reactivation-batch-rollback-installation-one'))
      .rejects.toThrow('TEST_REACTIVATION_ABORT');
    expect(await env.DB.prepare('SELECT status, entitlement_suspended FROM devices WHERE id = ?')
      .bind(account.device.id).first()).toEqual({ status: 'revoked', entitlement_suspended: 1 });
    expect((await env.DB.prepare('SELECT COUNT(*) n FROM sessions WHERE device_id = ? AND revoked_at IS NULL')
      .bind(account.device.id).first<any>()).n).toBe(1);
    expect((await me(account.accessToken)).status).toBe(401);
    expect((await api('auth/refresh', json({ refreshToken: account.refreshToken }))).status).toBe(401);
    expect(await env.DB.prepare('SELECT 1 FROM device_exit_credentials WHERE device_id = ?')
      .bind(account.device.id).first()).toBeNull();
  });

});
