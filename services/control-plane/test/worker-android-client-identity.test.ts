import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { api, json, nextSequence, startEmailSignIn, useWorkerHarness } from './worker-harness';

describe('Android client build metadata', () => {
  useWorkerHarness();

  it('records only the authenticated device build without turning metadata failures into auth failures', async () => {
    const asAndroid = (init: RequestInit, version: string): RequestInit => ({
      ...init, headers: { ...init.headers as Record<string, string>, 'x-tono-client': `android/${version}` },
    });
    const started = await startEmailSignIn({
      email: `android-build-${nextSequence()}@example.com`,
      deviceName: 'Android test phone',
      installationId: 'android-client-build-installation',
    });
    const signedIn = await api('auth/email/verify', asAndroid(json({
      challengeId: started.challengeId, code: started.code,
    }), '0.0.1'));
    expect(signedIn.status).toBe(200);
    const account = await signedIn.json() as any;
    const build = () => env.DB.prepare('SELECT client_platform, client_version FROM devices WHERE id = ?')
      .bind(account.device.id).first();
    expect(await build()).toEqual({ client_platform: 'android', client_version: '0.0.1' });

    const refreshed = await api('auth/refresh', asAndroid(json({ refreshToken: account.refreshToken }), '0.0.2'));
    expect(refreshed.status).toBe(200);
    const tokens = await refreshed.json() as any;
    expect(await build()).toEqual({ client_platform: 'android', client_version: '0.0.2' });
    const catalog = (client?: string, accessToken = tokens.accessToken) => api('exit-catalog', {
      headers: { authorization: `Bearer ${accessToken}`, ...(client === undefined ? {} : { 'x-tono-client': client }) },
    });
    expect((await catalog('android/0.0.3')).status).toBe(200);
    expect(await build()).toEqual({ client_platform: 'android', client_version: '0.0.3' });
    expect((await catalog('android/0.0.4 user@example.com')).status).toBe(200);
    expect((await catalog(`android/${'1'.repeat(41)}`)).status).toBe(200);
    expect((await catalog('ios/0.0.4')).status).toBe(200);
    expect((await catalog('linux/0.0.4')).status).toBe(200);
    expect((await catalog()).status).toBe(200);
    expect((await catalog('android/9.9.9', 'not-an-access-token')).status).toBe(401);
    expect(await build()).toEqual({ client_platform: 'android', client_version: '0.0.3' });

    // Recording is best effort even after a refresh has already rotated its token.
    await env.DB.prepare(`CREATE TRIGGER test_android_build_write_failure BEFORE UPDATE OF client_version ON devices
      BEGIN SELECT RAISE(FAIL, 'injected metadata failure'); END`).run();
    try {
      const retry = await api('auth/refresh', asAndroid(json({ refreshToken: tokens.refreshToken }), '0.0.4'));
      expect(retry.status).toBe(200);
      const rotated = await retry.json() as any;
      expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
      expect((await catalog('android/0.0.4', rotated.accessToken)).status).toBe(200);
      expect(await build()).toEqual({ client_platform: 'android', client_version: '0.0.3' });
    } finally {
      await env.DB.prepare('DROP TRIGGER test_android_build_write_failure').run();
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM telemetry_windows').first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM diagnostics_reports').first()).toEqual({ n: 0 });
  });
});
