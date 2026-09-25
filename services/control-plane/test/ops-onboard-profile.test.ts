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
    // Nothing is bound before registration, so a disabled line does not block the grant.
    await db().prepare(
      `INSERT INTO home_exits(id, proxy_name, display_name, status, created_at, updated_at)
       VALUES('h-off', 'h-off', '家宽 Off', 'disabled', ?, ?)`,
    ).bind(NOW, NOW).run();
    const onboarded = await ops('users/onboard', json({
      email, wechatId: 'wxid_pending', contact: 'wechat-phone', notes: 'vip drawer', homeExitId: 'h-off',
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

  it('carries the onboard expiry and plan onto the account created at first sign-in', async () => {
    const email = 'pending-expiry@example.com';
    const expiresAt = 1_900_000_000;
    const onboarded = await ops('users/onboard', json({ email, expiresAt, plan: 'claude_20x' }));
    expect(onboarded.status).toBe(202);
    expect((await onboarded.json() as { pendingProfile: boolean }).pendingProfile).toBe(true);

    const started = await fetchApi('auth/email/start', json({
      email, deviceName: 'Primary Mac', installationId: 'pending-expiry-install',
    }));
    expect(started.status).toBe(202);
    const { challengeId } = await started.json() as { challengeId: string };
    const verified = await fetchApi('auth/email/verify', json({ challengeId, code: emailCodes.get(challengeId) }));
    expect(verified.status).toBe(200);
    const user = await db().prepare('SELECT expires_at, plan FROM users WHERE email = ?')
      .bind(email).first<{ expires_at: number | null; plan: string | null }>();
    expect(user).toEqual({ expires_at: expiresAt, plan: 'claude_20x' });

    // A first sign-in that creates the account after onboarding looked the
    // email up, copying the allowlist row before the expiry reached it.
    const raced = 'raced-expiry@example.com';
    await db().prepare(
      `CREATE TRIGGER test_onboard_signup_race AFTER INSERT ON signup_allowlist
       WHEN NEW.email = '${raced}'
       BEGIN
         INSERT INTO users(id, email, password_hash, password_salt, created_at, updated_at, expires_at, plan)
         VALUES('u-raced', NEW.email, 'x', 'y', NEW.created_at, NEW.created_at, NEW.expires_at, NEW.plan);
       END`,
    ).run();
    let racedBody: { userId: string | null };
    try {
      const racedOnboard = await ops('users/onboard', json({ email: raced, expiresAt, plan: 'claude_20x' }));
      expect(racedOnboard.status).toBe(202);
      racedBody = await racedOnboard.json() as { userId: string | null };
    } finally {
      await db().prepare('DROP TRIGGER IF EXISTS test_onboard_signup_race').run();
    }
    const racedUser = await db().prepare('SELECT expires_at, plan FROM users WHERE email = ?')
      .bind(raced).first<{ expires_at: number | null; plan: string | null }>();
    expect(racedUser).toEqual({ expires_at: expiresAt, plan: 'claude_20x' });
    // The answer and the audit name the account the expiry landed on.
    expect(racedBody.userId).toBe('u-raced');
    const audit = await db().prepare(
      "SELECT target_id FROM ops_audit WHERE action = 'user.onboard' AND summary LIKE ?",
    ).bind(`${raced}%`).first<{ target_id: string | null }>();
    expect(audit?.target_id).toBe('u-raced');
  });

  it('leaves the binding, catalog revision, profile and expiry untouched when the Claude account assignment fails', async () => {
    await seedUser('u-assigned', 'assigned@example.com');
    await db().prepare(
      `INSERT OR REPLACE INTO managed_exit_catalog(singleton_id, revision, ciphertext, nonce, content_sha256, updated_at)
       VALUES(1, 5, 'c', 'n', 's', ?)`,
    ).bind(NOW).run();
    await db().prepare(
      `INSERT INTO home_exits(id, proxy_name, display_name, status, created_at, updated_at)
       VALUES('h-assign', 'h-assign', '家宽 Assign', 'active', ?, ?)`,
    ).bind(NOW, NOW).run();
    const first = await ops('users/onboard', json({ email: 'assigned@example.com', accountRef: 'acct-a@example.com' }));
    expect(first.status).toBe(200);
    const failed = await ops('users/onboard', json({
      email: 'assigned@example.com', accountRef: 'acct-b@example.com', homeExitId: 'h-assign',
      expiresAt: 1_900_000_000, notes: 'lost',
    }));
    expect(failed.status).toBe(409);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe('PRODUCT_ALREADY_ASSIGNED');
    const row = await db().prepare('SELECT expires_at, notes FROM users WHERE id = ?')
      .bind('u-assigned').first<{ expires_at: number | null; notes: string | null }>();
    expect(row).toEqual({ expires_at: null, notes: null });
    expect(await db().prepare("SELECT 1 FROM user_home_bindings WHERE user_id = 'u-assigned'").first()).toBeNull();
    expect(Number((await db().prepare('SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1')
      .first<{ revision: number }>())!.revision)).toBe(5);
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
