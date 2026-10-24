import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { rateLimitTelemetry } from '../src/ops/ingest-limits';
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
});
