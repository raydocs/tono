import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { rateLimitTelemetry } from '../src/ops/ingest-limits';
import { sha256 } from '../src/crypto';
import { type Env } from '../src/env';
import { api, json, createAccount, useWorkerHarness } from './worker-harness';

const bundle = (code: string) => ({
  schemaVersion: 1, aiServicesConsent: false,
  client: { appVersion: '0.0.75', platform: 'macos', osVersion: 'macOS 26' },
  events: [{ ts: Date.now(), kind: 'killSwitchFail', code, stage: 'restore', node: 'exit-default' }],
});

describe('P0 ingestion is independent of failure storms', () => {
  useWorkerHarness();
  it('writes a P0 event after the FAILURE account bucket is full', async () => {
    const account = await createAccount('p0-independent');
    const e = env as unknown as Env;
    for (let i = 0; i < 12; i++) await rateLimitTelemetry(e, account.user.id, 'FAILURE');
    await expect(rateLimitTelemetry(e, account.user.id, 'FAILURE')).rejects.toMatchObject({ status: 429 });
    const response = await api('telemetry/diagnostics', json(bundle('TONO_NETWORK_LOSS'), account.accessToken));
    expect(response.status).toBe(202);
    expect(await env.DB.prepare("SELECT code FROM connection_events WHERE user_id = ? AND code = 'TONO_NETWORK_LOSS'")
      .bind(account.user.id).first()).toMatchObject({ code: 'TONO_NETWORK_LOSS' });
  });
  it('returns bounded Retry-After for a full P0 bucket and does not write the rejected event', async () => {
    const account = await createAccount('p0-retry');
    for (let i = 0; i < 24; i++) {
      expect((await api('telemetry/diagnostics', json(bundle('TONO_NETWORK_LOSS'), account.accessToken))).status).toBe(202);
    }
    const response = await api('telemetry/diagnostics', json(bundle('TONO_NETWORK_LOSS'), account.accessToken));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(Number(response.headers.get('Retry-After'))).toBeLessThanOrEqual(3600);
    expect((await env.DB.prepare('SELECT COUNT(*) n FROM connection_events WHERE user_id = ?')
      .bind(account.user.id).first<any>()).n).toBe(24);
  });
  it('returns the actual remaining login window in Retry-After', async () => {
    const t = Math.floor(Date.now() / 1000);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t * 1000);
    try {
      await env.DB.prepare('INSERT INTO rate_limits(key, count, window_start) VALUES(?, ?, ?)')
        .bind(`rl:${await sha256('email-start:ip:0.0.0.0')}`, 50, t - 123).run();
      const response = await api('auth/email/start', json({
        email: 'retry-window@example.com', deviceName: 'Phone', installationId: 'retry-window-phone',
      }));
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('777');
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects a null diagnostics root as a validation error without storing events', async () => {
    const account = await createAccount('invalid-diagnostics-root');
    const response = await api('telemetry/diagnostics', json(null, account.accessToken));
    expect(response.status).toBe(400);
    expect((await env.DB.prepare('SELECT COUNT(*) n FROM connection_events WHERE user_id = ?')
      .bind(account.user.id).first<any>()).n).toBe(0);
  });

});
