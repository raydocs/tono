import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { assertCustomerDetail } from '../src/ops/contract';

const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
const ACCESS_AUDIENCE = 'test-access-audience-0001';
const ACCESS_ADMIN_EMAIL = 'operator@example.com';
const OIDC_KEY_ID = 'test-oidc-key';
const NOW = 1_800_000_000;

let oidcPrivateKey: CryptoKey;
let oidcPublicKey: JsonWebKey & { kid: string };
const emailCodes = new Map<string, string>();

const base64URL = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessAssertion(accessEmail: string) {
  const encode = (value: object) => base64URL(new TextEncoder().encode(JSON.stringify(value)));
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: OIDC_KEY_ID });
  const payload = encode({
    iss: `https://${ACCESS_TEAM_DOMAIN}`,
    aud: ACCESS_AUDIENCE,
    sub: `access-user-${accessEmail}`,
    email: accessEmail,
    iat: issuedAt,
    exp: issuedAt + 300,
  });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    oidcPrivateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64URL(new Uint8Array(signature))}`;
}

async function fetchApi(path: string, init: RequestInit = {}) {
  const context = createExecutionContext();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await worker.fetch(
    new Request(`https://test/api/v1/${path}`, { ...init, headers }),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

async function ops(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('cf-access-jwt-assertion')) {
    headers.set('cf-access-jwt-assertion', await accessAssertion(ACCESS_ADMIN_EMAIL));
  }
  return fetchApi(`ops/${path}`, { ...init, headers });
}

const json = (value: unknown, method = 'POST'): RequestInit => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
});

const db = () => (env as unknown as { DB: D1Database }).DB;

async function seedUser(id = 'u-1', email = 'a@example.com') {
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'y', 'active', 0, ?, ?)`,
  ).bind(id, email, NOW, NOW).run();
}

describe('ops onboard pending profile', () => {
  beforeAll(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify'],
    ) as CryptoKeyPair;
    oidcPrivateKey = keyPair.privateKey;
    oidcPublicKey = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), kid: OIDC_KEY_ID, use: 'sig', alg: 'RS256' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url === `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return Response.json({ keys: [oidcPublicKey] }, { headers: { 'cache-control': 'public, max-age=300' } });
      }
      if (request.url === 'https://api.resend.com/emails' && request.method === 'POST') {
        const payload = JSON.parse(await request.text()) as { text?: string };
        const code = String(payload.text ?? '').match(/\b(\d{6})\b/)?.[1];
        const challenge = request.headers.get('idempotency-key');
        if (!code || !challenge) return new Response('invalid email payload', { status: 400 });
        emailCodes.set(challenge, code);
        return Response.json({ id: `email-${challenge}` });
      }
      if (request.url.endsWith('/oauth/token')) {
        return Response.json({ access_token: 'mock-oauth' });
      }
      if (request.url.includes('/keys') && request.method === 'POST') {
        return Response.json({ key: 'tskey-mock-onboard', expires: '2099-01-01T00:00:00Z' });
      }
      return new Response(null, { status: 404 });
    });
  });

  beforeEach(() => {
    emailCodes.clear();
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    (env as unknown as Env).ACCESS_AUD = ACCESS_AUDIENCE;
    (env as unknown as Env).ACCESS_ADMIN_EMAILS = ACCESS_ADMIN_EMAIL;
    (env as unknown as Env & { OPS_CONTRACT_STRICT?: string }).OPS_CONTRACT_STRICT = '1';
  });

  it('stores wechatId/contact/notes on the allowlist until the customer registers', async () => {
    const email = 'pending-profile@example.com';
    const onboarded = await ops('users/onboard', json({
      email, wechatId: 'wxid_pending', contact: 'wechat-phone', notes: 'vip drawer',
    }));
    expect(onboarded.status).toBe(202);
    const onboardBody = await onboarded.json() as {
      pendingProfile: boolean;
      userId: string | null;
      allowlisted: boolean;
      incomplete: string[];
    };
    expect(onboardBody.pendingProfile).toBe(true);
    expect(onboardBody.userId).toBeNull();
    expect(onboardBody.allowlisted).toBe(true);
    expect(onboardBody.incomplete).toContain('user_not_registered');
    const allowlist = await db().prepare(
      'SELECT wechat_id, contact, notes FROM signup_allowlist WHERE email = ?',
    ).bind(email).first<{ wechat_id: string; contact: string; notes: string }>();
    expect(allowlist).toEqual({
      wechat_id: 'wxid_pending', contact: 'wechat-phone', notes: 'vip drawer',
    });

    const started = await fetchApi('auth/email/start', json({
      email, deviceName: 'Primary Mac', installationId: 'pending-profile-install',
    }));
    expect(started.status).toBe(202);
    const startedBody = await started.json() as { challengeId: string };
    const code = emailCodes.get(startedBody.challengeId);
    expect(code).toMatch(/^\d{6}$/);
    const verified = await fetchApi('auth/email/verify', json({
      challengeId: startedBody.challengeId, code,
    }));
    expect(verified.status).toBe(200);
    const verifiedBody = await verified.json() as { user: { id: string } };
    const detail = assertCustomerDetail(await (await ops(`customers/${verifiedBody.user.id}`)).json());
    expect(detail.wechatId).toBe('wxid_pending');
    expect(detail.contact).toBe('wechat-phone');
    expect(detail.notes).toBe('vip drawer');
  });

  it('does not allowlist an email when wechatId is too long', async () => {
    const email = 'too-long-wechat@example.com';
    const onboarded = await ops('users/onboard', json({
      email, wechatId: 'a'.repeat(65),
    }));
    expect(onboarded.status).toBe(400);
    const row = await db().prepare(
      'SELECT email FROM signup_allowlist WHERE email = ?',
    ).bind(email).first<{ email: string }>();
    expect(row).toBeNull();
  });

  it('onboards an already-registered user onto users with pendingProfile false', async () => {
    await seedUser('u-1', 'a@example.com');
    const onboarded = await ops('users/onboard', json({
      email: 'a@example.com', wechatId: 'wxid_ready', contact: 'ready-phone', notes: 'already here',
    }));
    expect([200, 202]).toContain(onboarded.status);
    const onboardBody = await onboarded.json() as { pendingProfile: boolean; userId: string | null };
    expect(onboardBody.pendingProfile).toBe(false);
    expect(onboardBody.userId).toBe('u-1');
    const detail = assertCustomerDetail(await (await ops('customers/u-1')).json());
    expect(detail.wechatId).toBe('wxid_ready');
    expect(detail.contact).toBe('ready-phone');
    expect(detail.notes).toBe('already here');
    const allowlist = await db().prepare(
      'SELECT wechat_id, contact, notes FROM signup_allowlist WHERE email = ?',
    ).bind('a@example.com').first<{ wechat_id: string | null; contact: string | null; notes: string | null }>();
    expect(allowlist?.wechat_id ?? null).toBeNull();
    expect(allowlist?.contact ?? null).toBeNull();
    expect(allowlist?.notes ?? null).toBeNull();
  });
});
