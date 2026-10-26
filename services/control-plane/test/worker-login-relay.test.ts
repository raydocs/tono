import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { rateLimitEmailStart, rateLimitChallenge, rateLimitOidcStart } from '../src/login';
import { type Env } from '../src/env';
import { useWorkerHarness } from './worker-harness';

const request = (ip: string, forwarded = 'attacker-chosen') => new Request('https://test/', {
  headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': forwarded, 'x-tono-client-id': forwarded },
});

describe('relay login budgets', () => {
  useWorkerHarness();
  it('separates relay email budgets without letting device rotation evade the email cap', async () => {
    const e = { ...env, RATE_LIMIT_EMAIL_START_IP: '1', RATE_LIMIT_EMAIL_START_EMAIL: '2' } as unknown as Env;
    await rateLimitEmailStart(e, request('179.253.233.220'), 'one@example.com');
    await expect(rateLimitEmailStart(e, request('179.253.233.220'), 'two@example.com')).resolves.toBeUndefined();
    await rateLimitEmailStart(e, request('179.253.233.220', 'device-two'), 'one@example.com');
    await expect(rateLimitEmailStart(e, request('179.253.233.220', 'device-three'), 'one@example.com'))
      .rejects.toMatchObject({ status: 429 });
  });
  it('preserves the direct IP budget despite spoofed relay/client forwarding headers', async () => {
    const e = { ...env, RATE_LIMIT_EMAIL_START_IP: '1' } as unknown as Env;
    await rateLimitEmailStart(e, request('203.0.113.1', '179.253.233.220'), 'one@example.com');
    await expect(rateLimitEmailStart(e, request('203.0.113.1', 'device-two'), 'two@example.com'))
      .rejects.toMatchObject({ status: 429 });
  });
  it('separates relay verification by challenge while retaining the challenge cap', async () => {
    const e = { ...env, RATE_LIMIT_EMAIL_VERIFY_IP: '1', RATE_LIMIT_EMAIL_VERIFY_CHALLENGE: '1' } as unknown as Env;
    await rateLimitChallenge(e, request('179.253.233.220'), 'email-verify', 'challenge-one');
    await expect(rateLimitChallenge(e, request('179.253.233.220'), 'email-verify', 'challenge-two')).resolves.toBeUndefined();
    await expect(rateLimitChallenge(e, request('179.253.233.220', 'other-device'), 'email-verify', 'challenge-one'))
      .rejects.toMatchObject({ status: 429 });
  });
  it('separates relay OIDC starts by installation without bypassing installation caps', async () => {
    const e = { ...env, RATE_LIMIT_OIDC_START_IP: '1', RATE_LIMIT_OIDC_START_INSTALLATION: '1' } as unknown as Env;
    await rateLimitOidcStart(e, request('179.253.233.220'), 'installation-one');
    await expect(rateLimitOidcStart(e, request('179.253.233.220'), 'installation-two')).resolves.toBeUndefined();
    await expect(rateLimitOidcStart(e, request('179.253.233.220'), 'installation-one')).rejects.toMatchObject({ status: 429 });
  });
  it('bounds the aggregate writes from each relay across login kinds and identities', async () => {
    const e = { ...env, RATE_LIMIT_RELAY_AUTH_IP: '2' } as unknown as Env;
    await rateLimitEmailStart(e, request('179.253.233.220'), 'aggregate-one@example.com');
    await rateLimitOidcStart(e, request('179.253.233.220'), 'aggregate-installation');
    await expect(rateLimitChallenge(e, request('179.253.233.220'), 'oidc-verify', 'aggregate-challenge'))
      .rejects.toMatchObject({ status: 429, extra: { retryAfterSeconds: expect.any(Number) } });
    await expect(rateLimitEmailStart(e, request('179.255.154.17'), 'aggregate-two@example.com')).resolves.toBeUndefined();
  });

});
