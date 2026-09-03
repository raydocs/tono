import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtSign } from '../src/crypto';
import worker, { parseBytesRange, retirementCatalogPlan, type Env } from '../src/index';
import adminWorker from '../src/admin-worker';

const ADMIN_TOKEN = 'admin-test-token-with-at-least-32-characters';
const HOME_TOKEN = 'home-test-token-with-at-least-32-characters';
const JWT_TEST_SECRET = 'test-jwt-secret-with-at-least-32-characters';

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
const json = (value: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(value),
});
const routingResearchJson = async (
  value: unknown,
  token: string,
  userId: string,
): Promise<RequestInit> => {
  const owner = Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(userId),
  ))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const init = json(value, token);
  return {
    ...init,
    headers: {
      ...init.headers as Record<string, string>,
      'x-tono-routing-owner': owner,
    },
  };
};
const admin = (path: string, value?: unknown, method = 'POST') => api(`admin/${path}`, {
  ...(value === undefined ? {} : json(value)), method,
  headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
});

/** Deliberately distinct Tailscale identity values (production mismatch case). */
const MGMT_ID = 'mgmt-abc';
const API_NODE_ID = 'nodeid-xyz';
const STABLE_ID = 'stable-n123';
const PUBLIC_KEY = 'public-key-123';
const TS_IPS = ['100.64.0.10'];
const OIDC_KEY_ID = 'test-oidc-key';
const GOOGLE_AUDIENCE = 'test-google-client.apps.googleusercontent.com';
const APPLE_AUDIENCE = 'com.raydocs.tono';
const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
const ACCESS_AUDIENCE = 'test-access-audience-0001';
const ACCESS_ADMIN_EMAIL = 'operator@example.com';

let sequence = 0;
const tailscaleRequests: string[] = [];
const emailCodes = new Map<string, string>();
// `admin-worker.ts` answers these hostnames with a 302 to the console, so a
// fetch of one can only ever return HTML. Recording instead of stubbing means
// a reintroduced fallback fails a test rather than silently timing out twice
// in production.
const ABSORBED_HOSTS = ['ops.afk.ccwu.cc', 'quality.afk.ccwu.cc'];
const ADMIN_MONITOR_URL = 'https://admin.afk.ccwu.cc/ops/#/monitor';
let absorbedHostFetches: string[] = [];
let oidcPrivateKey: CryptoKey;
let oidcPublicKey: JsonWebKey & { kid: string };

async function accessAssertion(
  accessEmail: string,
  claimOverrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
) {
  const encode = (value: object) => base64URL(new TextEncoder().encode(JSON.stringify(value)));
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: OIDC_KEY_ID, ...headerOverrides });
  const payload = encode({
    iss: `https://${ACCESS_TEAM_DOMAIN}`,
    aud: ACCESS_AUDIENCE,
    sub: `access-user-${accessEmail}`,
    email: accessEmail,
    iat: issuedAt,
    exp: issuedAt + 300,
    ...claimOverrides,
  });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    oidcPrivateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64URL(new Uint8Array(signature))}`;
}

async function operations(path: string, accessEmail = ACCESS_ADMIN_EMAIL, method = 'GET') {
  return api(`ops/${path}`, {
    method,
    headers: { 'cf-access-jwt-assertion': await accessAssertion(accessEmail) },
  });
}

/** In-memory mock inventory; tags mutate after promotion. */
const mockInventory: Array<{
  id: string;
  nodeId: string;
  name: string;
  nodeKey: string;
  stableNodeId?: string;
  addresses: string[];
  tags: string[];
  description?: string;
}> = [];

function resetMockInventory(
  deviceIdForDesc?: string,
  enrollmentHostname = 'tono-00000000000000000000000000000000',
) {
  mockInventory.length = 0;
  mockInventory.push({
    id: MGMT_ID,
    nodeId: API_NODE_ID,
    name: enrollmentHostname,
    nodeKey: `nodekey:${PUBLIC_KEY}`,
    addresses: [...TS_IPS],
    tags: ['tag:pending-tunnel-client'],
    description: deviceIdForDesc ? `tono-device-${deviceIdForDesc}` : undefined,
  });
}

let failNextTagPromotion = false;
let failNextKeyIssue = false;
let failNextDelete = false;
let tagPromotionGate: Promise<void> | undefined;
let releaseTagPromotion: (() => void) | undefined;
let notifyTagPromotionStarted: (() => void) | undefined;

function pauseNextTagPromotion() {
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  notifyTagPromotionStarted = startedResolve;
  tagPromotionGate = new Promise<void>((resolve) => { releaseTagPromotion = resolve; });
  return {
    started,
    release() {
      releaseTagPromotion?.();
      releaseTagPromotion = undefined;
    },
  };
}

async function createAccount(prefix: string) {
  const email = `${prefix}-${++sequence}@example.com`;
  const response = await emailSignIn({
    email,
    deviceName: 'Primary Mac',
    installationId: `${prefix}-installation-one`,
  });
  expect(response.status).toBe(200);
  return { email, ...(await response.json() as any) };
}

async function startEmailSignIn(body: {
  email: string;
  deviceName: string;
  installationId: string;
}) {
  const response = await api('auth/email/start', json(body));
  const payload = await response.json() as any;
  return {
    response,
    challengeId: payload.challengeId as string,
    code: emailCodes.get(payload.challengeId as string),
  };
}

async function emailSignIn(body: {
  email: string;
  deviceName: string;
  installationId: string;
}) {
  const started = await startEmailSignIn(body);
  if (started.response.status !== 202 || !started.code) return started.response;
  return api('auth/email/verify', json({
    challengeId: started.challengeId,
    code: started.code,
  }));
}

function base64URL(value: Uint8Array): string {
  let raw = '';
  for (const byte of value) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function oidcToken(
  provider: 'apple' | 'google',
  nonce: string,
  options: { subject?: string; email?: string; audience?: string } = {},
) {
  const timestamp = Math.floor(Date.now() / 1_000);
  const header = base64URL(new TextEncoder().encode(JSON.stringify({
    alg: 'RS256',
    kid: OIDC_KEY_ID,
    typ: 'JWT',
  })));
  const payload = base64URL(new TextEncoder().encode(JSON.stringify({
    iss: provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com',
    aud: options.audience ?? (provider === 'apple' ? APPLE_AUDIENCE : GOOGLE_AUDIENCE),
    sub: options.subject ?? `${provider}-subject-${sequence}`,
    email: options.email ?? `${provider}-${sequence}@example.com`,
    email_verified: true,
    nonce,
    iat: timestamp,
    exp: timestamp + 300,
  })));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    oidcPrivateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64URL(new Uint8Array(signature))}`;
}

async function confirm(
  auth: any,
  body: {
    stableNodeId?: string;
    nodeId?: string;
    publicKey?: string;
    tailscaleIPs?: string[];
  } = {},
) {
  const response = await api(`devices/${auth.device.id}/confirm`, json({
    stableNodeId: body.stableNodeId ?? STABLE_ID,
    ...(body.nodeId !== undefined ? { nodeId: body.nodeId } : {}),
    publicKey: body.publicKey ?? PUBLIC_KEY,
    tailscaleIPs: body.tailscaleIPs ?? TS_IPS,
  }, auth.accessToken));
  return response;
}

describe('Worker routes with D1 and mocked Tailscale', () => {
  beforeAll(async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    ) as CryptoKeyPair;
    oidcPrivateKey = keyPair.privateKey;
    oidcPublicKey = {
      ...await crypto.subtle.exportKey('jwk', keyPair.publicKey),
      kid: OIDC_KEY_ID,
      use: 'sig',
      alg: 'RS256',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = request.url;
      const method = request.method;
      const requestBody = request.body
        ? new TextDecoder().decode(await request.arrayBuffer())
        : '';

      if (url === 'https://api.resend.com/emails' && method === 'POST') {
        const payload = JSON.parse(requestBody) as any;
        const code = String(payload.text ?? '').match(/\b(\d{6})\b/)?.[1];
        const challenge = request.headers.get('idempotency-key');
        if (!code || !challenge) return new Response('invalid email payload', { status: 400 });
        emailCodes.set(challenge, code);
        return Response.json({ id: `email-${challenge}` });
      }

      if (
        (url === 'https://www.googleapis.com/oauth2/v3/certs' ||
          url === 'https://appleid.apple.com/auth/keys' ||
          url === `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) &&
        method === 'GET'
      ) {
        return Response.json(
          { keys: [oidcPublicKey] },
          { headers: { 'cache-control': 'public, max-age=300' } },
        );
      }

      if (ABSORBED_HOSTS.includes(new URL(url).hostname)) {
        absorbedHostFetches.push(`${method} ${url}`);
        return new Response(null, { status: 302, headers: { location: ADMIN_MONITOR_URL } });
      }

      tailscaleRequests.push(`${method} ${url} ${requestBody}`);

      if (url.endsWith('/oauth/token')) {
        return Response.json({ access_token: 'mock-oauth' });
      }

      if (url.includes('/keys') && method === 'POST') {
        if (failNextKeyIssue) {
          failNextKeyIssue = false;
          return new Response('key failure', { status: 500 });
        }
        return Response.json({ key: `tskey-mock-${++sequence}`, expires: '2099-01-01T00:00:00Z' });
      }

      // Inventory list — primary resolution path
      if (url.includes('/tailnet/') && url.includes('/devices') && method === 'GET') {
        return Response.json({ devices: mockInventory });
      }

      // Tag promotion / delete must use management id only
      if (url.includes(`/device/${encodeURIComponent(MGMT_ID)}/tags`) && method === 'POST') {
        if (failNextTagPromotion) {
          failNextTagPromotion = false;
          return new Response('tag failure', { status: 500 });
        }
        if (tagPromotionGate) {
          notifyTagPromotionStarted?.();
          const gate = tagPromotionGate;
          tagPromotionGate = undefined;
          notifyTagPromotionStarted = undefined;
          await gate;
        }
        const device = mockInventory.find((d) => d.id === MGMT_ID);
        if (device) device.tags = ['tag:tunnel-client'];
        return new Response(null, { status: 200 });
      }

      if (url.includes(`/device/${encodeURIComponent(MGMT_ID)}`) && method === 'DELETE') {
        if (failNextDelete) {
          failNextDelete = false;
          return new Response('delete failure', { status: 500 });
        }
        const idx = mockInventory.findIndex((d) => d.id === MGMT_ID);
        if (idx >= 0) mockInventory.splice(idx, 1);
        return new Response(null, { status: 204 });
      }

      // Reject legacy client-id GET path used with wrong identifiers
      if (url.includes('/device/') && method === 'GET') {
        return new Response(null, { status: 404 });
      }

      if (url.includes('/device/') && method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      if (url.includes('/device/') && url.includes('/tags') && method === 'POST') {
        return new Response(null, { status: 200 });
      }

      return new Response(null, { status: 404 });
    });
  });

  beforeEach(async () => {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = 'true';
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    (env as unknown as Env).ACCESS_AUD = ACCESS_AUDIENCE;
    (env as unknown as Env).ACCESS_ADMIN_EMAILS = ACCESS_ADMIN_EMAIL;
    releaseTagPromotion?.();
    tailscaleRequests.length = 0;
    emailCodes.clear();
    failNextTagPromotion = false;
    failNextKeyIssue = false;
    failNextDelete = false;
    tagPromotionGate = undefined;
    releaseTagPromotion = undefined;
    notifyTagPromotionStarted = undefined;
    resetMockInventory();
    // Rate-limit counters persist in D1 across tests; reset so limits stay isolated
    await env.DB.prepare('DELETE FROM rate_limits').run();
  });

  it('sets defensive response headers and rejects an empty bearer token', async () => {
    const health = await api('health');
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');

    const preflight = await api('health', {
      method: 'OPTIONS',
      headers: { origin: String((env as unknown as Env).ALLOWED_ORIGIN) },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');

    const empty = await api('admin/users', {
      headers: { authorization: 'Bearer ' },
    });
    expect(empty.status).toBe(401);
  });

  it('keeps non-operations routes unreachable on the dedicated admin worker', async () => {
    for (const path of ['/api/v1/health', '/api/v1/admin/users', '/api/v1/diagnostics/reports']) {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request(`https://admin.afk.ccwu.cc${path}`),
        env as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('only reports API/admin builds aligned when both carry the same release SHA', async () => {
    const version = async (apiBuildSha: string | undefined, adminBuildSha: string | undefined) => {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request('https://admin.afk.ccwu.cc/api/v1/ops/system/version'),
        {
          API: {
            fetch: async () => Response.json({
              system: { service: 'api', version: '0.0.1', buildSha: apiBuildSha ?? 'development' },
            }),
          } as unknown as Fetcher,
          BUILD_SHA: adminBuildSha,
        } as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      return response.json() as Promise<{ system: { aligned: boolean } }>;
    };
    const same = 'a'.repeat(40);
    const other = 'b'.repeat(40);

    expect((await version(undefined, undefined)).system.aligned).toBe(false);
    expect((await version(same, undefined)).system.aligned).toBe(false);
    expect((await version(same, other)).system.aligned).toBe(false);
    expect((await version(same, same)).system.aligned).toBe(true);
  });

  it('serves an isolated release archive on the release subdomain', async () => {
    const fetchRelease = async (path: string, init: RequestInit = {}) => {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request(`https://releases.afk.ccwu.cc${path}`, init),
        env as unknown as Env,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    };

    const page = await fetchRelease('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('location')).toBeNull();
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("img-src 'self' data:");
    expect(page.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(await page.text()).toContain('Tono 发布档案');

    const sitemap = await fetchRelease('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain('https://releases.afk.ccwu.cc/help');

    const robots = await fetchRelease('/robots.txt');
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain('Sitemap: https://releases.afk.ccwu.cc/sitemap.xml');

    const security = await fetchRelease('/.well-known/security.txt');
    expect(security.status).toBe(200);
    expect(await security.text()).toContain('Canonical: https://releases.afk.ccwu.cc/.well-known/security.txt');

    for (const path of ['/help', '/status', '/archive', '/favicon.svg']) {
      expect((await fetchRelease(path)).status).toBe(200);
    }

    const canonicalPage = await fetchRelease('/releases/');
    expect(canonicalPage.status).toBe(200);
    expect(await canonicalPage.text()).toContain('Tono 发布档案');

    const manifest = await fetchRelease('/manifest.json');
    expect(manifest.status).toBe(200);
    const manifestBody = (await manifest.json()) as {
      schemaVersion: number;
      channel: string;
      platforms: Record<
        string,
        { current: { version: string; artifact: { url: string; sha256: string; size: number } } }
      >;
      archive: Array<{ platform: string; version: string; publishedAt: string }>;
    };
    expect(manifestBody).toMatchObject({ schemaVersion: 1, channel: 'test' });

    // Pinned versions used to live here, which made this test a step in the
    // release checklist that nobody remembers — the same mistake the appcast
    // assertion below already avoids. What is worth catching is a manifest that
    // disagrees with itself, because it is edited by hand in two places: the
    // card a customer reads and the archive entry beneath it. So each platform's
    // current version must be its newest archive entry, and must be the version
    // whose file it actually offers.
    for (const platform of ['macos', 'windows']) {
      const current = manifestBody.platforms[platform].current;
      const newest = manifestBody.archive
        .filter((entry) => entry.platform === platform)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
      expect(newest).toBeDefined();
      expect(newest.version).toBe(current.version);
      expect(current.artifact.url).toContain(current.version);
      expect(current.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(current.artifact.size).toBeGreaterThan(0);
    }

    // Every Windows build from 0.0.33 asks this host for its update metadata,
    // because the address it used to ask — raw.githubusercontent.com — is
    // blocked in mainland China, so the updater could only find a release while
    // the tunnel it might be needed to fix was already carrying traffic. The
    // path is an explicit entry in the release host's allowlist, so forgetting
    // it 404s every updater at once; that is what this asserts.
    const channel = await fetchRelease('/windows/latest.json');
    expect(channel.status).toBe(200);
    const channelBody = (await channel.json()) as {
      version: string;
      platforms: Record<string, { url: string; signature: string }>;
    };
    expect(channelBody.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const platform of Object.values(channelBody.platforms)) {
      expect(platform.url).toContain(channelBody.version);
      // An unsigned payload is one tauri-plugin-updater refuses, so serving one
      // would be an update nobody can install rather than a visible failure.
      expect(platform.signature.length).toBeGreaterThan(0);
    }

    // Asserted against the file this deploy would publish, not against a build
    // number. Pinning a number couples every release to this test, and it broke
    // the moment the feed was corrected — which is the wrong thing to notice
    // about a release: what matters here is that the subdomain serves the feed at
    // all, and serves the one on disk.
    const appcast = await fetchRelease('/macos/appcast.xml');
    expect(appcast.status).toBe(200);
    const servedFeed = await appcast.text();
    expect(servedFeed).toContain('<rss');
    expect(servedFeed).toContain('sparkle:version');
    // The alias must serve the same document as the canonical path. That is the
    // property worth holding: these two diverging is how a client updates from a
    // feed nobody thinks is live, and it is what the cache-busting fix was for.
    const canonicalFeed = await fetchRelease('/appcast.xml');
    expect(canonicalFeed.status).toBe(200);
    expect(await canonicalFeed.text()).toBe(servedFeed);

    expect((await fetchRelease('/api/v1/health')).status).toBe(404);
    const rejected = await fetchRelease('/manifest.json', { method: 'POST' });
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get('allow')).toBe('GET, HEAD');

    await (env as unknown as Env).RELEASES.put('Tono_range.bin', 'abcdefghij');
    const ranged = await fetchRelease('/download/Tono_range.bin', {
      headers: { range: 'bytes=2-5' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('accept-ranges')).toBe('bytes');
    expect(ranged.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await ranged.text()).toBe('cdef');
  });

  it('parses a single byte range and rejects the rest', () => {
    expect(parseBytesRange('bytes=0-0', 10)).toEqual({ offset: 0, length: 1 });
    expect(parseBytesRange('bytes=2-5', 10)).toEqual({ offset: 2, length: 4 });
    expect(parseBytesRange('bytes=8-', 10)).toEqual({ offset: 8, length: 2 });
    expect(parseBytesRange('bytes=-3', 10)).toEqual({ offset: 7, length: 3 });
    expect(parseBytesRange('bytes=0-99', 10)).toEqual({ offset: 0, length: 10 });
    expect(parseBytesRange('bytes=10-12', 10)).toBeNull();
    expect(parseBytesRange('bytes=5-2', 10)).toBeNull();
    expect(parseBytesRange('bytes=0-1,2-3', 10)).toBeNull();
    expect(parseBytesRange(null, 10)).toBeNull();
  });

  it('does not report success when an admin patches a missing user', async () => {
    const response = await admin(`users/${crypto.randomUUID()}`, { status: 'disabled' }, 'PATCH');
    expect(response.status).toBe(404);
    expect((await response.json() as any).error.code).toBe('NOT_FOUND');
  });

  it('fails the operations boundary closed and never accepts the legacy admin token', async () => {
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = undefined;
    const unconfigured = await api('ops/dashboard', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unconfigured.status).toBe(503);
    expect((await unconfigured.json() as any).error.code).toBe('ACCESS_MISCONFIGURED');

    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    for (const method of ['GET', 'OPTIONS']) {
      const legacyTokenOnly = await api('ops/dashboard', {
        method,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(legacyTokenOnly.status).toBe(401);
      expect((await legacyTokenOnly.json() as any).error.code).toBe('ACCESS_UNAUTHORIZED');
    }

    const staticContext = createExecutionContext();
    const staticWithoutAccess = await worker.fetch(
      new Request('https://test/ops/', { method: 'OPTIONS' }),
      env as unknown as Env,
      staticContext,
    );
    await waitOnExecutionContext(staticContext);
    expect(staticWithoutAccess.status).toBe(401);

    const nonAdmin = await operations('dashboard', 'viewer@example.com');
    expect(nonAdmin.status).toBe(403);
    expect((await nonAdmin.json() as any).error.code).toBe('ACCESS_FORBIDDEN');

    const currentTime = Math.floor(Date.now() / 1_000);
    const invalidAssertions = [
      'not-a-jwt',
      await accessAssertion(ACCESS_ADMIN_EMAIL, { iss: 'https://wrong.cloudflareaccess.com' }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, { aud: 'wrong-access-audience' }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, { exp: currentTime - 1 }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, { iat: currentTime + 120 }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, { nbf: currentTime + 120 }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, {}, { kid: 'unknown-access-key' }),
    ];
    const valid = await accessAssertion(ACCESS_ADMIN_EMAIL);
    const [validHeader, validPayload, validSignature] = valid.split('.');
    invalidAssertions.push(`${validHeader}.${validPayload}.${validSignature[0] === 'A' ? 'B' : 'A'}${validSignature.slice(1)}`);
    for (const assertion of invalidAssertions) {
      const rejected = await api('ops/dashboard', {
        headers: { 'cf-access-jwt-assertion': assertion },
      });
      expect(rejected.status).toBe(401);
    }

    (env as unknown as Env).ACCESS_TEAM_DOMAIN = 'unavailable-team.cloudflareaccess.com';
    const unavailable = await api('ops/dashboard', {
      headers: { 'cf-access-jwt-assertion': valid },
    });
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json() as any).error.code).toBe('ACCESS_UNAVAILABLE');
  });

  it('reports an empty live state to Access admins without fetching an absorbed host', async () => {
    const unauthorized = await api('ops/live', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unauthorized.status).toBe(401);

    // No collector has pushed a snapshot yet in this suite's database.
    absorbedHostFetches = [];
    const response = await operations('live');
    expect(response.status).toBe(200);
    const { live } = await response.json() as any;
    expect(live.quality).toBeNull();
    expect(live.agents).toBeNull();
    expect(live.qualityError).toBe('no quality snapshot');
    expect(live.agentsError).toBe('no agent snapshot');
    expect(live.qualityReceivedAt).toBeNull();
    expect(live.agentsReceivedAt).toBeNull();
    // The console showing "no snapshot" is the point: the previous code showed
    // a JSON parse error here, having fetched its own redirect.
    expect(absorbedHostFetches).toEqual([]);
  });

  it('lets the VPS collector store a live snapshot that ops/live serves without origin fetches', async () => {
    const missing = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ report: { nodes: [] } }),
    });
    expect(missing.status).toBe(503);
    expect((await missing.json() as any).error.code).toBe('OPS_INGEST_UNCONFIGURED');

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const unauthorized = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ report: { nodes: [] } }),
    });
    expect(unauthorized.status).toBe(401);

    const ingested = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer collector-test-token-with-at-least-32-chars',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        report: {
          updated_at: 1_786_270_932,
          updated_at_iso: '2026-08-09T10:00:00Z',
          cn_agents_configured: 3,
          nodes: [{
            name: 'Stored Node',
            host: '203.0.113.20',
            public_ip: '203.0.113.20',
            ok: true,
            quality: 'poor',
            risk_keywords: ['blacklist'],
            route_keywords: ['CN2 GIA'],
            block: {
              status: 'LIKELY_BLOCKED',
              label: '疑似被墙',
              rule: '大陆 agent ≥2/3 失败',
              mainland: { status: 'LIKELY_BLOCKED', success: 0, fail: 3, total: 3, authoritative: true },
              asia_edge: { ok: true, success: 3, total: 3 },
              overseas: { ok: true, success: 6, total: 6 },
            },
            security_check: 'IP quality body',
            backtrace: '163 / 4837',
            risk_signals: [
              { tag: 'attacker', yes: 1, no: 2 },
              { tag: 'spamhaus', yes: 1, no: 0 },
              { tag: '', yes: 9, no: 0 },
              { tag: 'negative', yes: -1, no: 0 },
            ],
            exposure: {
              clean: false,
              sshPorts: [30022, 70000],
              unexpected: [{ port: 25775, address: '0.0.0.0', process: 'python3' }],
              acknowledged: [
                { port: 8388, address: '0.0.0.0', process: 'ssserver', reason: 'family member' },
              ],
              expected: [{ port: 443, address: '*', process: 'xray' }],
            },
            secret: 'must-not-be-stored',
          }],
        },
        agents: {
          data: [{
            name: 'Stored Node', os: 'Debian', arch: 'amd64',
            token: 'must-not-leak', ipv4: '203.0.113.20',
            cpu_cores: 2, load_1: 3.5, load_5: 2.1, load_15: 1.0,
            swap_total: 1048576, swap_used: 524288,
            tcp_connections: 189, process: 71, observed_at: 1_786_715_907,
            carriers: {
              telecom: {
                latencyMs: 148.3, lossPct: 0, samples: 9,
                targets: ['三网-电信-上海', '三网-电信-天津'],
                history: [{ latencyMs: 148.3, lossPct: 0 }, { latencyMs: null, lossPct: null }],
              },
              // Komari reports a ping task no agent has run as `avg: 0,
              // loss: 0` — field for field a flawless result. It must not
              // survive as a carrier, or the console prints "0 ms, 0% loss"
              // for a path nothing has travelled.
              mobile: { latencyMs: 0, lossPct: 0, samples: 0, targets: [], history: [] },
            },
          }],
        },
      }),
    });
    expect(ingested.status).toBe(200);
    expect(await ingested.json()).toMatchObject({ ok: true, qualityNodes: 1, agentCount: 1 });

    absorbedHostFetches = [];
    const response = await operations('live');
    expect(response.status).toBe(200);
    const { live } = await response.json() as any;
    expect(live.quality.nodes).toHaveLength(1);
    expect(live.quality.nodes[0]).toMatchObject({
      name: 'Stored Node',
      publicIp: '203.0.113.20',
      quality: 'poor',
      block: {
        status: 'LIKELY_BLOCKED',
        asiaEdge: { success: 3, total: 3 },
      },
    });
    expect(live.quality.nodes[0].secret).toBeUndefined();
    // The raw collector text bodies are stored but never shipped in the list
    // payloads the console polls; the drawer fetches them per node instead.
    expect(live.quality.nodes[0].securityCheck).toBeUndefined();
    expect(live.quality.nodes[0].backtrace).toBeUndefined();
    const qualityText = await operations('fleet-nodes/Stored%20Node/quality-text');
    expect(qualityText.status).toBe(200);
    expect(await qualityText.json()).toEqual({
      securityCheck: 'IP quality body',
      backtrace: '163 / 4837',
    });
    const unknownText = await operations('fleet-nodes/No%20Such%20Node/quality-text');
    expect(unknownText.status).toBe(200);
    expect(await unknownText.json()).toEqual({ securityCheck: null, backtrace: null });
    // The tally travels, so the console can say "1 of 3 databases" rather than
    // printing the word "attacker" as though it were settled.
    expect(live.quality.nodes[0].riskSignals).toEqual([
      { tag: 'attacker', yes: 1, no: 2 },
      { tag: 'spamhaus', yes: 1, no: 0 },
    ]);
    expect(live.quality.nodes[0].exposure).toMatchObject({
      clean: false,
      sshPorts: [30022],
      unexpected: [{ port: 25775, address: '0.0.0.0', process: 'python3' }],
      acknowledged: [{ port: 8388, reason: 'family member' }],
    });
    expect(live.quality.cnAgentsConfigured).toBe(3);
    expect(live.agents).toEqual([{
      name: 'Stored Node', os: 'Debian', arch: 'amd64', cpuName: null,
      cpu: null, memTotal: null, memUsed: null, diskTotal: null, diskUsed: null,
      netIn: null, netOut: null, uptime: null,
      // Pressure, not inventory: load against cores separates a busy node from
      // one failing to keep up, and `observedAt` is the only thing that tells a
      // stalled agent from a healthy idle one.
      cpuCores: 2, load1: 3.5, load5: 2.1, load15: 1.0,
      // Only the carrier that was actually probed. `mobile` came in with zero
      // samples and is absent rather than perfect.
      carriers: {
        telecom: {
          latencyMs: 148.3, lossPct: 0, samples: 9,
          targets: ['三网-电信-上海', '三网-电信-天津'],
          history: [{ latencyMs: 148.3, lossPct: 0 }, { latencyMs: null, lossPct: null }],
        },
      },
      swapTotal: 1048576, swapUsed: 524288,
      tcpConnections: 189, processes: 71, observedAt: 1_786_715_907,
      price: null, currency: null, billingCycle: null, expiredAt: null,
      trafficLimit: null, trafficLimitType: null,
    }]);
    // The address and the agent token must still never survive ingest.
    expect(JSON.stringify(live.agents)).not.toContain('must-not-leak');
    expect(JSON.stringify(live.agents)).not.toContain('203.0.113.20');
    expect(live.agentsError).toBeNull();
    expect(live.qualityError).toBeNull();
    expect(live.agentsReceivedAt).toEqual(expect.any(Number));
    expect(live.qualityReceivedAt).toEqual(expect.any(Number));
    expect(absorbedHostFetches).toEqual([]);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('keeps agent minutes and serves them as metrics instead of overwriting a singleton', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const token = {
      authorization: 'Bearer collector-test-token-with-at-least-32-chars',
      'content-type': 'application/json',
    };
    const t0 = Math.floor(Date.now() / 1000) - 120;
    const t1 = t0 + 60;
    for (const [cpu, observedAt] of [[10, t0], [40, t1]] as const) {
      const ingested = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: token,
        body: JSON.stringify({
          agents: {
            data: [{
              name: 'Trend Node',
              cpu,
              cpu_cores: 2,
              load_1: 1.2,
              mem_used: 512,
              mem_total: 1024,
              observed_at: observedAt,
              price: 5.5,
              currency: '$',
              billing_cycle: 30,
              expired_at: 1_790_000_000,
              traffic_limit: 1_000_000_000,
              traffic_limit_type: 'sum',
            }],
          },
        }),
      });
      expect(ingested.status).toBe(200);
    }

    const live = await operations('live');
    expect((await live.json() as any).live.agents[0]).toMatchObject({
      name: 'Trend Node',
      cpu: 40,
      price: 5.5,
      currency: '$',
      billingCycle: 30,
      expiredAt: 1_790_000_000,
      trafficLimit: 1_000_000_000,
      trafficLimitType: 'sum',
    });

    const metrics = await operations('metrics?range=24h&node=Trend%20Node');
    expect(metrics.status).toBe(200);
    const body = await metrics.json() as any;
    expect(body.metrics.series['Trend Node'].length).toBeGreaterThanOrEqual(2);
    expect(body.metrics.series['Trend Node'].map((p: { cpu: number }) => p.cpu)).toEqual(
      expect.arrayContaining([10, 40]),
    );
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('rejects an unknown metrics range instead of silently serving 24 hours', async () => {
    const response = await operations('metrics?range=24hours');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Unsupported metrics range' },
    });
  });

  it('pins future collector clocks to receipt time in live state and metrics', async () => {
    const collectorToken = 'collector-test-token-with-at-least-32-chars';
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = collectorToken;
    const before = Math.floor(Date.now() / 1_000);
    const futureMilliseconds = (before + 86_400) * 1_000;
    try {
      const ingested = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${collectorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          report: {
            updated_at: futureMilliseconds,
            updated_at_iso: '2126-01-01T00:00:00Z',
            nodes: [{ name: 'Future clock', ok: true }],
          },
          agents: {
            data: [{ name: 'Future clock', cpu: 15, observed_at: futureMilliseconds }],
          },
        }),
      });
      expect(ingested.status).toBe(200);
      const after = Math.floor(Date.now() / 1_000);

      const response = await operations('live');
      const { live } = await response.json() as any;
      const agent = live.agents.find((row: any) => row.name === 'Future clock');
      expect(agent.observedAt).toBeGreaterThanOrEqual(before);
      expect(agent.observedAt).toBeLessThanOrEqual(after);
      expect(live.agentsReceivedAt).toBeGreaterThanOrEqual(before);
      expect(live.agentsReceivedAt).toBeLessThanOrEqual(after);
      expect(live.quality.updatedAt).toBeGreaterThanOrEqual(before);
      expect(live.quality.updatedAt).toBeLessThanOrEqual(after);
      expect(live.qualityReceivedAt).toBeGreaterThanOrEqual(before);
      expect(live.qualityReceivedAt).toBeLessThanOrEqual(after);
      expect(live.quality.updatedAtIso)
        .toBe(new Date(live.quality.updatedAt * 1_000).toISOString());

      const sampleRow = await env.DB.prepare(
        `SELECT observed_at FROM operations_agent_samples
         WHERE node_name = 'Future clock'`,
      ).first<any>();
      expect(Number(sampleRow.observed_at)).toBe(Math.floor(agent.observedAt / 60) * 60);

      const metrics = await operations('metrics?range=24h&node=Future%20clock');
      const points = ((await metrics.json() as any).metrics.series['Future clock']) as any[];
      expect(points).toHaveLength(1);
      expect(points[0].t).toBe(Number(sampleRow.observed_at));
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('does not let a collector that predates exposure look like a clean node', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const ingested = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer collector-test-token-with-at-least-32-chars',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ report: { nodes: [{ name: 'Old Collector', ok: true }] } }),
    });
    expect(ingested.status).toBe(200);

    const response = await operations('live');
    const { live } = await response.json() as any;
    const node = live.quality.nodes.find((n: any) => n.name === 'Old Collector');
    // Absent, not clean. A node nobody has looked at is precisely the state the
    // leak lived in, and rendering it as clean would recreate that blind spot.
    expect(node.exposure).toBeNull();
    expect(node.riskSignals).toEqual([]);
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('keeps the stored live snapshot when a collector push parses to empty lists', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const token = {
      authorization: 'Bearer collector-test-token-with-at-least-32-chars',
      'content-type': 'application/json',
    };
    try {
      // While nothing is stored yet an empty list is a legitimate answer.
      const first = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: token,
        body: JSON.stringify({ report: { nodes: [] }, agents: [] }),
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json() as any;
      expect(firstBody.reportIgnoredEmpty).toBeUndefined();
      expect(firstBody.agentsIgnoredEmpty).toBeUndefined();

      const seeded = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: token,
        body: JSON.stringify({
          report: { nodes: [{ name: 'Kept Node', ok: true }] },
          agents: { data: [{ name: 'Kept Node', cpu: 12 }] },
        }),
      });
      expect(seeded.status).toBe(200);

      // A Komari outage that answers with an empty list must not flip every
      // node to "missing" under a fresh timestamp.
      const emptied = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: token,
        body: JSON.stringify({ report: { nodes: [] }, agents: [] }),
      });
      expect(emptied.status).toBe(200);
      const emptiedBody = await emptied.json() as any;
      expect(emptiedBody.reportIgnoredEmpty).toBe(true);
      expect(emptiedBody.agentsIgnoredEmpty).toBe(true);

      const response = await operations('live');
      const { live } = await response.json() as any;
      expect(live.quality.nodes.map((n: any) => n.name)).toContain('Kept Node');
      expect(live.agents.map((a: any) => a.name)).toContain('Kept Node');
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('sends a path-style console link to the page it names instead of a 404', async () => {
    for (const [path, hash] of [
      ['/ops/monitor', '/ops/#/monitor'],
      ['/ops/users/', '/ops/#/users'],
      ['/ops/dashboard', '/ops/#/dashboard'],
    ] as const) {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request(`https://admin.afk.ccwu.cc${path}`),
        env as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(hash);
    }

    // A real file must still be served rather than bounced.
    for (const path of ['/ops/assets/index-abc123.js', '/ops/index.html', '/ops/']) {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request(`https://admin.afk.ccwu.cc${path}`),
        env as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).not.toBe(302);
    }
  });

  it('stops cross-site ops writes before the origin header is stripped for the API worker', async () => {
    const forwarded: Request[] = [];
    const adminEnv = {
      API: {
        fetch: async (request: Request) => {
          forwarded.push(request);
          return Response.json({ ok: true });
        },
      },
    } as unknown as Parameters<typeof adminWorker.fetch>[1];
    const attempt = async (method: string, headers: Record<string, string>) => {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request('https://admin.afk.ccwu.cc/api/v1/ops/signup-allowlist', {
          method,
          headers,
          ...(method === 'GET' ? {} : { body: '{"email":"csrf@example.com"}' }),
        }),
        adminEnv,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    };

    // The no-preflight vector: a cross-site form post carrying the Access
    // cookie. Sends both the foreign Origin and sec-fetch-site: cross-site.
    const formPost = await attempt('POST', {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'text/plain',
    });
    expect(formPost.status).toBe(403);
    expect((await formPost.json() as any).error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(forwarded).toHaveLength(0);

    // A write with no provenance at all is refused rather than assumed safe.
    const anonymous = await attempt('DELETE', { 'content-type': 'application/json' });
    expect(anonymous.status).toBe(403);
    expect(forwarded).toHaveLength(0);

    // The console's own writes carry sec-fetch-site: same-origin, or on older
    // browsers only an Origin matching the admin host — both pass, and the
    // Origin header is still stripped before the service binding.
    const sameOrigin = await attempt('POST', {
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    });
    expect(sameOrigin.status).toBe(200);
    const ownOrigin = await attempt('POST', {
      origin: 'https://admin.afk.ccwu.cc',
      'content-type': 'application/json',
    });
    expect(ownOrigin.status).toBe(200);
    expect(forwarded).toHaveLength(2);
    expect(forwarded[1].headers.get('origin')).toBeNull();

    // Reads are unaffected: a cross-site GET leaks no state and still forwards.
    const read = await attempt('GET', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    expect(read.status).toBe(200);
    expect(forwarded).toHaveLength(3);
  });

  it('serves the node roster to the collector, and never an empty list by accident', async () => {
    const unconfigured = await api('ops-ingest/node-clients', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unconfigured.status).toBe(503);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';

    // Seeded here rather than relying on another test having made one: what is
    // being checked is that an entitled account with no credential yet gets one.
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_roster', 'roster@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();

    const wrongToken = await api('ops-ingest/node-clients', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(wrongToken.status).toBe(401);

    const response = await api('ops-ingest/node-clients', {
      headers: { authorization: 'Bearer collector-test-token-with-at-least-32-chars' },
    });
    expect(response.status).toBe(200);
    const roster = await response.json() as any;
    // `observedAt` is what lets a reconciler tell a stale response from a real
    // empty roster; applying an empty list as current would strip every managed
    // client from every node.
    expect(roster.observedAt).toBeGreaterThan(0);
    expect(Array.isArray(roster.clients)).toBe(true);
    // Identities are otherwise minted only when a catalog carrying the
    // placeholder is fetched, and the published catalog is still the legacy
    // one — so without minting here the roster is empty forever and the
    // cutover cannot start.
    expect(roster.clients.some((c: { userId: string }) => c.userId === 'usr_roster')).toBe(true);
    // Minting is idempotent: a second call must not hand the same account a
    // different identity, or every node would be reconciled to a UUID the
    // customer does not present.
    const again = await api('ops-ingest/node-clients', {
      headers: { authorization: 'Bearer collector-test-token-with-at-least-32-chars' },
    });
    expect(await again.json()).toMatchObject({ clients: roster.clients });
    for (const client of roster.clients) {
      expect(client.email).toBe(`u:${client.userId}`);
      expect(client.clientUUID).toMatch(/^[0-9a-f-]{36}$/);
    }
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('accepts usage from the collector under its own token, on the same rules', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_usage', 'usage@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();

    const unconfigured = await api('ops-ingest/usage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reports: [] }),
    });
    expect(unconfigured.status).toBe(503);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const headers = {
      authorization: 'Bearer collector-test-token-with-at-least-32-chars',
      'content-type': 'application/json',
    };
    const send = (reportId: string, totalBytes: number) => api('ops-ingest/usage', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reports: [{ reportId, userId: 'usr_usage', totalBytes, observedAt: seeded }],
      }),
    });

    expect((await send('usr_usage-1', 5_000)).status).toBe(200);
    const after = await (env as unknown as Env).DB.prepare(
      'SELECT usage_bytes FROM users WHERE id = ?',
    ).bind('usr_usage').first<Record<string, unknown>>();
    expect(Number(after!.usage_bytes)).toBe(5_000);

    // `usage_bytes` is written with MAX(), so a replay cannot inflate it and a
    // lower figure cannot walk it back — the property the reporting agent has
    // to be built around, since over-reporting once suspends an account for
    // good.
    expect((await send('usr_usage-1', 5_000)).status).toBe(200);
    expect((await send('usr_usage-2', 1_000)).status).toBe(200);
    const settled = await (env as unknown as Env).DB.prepare(
      'SELECT usage_bytes FROM users WHERE id = ?',
    ).bind('usr_usage').first<Record<string, unknown>>();
    expect(Number(settled!.usage_bytes)).toBe(5_000);

    // Same reportId with different content is a conflict, not a silent write.
    expect((await send('usr_usage-1', 9_999)).status).toBe(409);
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('adds up the exits metering an account instead of billing the largest one', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_sources', 'sources@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    const report = (reportId: string, sourceId: string, totalBytes: number, at = seeded) =>
      api('home/usage', json({
        reports: [{ reportId, userId: 'usr_sources', sourceId, totalBytes, observedAt: at }],
      }, HOME_TOKEN));
    const counted = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes FROM users WHERE id = ?',
      ).bind('usr_sources').first<Record<string, unknown>>();
      return Number(row!.usage_bytes);
    };

    // Each exit meters only what crossed it. Folded with MAX() this account was
    // billed 500 of the 1000 it used, so it never reached a quota it had passed.
    expect((await report('src-a-1', 'exit-a', 300)).status).toBe(200);
    expect((await report('src-b-1', 'exit-b', 500)).status).toBe(200);
    expect((await report('src-c-1', 'exit-c', 200)).status).toBe(200);
    expect(await counted()).toBe(1_000);

    // A source's figure is cumulative, so a later one replaces its own
    // predecessor rather than adding to it.
    expect((await report('src-a-2', 'exit-a', 450, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_150);

    // Replaying is what an agent does when it loses an acknowledgement, and it
    // must cost nothing.
    expect((await report('src-a-2', 'exit-a', 450, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_150);

    // A batch that arrives after a newer one is stale, not a rebuilt node.
    expect((await report('src-a-3', 'exit-a', 400, seeded + 30)).status).toBe(200);
    expect(await counted()).toBe(1_150);

    // Growth is taken whatever the timestamp says: a clock that steps backwards
    // between rounds must not stop an exit being counted, and the difference is
    // what is taken from it either way.
    expect((await report('src-a-4', 'exit-a', 500, seeded + 30)).status).toBe(200);
    expect(await counted()).toBe(1_200);

    // The same report id under a different source is a conflict, not a silent
    // keep of whichever row reached the table first.
    expect((await report('src-a-2', 'exit-b', 450, seeded + 60)).status).toBe(409);
    expect(await counted()).toBe(1_200);

    const ambiguousBatch = await api('home/usage', json({
      reports: [
        {
          reportId: 'src-a-5', userId: 'usr_sources', sourceId: 'exit-a',
          totalBytes: 550, observedAt: seeded + 90,
        },
        {
          reportId: 'src-a-6', userId: 'usr_sources', sourceId: 'exit-a',
          totalBytes: 100, observedAt: seeded + 120,
        },
      ],
    }, HOME_TOKEN));
    expect(ambiguousBatch.status).toBe(400);
    expect((await ambiguousBatch.json() as any).error.code).toBe('VALIDATION_ERROR');
    expect(await counted()).toBe(1_200);

    const oversized = await api('home/usage', json({
      reports: [{
        reportId: 'src-long', userId: 'usr_sources', sourceId: 'x'.repeat(65),
        totalBytes: 1, observedAt: seeded,
      }],
    }, HOME_TOKEN));
    expect(oversized.status).toBe(400);
  });

  it('carries a rebuilt exit forward, and leaves a reporter that names none on MAX', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_rebuilt', 'rebuilt@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    const report = (reportId: string, totalBytes: number, at: number, sourceId?: string) =>
      api('home/usage', json({
        reports: [{
          reportId, userId: 'usr_rebuilt', totalBytes, observedAt: at,
          ...(sourceId === undefined ? {} : { sourceId }),
        }],
      }, HOME_TOKEN));
    const counted = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes FROM users WHERE id = ?',
      ).bind('usr_rebuilt').first<Record<string, unknown>>();
      return Number(row!.usage_bytes);
    };

    expect((await report('rb-1', 900, seeded, 'exit-r')).status).toBe(200);
    expect(await counted()).toBe(900);

    // The node was rebuilt and its counter starts again from zero. Under MAX the
    // account was billed nothing at all until the new counter climbed past 900;
    // taking the new figure as the total would forgive the 900 instead.
    expect((await report('rb-2', 120, seeded + 60, 'exit-r')).status).toBe(200);
    expect(await counted()).toBe(1_020);

    // A report that names no source is the collector, or an agent that has not
    // been upgraded. Its figure is an aggregate over a changing set of nodes, so
    // a fall means a node left the fleet rather than a counter reset: it keeps
    // the MAX contract it was written against, beside the exit's own counter.
    expect((await report('rb-3', 400, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_420);
    expect((await report('rb-4', 250, seeded + 120)).status).toBe(200);
    expect(await counted()).toBe(1_420);
    expect((await report('rb-5', 600, seeded + 120)).status).toBe(200);
    expect(await counted()).toBe(1_620);
  });

  it('does not read a fallen figure sharing a timestamp as a rebuilt exit', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_tied', 'tied@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    const report = (reportId: string, totalBytes: number, at: number) =>
      api('home/usage', json({
        reports: [{
          reportId, userId: 'usr_tied', sourceId: 'exit-t', totalBytes, observedAt: at,
        }],
      }, HOME_TOKEN));
    const counted = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes FROM users WHERE id = ?',
      ).bind('usr_tied').first<Record<string, unknown>>();
      return Number(row!.usage_bytes);
    };

    expect((await report('tie-1', 900, seeded)).status).toBe(200);
    expect(await counted()).toBe(900);

    // The agent stamps one timestamp per run and holds no lock, so a timer
    // firing beside a manual run can land two reports in the same second with
    // the higher one first. The lower one is a reading from that same second,
    // not a rebuild: carrying it forward would bill the whole cumulative figure
    // a second time.
    expect((await report('tie-2', 400, seeded)).status).toBe(200);
    expect(await counted()).toBe(900);

    // A rebuilt node's counter is always later than the figure it replaces.
    expect((await report('tie-3', 120, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_020);
  });

  it('lets a billing cycle be reset without the next report undoing it', async () => {
    const t = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, quota_bytes, created_at, updated_at)
       VALUES('usr_cycle', 'cycle@example.com', 'h', 's', 'active', 0, 1000, ?, ?)`,
    ).bind(t, t).run();
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const headers = {
      authorization: 'Bearer collector-test-token-with-at-least-32-chars',
      'content-type': 'application/json',
    };
    const report = (reportId: string, totalBytes: number) => api('ops-ingest/usage', {
      method: 'POST',
      headers,
      body: JSON.stringify({ reports: [{ reportId, userId: 'usr_cycle', totalBytes, observedAt: t }] }),
    });
    const usage = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes, usage_reported_bytes, usage_baseline_bytes FROM users WHERE id = ?',
      ).bind('usr_cycle').first<Record<string, unknown>>();
      return {
        billed: Number(row!.usage_bytes),
        counter: Number(row!.usage_reported_bytes),
        baseline: Number(row!.usage_baseline_bytes),
      };
    };

    await report('cycle-1', 900);
    expect(await usage()).toMatchObject({ billed: 900, counter: 900, baseline: 0 });

    // A typo must not read as success. This valve exists to get a locked-out
    // customer working again; a silent no-op is discovered only by the customer.
    const typo = await api('admin/users/usr_cycle', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resetUsge: true }),
    });
    expect(typo.status).toBe(400);

    // The console's own route keeps its own fields; tightening the scripted one
    // must not start rejecting a note or a plan change.
    const consoleEdit = await api('ops/users/usr_cycle', {
      method: 'PATCH',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ notes: 'still editable' }),
    });
    expect(consoleEdit.status).toBe(200);

    const reset = await api('admin/users/usr_cycle', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resetUsage: true }),
    });
    expect(reset.status).toBe(200);
    expect(await usage()).toMatchObject({ billed: 0, counter: 900, baseline: 900 });

    // The collector never lowers its fleet-wide total, so the very next report
    // carries the pre-reset figure. Before the baseline existed, MAX() put the
    // account straight back over its quota and the reset meant nothing.
    await report('cycle-2', 950);
    expect(await usage()).toMatchObject({ billed: 50, counter: 950, baseline: 900 });

    // And the account is under quota again, which is the whole point: with no
    // way down, one over-report suspended a paying customer for good.
    const suspended = await (env as unknown as Env).DB.prepare(
      'SELECT 1 AS hit FROM users WHERE id = ? AND quota_bytes IS NOT NULL AND usage_bytes >= quota_bytes',
    ).bind('usr_cycle').first<Record<string, unknown>>();
    expect(suspended).toBeNull();
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('lets the console end a billing cycle, which is where the lockout is seen', async () => {
    // The dashboard raises 已超配额 from the console's own user list, and the
    // rollback manual names resetUsage as the remedy — but the field existed
    // only on the token-admin route, so the console could show the lockout and
    // not clear it. Every assertion here is about the console's own session.
    const t = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, quota_bytes, created_at, updated_at)
       VALUES('usr_opscycle', 'opscycle@example.com', 'h', 's', 'active', 0, 1000, ?, ?)`,
    ).bind(t, t).run();
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const console_ = async (payload: unknown) => api('ops/users/usr_opscycle', {
      method: 'PATCH',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const usage = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes, usage_reported_bytes, usage_baseline_bytes FROM users WHERE id = ?',
      ).bind('usr_opscycle').first<Record<string, unknown>>();
      return {
        billed: Number(row!.usage_bytes),
        counter: Number(row!.usage_reported_bytes),
        baseline: Number(row!.usage_baseline_bytes),
      };
    };
    const report = (reportId: string, totalBytes: number) => api('ops-ingest/usage', {
      method: 'POST',
      headers: {
        authorization: 'Bearer collector-test-token-with-at-least-32-chars',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reports: [{ reportId, userId: 'usr_opscycle', totalBytes, observedAt: t }] }),
    });

    await report('ops-cycle-1', 900);
    expect(await usage()).toMatchObject({ billed: 900, counter: 900, baseline: 0 });

    // A misspelling still has to fail loudly on this route too. A silent 200 on
    // the endpoint that unlocks a paying customer is discovered by the customer.
    expect((await console_({ resetUsge: true })).status).toBe(400);
    // And only `true` — nothing that could be read as "no" may pass as one.
    expect((await console_({ resetUsage: false })).status).toBe(400);
    expect(await usage()).toMatchObject({ billed: 900 });

    expect((await console_({ resetUsage: true })).status).toBe(200);
    expect(await usage()).toMatchObject({ billed: 0, counter: 900, baseline: 900 });

    // The collector's total only ever rises, so the next report re-sends the
    // pre-reset figure. The baseline is what keeps the reset from being undone.
    await report('ops-cycle-2', 950);
    expect(await usage()).toMatchObject({ billed: 50, counter: 950, baseline: 900 });

    // Ending a cycle must not disturb the fields the console already edited.
    expect((await console_({ notes: 'kept' })).status).toBe(200);
    expect(await usage()).toMatchObject({ billed: 50, baseline: 900 });
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('redirects the absorbed quality and ops hostnames to the admin monitor', async () => {
    for (const host of ['quality.afk.ccwu.cc', 'ops.afk.ccwu.cc']) {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request(`https://${host}/`),
        env as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://admin.afk.ccwu.cc/ops/#/monitor');
    }
  });

  it('serves per-user device and diagnostics detail to Access admins', async () => {
    const missing = await operations(`users/${crypto.randomUUID()}/detail`);
    expect(missing.status).toBe(404);

    const account = await createAccount('opsdetail');
    const response = await operations(`users/${account.user.id}/detail`);
    expect(response.status).toBe(200);
    const detail = await response.json() as any;
    expect(detail.devices).toHaveLength(1);
    expect(detail.devices[0].name).toBe('Primary Mac');
    expect(typeof detail.devices[0].status).toBe('string');
    expect(detail.diagnostics).toEqual([]);
  });

  it('lets Access admins replace the catalog and traffic policy on ops routes', async () => {
    const yaml = [
      'proxies:',
      '  - name: "Ops Exit"',
      '    type: vless',
      '    server: 203.0.113.50',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    network: tcp',
      '    tls: true',
      '    udp: true',
      '    servername: www.microsoft.com',
      '    client-fingerprint: chrome',
      '    flow: xtls-rprx-vision',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
    ].join('\n');
    const putCatalog = await api('ops/exit-catalog', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
      },
      body: JSON.stringify({ yaml, expectedRevision: 0 }),
    });
    expect(putCatalog.status).toBe(200);
    expect((await putCatalog.json() as any).revision).toBe(1);

    const policy = await operations('traffic-policy');
    expect(policy.status).toBe(200);
    expect((await policy.json() as any).revision).toBe(0);
  });

  it('does not serve the legacy token admin page on the API host', async () => {
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://test/'),
      env as unknown as Env,
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(404);
    expect((await response.json() as any).error.code).toBe('NOT_FOUND');
  });

  it('lets Access admins add users and bind home exits through ops product routes', async () => {
    const unauthorized = await api('ops/users', {
      method: 'GET',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unauthorized.status).toBe(401);

    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const addAllow = await api('ops/signup-allowlist', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ email: 'family-user@example.com' }),
    });
    expect(addAllow.status).toBe(201);

    const account = await createAccount('ops-family');
    const homeCreate = await api('ops/home-exits', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        proxyName: 'Home Residential Ops',
        displayName: '家庭 Ops',
        egressIpv4: '198.51.100.9',
      }),
    });
    expect(homeCreate.status).toBe(201);
    const homeId = ((await homeCreate.json()) as any).homeExit.id;

    const bind = await api(`ops/users/${account.user.id}/home-binding`, {
      method: 'PUT',
      headers: accessHeaders,
      body: JSON.stringify({ homeExitId: homeId }),
    });
    expect(bind.status).toBe(201);

    const users = await operations('users');
    expect(users.status).toBe(200);
    const usersBody = await users.json() as any;
    const listed = usersBody.users.find((row: any) => row.id === account.user.id);
    expect(listed.homeBinding).toMatchObject({
      homeExitId: homeId,
      proxyName: 'Home Residential Ops',
      egressIpv4: '198.51.100.9',
    });
    // The list no longer truncates silently: the caller is told how many
    // customers exist and how to fetch the next page.
    expect(usersBody.total).toBeGreaterThanOrEqual(usersBody.users.length);
    expect(usersBody.hasMore).toBe(false);
    expect(usersBody.nextCursor).toBeNull();

    await createAccount('ops-family-second');
    const firstPage = await operations('users?limit=1');
    expect(firstPage.status).toBe(200);
    const firstBody = await firstPage.json() as any;
    expect(firstBody.users).toHaveLength(1);
    expect(firstBody.hasMore).toBe(true);
    expect(typeof firstBody.nextCursor).toBe('string');
    const secondPage = await operations(`users?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`);
    expect(secondPage.status).toBe(200);
    const secondBody = await secondPage.json() as any;
    expect(secondBody.users).toHaveLength(1);
    expect(secondBody.users[0].id).not.toBe(firstBody.users[0].id);

    expect((await operations('users?limit=0')).status).toBe(400);
    expect((await operations('users?cursor=broken')).status).toBe(400);
  });

  it('refuses a JSON body that does not declare the JSON media type', async () => {
    // enctype=text/plain is the cross-site form post that never triggers a
    // CORS preflight; requiring the media type makes such a write impossible.
    const formShaped = await api('ops/signup-allowlist', {
      method: 'POST',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'text/plain',
      },
      body: JSON.stringify({ email: 'csrf-target@example.com' }),
    });
    expect(formShaped.status).toBe(415);
    expect((await formShaped.json() as any).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const stillAbsent = await env.DB.prepare(
      'SELECT 1 FROM signup_allowlist WHERE email = ?',
    ).bind('csrf-target@example.com').first();
    expect(stillAbsent).toBeNull();

    // A charset suffix is still the JSON media type.
    const withCharset = await api('ops/signup-allowlist', {
      method: 'POST',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ email: 'charset-ok@example.com' }),
    });
    expect(withCharset.status).toBe(201);
  });

  it('leaves an audit row for operator user edits and home bindings', async () => {
    const account = await createAccount('audit-trail');
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const patched = await api(`ops/users/${account.user.id}`, {
      method: 'PATCH',
      headers: accessHeaders,
      body: JSON.stringify({
        notes: '审计备注',
        expiresAt: Math.floor(Date.now() / 1_000) + 86_400,
      }),
    });
    expect(patched.status).toBe(200);
    const patchAudit = await env.DB.prepare(
      "SELECT * FROM ops_audit WHERE action = 'user.update' AND target_id = ?",
    ).bind(account.user.id).first<any>();
    expect(patchAudit).toMatchObject({
      actor_email: ACCESS_ADMIN_EMAIL,
      target_type: 'user',
      // The names of the fields that changed, not a bare "updated".
      summary: 'changed expiresAt, notes',
    });

    const home = await api('ops/home-exits', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        proxyName: 'Audit Home',
        displayName: '审计家宽',
        egressIpv4: '198.51.100.77',
      }),
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id;
    const bound = await api(`ops/users/${account.user.id}/home-binding`, {
      method: 'PUT',
      headers: accessHeaders,
      body: JSON.stringify({ homeExitId: homeId }),
    });
    expect(bound.status).toBe(201);
    const bindAudit = await env.DB.prepare(
      "SELECT * FROM ops_audit WHERE action = 'home.assign' AND target_id = ?",
    ).bind(account.user.id).first<any>();
    expect(bindAudit).toMatchObject({
      actor_email: ACCESS_ADMIN_EMAIL,
      target_type: 'user',
    });
    expect(String(bindAudit.summary)).toContain(account.email);

    // The log endpoint answers filtered questions instead of only "newest 100".
    const filtered = await operations(`audit?targetId=${account.user.id}&limit=1`);
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json() as any;
    expect(filteredBody.entries).toHaveLength(1);
    expect(filteredBody.entries[0].targetId).toBe(account.user.id);
    expect(filteredBody.hasMore).toBe(true);
    const older = await operations(
      `audit?targetId=${account.user.id}&before=${filteredBody.nextBefore + 1}`,
    );
    const olderBody = await older.json() as any;
    expect(olderBody.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of olderBody.entries) {
      expect(entry.targetId).toBe(account.user.id);
      expect(entry.at).toBeLessThan(filteredBody.nextBefore + 1);
    }
    expect((await operations('audit?limit=0')).status).toBe(400);
    expect((await operations('audit?before=-5')).status).toBe(400);
  });

  it('serves the shared administrative resources identically through both front doors', async () => {
    // The two surfaces authenticate differently and used to carry their own copy
    // of these handlers, which had already drifted. Asserting the responses are
    // byte-identical is what keeps one consolidated implementation honest — and
    // what would have caught the drift that existed before it.
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const created = await api('admin/home-exits', {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        proxyName: 'parity-exit',
        displayName: 'Parity',
        kind: 'socks5',
        socks5Host: '198.51.100.20',
        socks5Port: 1080,
        socks5Username: 'u',
        socks5Password: 'p',
      }),
    });
    expect(created.status).toBe(201);
    const exitId = ((await created.json()) as any).homeExit.id;
    const account = await createAccount('front-door-parity');
    expect((await api(`admin/users/${account.user.id}/home-binding`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ homeExitId: exitId }),
    })).status).toBe(201);

    for (const resource of ['home-exits', 'home-bindings', 'signup-allowlist']) {
      const viaToken = await api(`admin/${resource}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      const viaAccess = await api(`ops/${resource}`, {
        method: 'GET',
        headers: accessHeaders,
      });
      expect(viaToken.status).toBe(200);
      expect(viaAccess.status).toBe(200);
      expect(await viaAccess.text()).toBe(await viaToken.text());
    }

    // Locks the response contract rather than the coercion. The pre-consolidation
    // difference here — one door wrapping `email` in `String()`, the other
    // returning D1's value — turns out to have no runtime effect, because D1
    // already hands back a string for a TEXT column. Asserting the types is
    // still worth having: it is a schema change to a non-text column, not a
    // missing `String()`, that this would catch.
    const allowlist = await api('admin/signup-allowlist', {
      method: 'GET',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    for (const entry of ((await allowlist.json()) as any).entries) {
      expect(typeof entry.email).toBe('string');
      expect(typeof entry.createdAt).toBe('number');
    }

    // A write reaches the same implementation too: the PATCH is issued through
    // Access and read back through the token surface.
    const patched = await api(`ops/home-exits/${exitId}`, {
      method: 'PATCH',
      headers: accessHeaders,
      body: JSON.stringify({ displayName: 'Parity renamed' }),
    });
    expect(patched.status).toBe(200);
    const readBack = await api('admin/home-exits', {
      method: 'GET',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(((await readBack.json()) as any).homeExits.find(
      (row: any) => row.id === exitId,
    ).displayName).toBe('Parity renamed');

    // And neither door accepts the other's credential.
    expect((await api('ops/home-exits', {
      method: 'GET',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);
    expect((await api('admin/home-exits', {
      method: 'GET',
      headers: accessHeaders,
    })).status).toBe(401);
  });

  it('keeps the phase-1 operations tables out of the API surface', async () => {
    const timestamp = 1_700_000_000;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO operations_servers(id, display_name, region_code, provider, status, created_at, updated_at)
         VALUES(?, ?, ?, ?, 'active', ?, ?)`,
      ).bind('server-us-west', 'US West', 'us-west', 'provider-a', timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO operations_logical_nodes(id, server_id, display_name, region_code, status, created_at, updated_at)
         VALUES(?, ?, ?, ?, 'active', ?, ?)`,
      ).bind('node-us-west-1', 'server-us-west', 'US West 1', 'us-west', timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO operations_deployments(
           id, server_id, logical_node_id, environment, release_version, status, deployed_at, created_at
         ) VALUES(?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).bind('deployment-1', 'server-us-west', 'node-us-west-1', 'production', '2026.08.1', timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO operations_catalog_revision_metadata(
           revision, content_sha256, published_at, server_count, logical_node_count, deployment_count
         ) VALUES(?, ?, ?, ?, ?, ?)`,
      ).bind(7, 'a'.repeat(64), timestamp, 1, 1, 1),
      env.DB.prepare(
        `INSERT INTO managed_exit_catalog(
           singleton_id, revision, ciphertext, nonce, content_sha256, updated_at
         ) VALUES(1, ?, ?, ?, ?, ?)`,
      ).bind(7, 'encrypted-catalog', 'catalog-nonce', 'b'.repeat(64), timestamp + 1),
    ]);

    const dashboard = await operations('dashboard');
    expect(dashboard.status).toBe(200);
    // Dashboard occupancy is the live fleet (catalog + quality + agents), not
    // the unused operations_servers inventory seeded above.
    expect((await dashboard.json() as any).dashboard.servers).toEqual({ total: 0, active: 0 });

    // The migration-0016 read endpoints are gone: nothing drove them (the
    // dashboard hardcodes deployments) and the seeded rows above must stay
    // unreachable rather than resurfacing as a forgotten API.
    for (const retired of ['servers', 'nodes', 'deployments']) {
      const response = await operations(retired);
      expect(response.status).toBe(404);
    }

    const revisions = await operations('catalog-revisions');
    expect((await revisions.json() as any).revisions).toEqual([{
      revision: 7,
      sha256: 'b'.repeat(64),
      publishedAt: timestamp + 1,
      serverCount: 1,
      logicalNodeCount: 1,
      deploymentCount: 1,
      current: true,
    }]);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO operations_servers(id, display_name, region_code, status, created_at, updated_at)
         VALUES('server-jp', 'Japan', 'jp', 'active', ?, ?)`,
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO operations_logical_nodes(id, server_id, display_name, region_code, status, created_at, updated_at)
         VALUES('node-jp-1', 'server-jp', 'Japan 1', 'jp', 'active', ?, ?)`,
      ).bind(timestamp, timestamp),
    ]);
    await expect(env.DB.prepare(
      `INSERT INTO operations_deployments(
         id, server_id, logical_node_id, environment, release_version, status, created_at
       ) VALUES('cross-server', 'server-us-west', 'node-jp-1', 'production', 'invalid', 'active', ?)`,
    ).bind(timestamp).run()).rejects.toThrow();

    const rejectedWrite = await operations('servers', ACCESS_ADMIN_EMAIL, 'POST');
    expect(rejectedWrite.status).toBe(405);
    expect(rejectedWrite.headers.get('allow')).toContain('GET');
    expect((await env.DB.prepare('SELECT COUNT(*) total FROM operations_servers').first<any>()).total).toBe(2);

    // Existing token-authenticated CLI/admin operations remain available on their original boundary.
    expect((await admin('users', undefined, 'GET')).status).toBe(200);
  });

  it('manages exact signup access without a Worker redeployment', async () => {
    const address = `managed-user-${++sequence}@outside.test`;
    const unauthorized = await api('admin/signup-allowlist');
    expect(unauthorized.status).toBe(401);

    const added = await admin('signup-allowlist', { email: address.toUpperCase() });
    expect(added.status).toBe(201);
    expect(await added.json()).toEqual({
      email: address,
      createdAt: expect.any(Number),
      created: true,
    });

    const duplicate = await admin('signup-allowlist', { email: address });
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as any).created).toBe(false);

    const listed = await admin('signup-allowlist', undefined, 'GET');
    expect(listed.status).toBe(200);
    expect((await listed.json() as any).entries).toContainEqual({
      email: address,
      createdAt: expect.any(Number),
    });

    const login = await emailSignIn({
      email: address,
      deviceName: 'Managed user Mac',
      installationId: 'managed-user-installation-one',
    });
    expect(login.status).toBe(200);

    const removed = await admin('signup-allowlist', { email: address }, 'DELETE');
    expect(removed.status).toBe(204);
    const afterRemoval = await admin('signup-allowlist', undefined, 'GET');
    expect((await afterRemoval.json() as any).entries).not.toContainEqual(
      expect.objectContaining({ email: address }),
    );

    const blocked = await startEmailSignIn({
      email: `removed-user-${sequence}@outside.test`,
      deviceName: 'Removed user Mac',
      installationId: 'removed-user-installation-one',
    });
    expect(blocked.response.status).toBe(202);
    expect(blocked.code).toBeUndefined();
  });

  it('advertises configured passwordless methods and retires password routes', async () => {
    const methods = await api('auth/methods');
    expect(methods.status).toBe(200);
    expect(await methods.json()).toEqual({
      email: { enabled: true },
      apple: { enabled: true },
      google: { enabled: true, clientId: GOOGLE_AUDIENCE },
    });

    for (const route of ['auth/login', 'auth/redeem']) {
      const retired = await api(route, json({}));
      expect(retired.status).toBe(410);
      expect((await retired.json() as any).error.code).toBe('PASSWORD_AUTH_DISABLED');
    }
  });

  it('activates a VLESS-only device without contacting Tailscale', async () => {
    const cloudOnlyEnv = Object.create(env) as Env;
    cloudOnlyEnv.TAILSCALE_ENROLLMENT_ENABLED = 'false';
    const started = await startEmailSignIn({
      email: `cloud-only-${++sequence}@example.com`,
      deviceName: 'Reality Mac',
      installationId: 'cloud-only-installation-one',
    });
    expect(started.response.status).toBe(202);
    expect(started.code).toBeTruthy();

    const invoke = async (path: string, init: RequestInit) => {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request(`https://test/api/v1/${path}`, init),
        cloudOnlyEnv,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    };
    const response = await invoke('auth/email/verify', json({
      challengeId: started.challengeId,
      code: started.code,
    }));
    expect(response.status).toBe(200);
    const account = await response.json() as any;
    expect(account.device.status).toBe('active');
    expect(account.device.pendingExpiresAt).toBeNull();
    expect(account.device.confirmedAt).toEqual(expect.any(Number));
    expect(account.enrollment).toBeUndefined();
    expect(tailscaleRequests).toEqual([]);

    const enrollment = await invoke(
      `devices/${account.device.id}/enrollment`,
      json({ installationId: 'cloud-only-installation-one' }, account.accessToken),
    );
    expect(enrollment.status).toBe(410);
    expect((await enrollment.json() as any).error.code).toBe('TAILSCALE_DISABLED');
    expect(tailscaleRequests).toEqual([]);
  });

  it('encrypts, versions, and serves the managed exit catalog only to authenticated users', async () => {
    // Identities are placeholders now: one catalog served verbatim to everyone is
    // how every account came to present the same identity at the exit, which is
    // why the exit could count bytes and never say whose.
    const yaml = `proxies:
  - name: "Managed Test"
    type: vless
    server: 8.8.4.4
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
    expect((await api('exit-catalog')).status).toBe(401);

    const blindWrite = await admin('exit-catalog', { yaml }, 'PUT');
    expect(blindWrite.status).toBe(400);
    expect((await blindWrite.json() as any).error.code).toBe('VALIDATION_ERROR');

    const literalIdentity = await admin(
      'exit-catalog',
      { yaml: yaml.replace('{{TONO_CLIENT_UUID}}', '11111111-1111-4111-8111-111111111111'), expectedRevision: 0 },
      'PUT',
    );
    expect(literalIdentity.status).toBe(400);
    expect((await literalIdentity.json() as any).error.code).toBe('INVALID_CATALOG');

    for (const invalidYaml of [
      yaml.replace('uuid: {{TONO_CLIENT_UUID}}', 'uuid: null'),
      yaml.replace('    uuid: {{TONO_CLIENT_UUID}}\n', '    # {{TONO_CLIENT_UUID}}\n'),
      'proxies:\n  - {name: Broken, type: vless, uuid: null} # {{TONO_CLIENT_UUID}}\n',
    ]) {
      const invalidIdentity = await admin(
        'exit-catalog',
        { yaml: invalidYaml, expectedRevision: 0 },
        'PUT',
      );
      expect(invalidIdentity.status).toBe(400);
      expect((await invalidIdentity.json() as any).error.code).toBe('INVALID_CATALOG');
    }

    const created = await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT');
    expect(created.status).toBe(200);
    const createdBody = await created.json() as any;
    expect(createdBody.revision).toBe(1);

    const publishAudit = await env.DB.prepare(
      `SELECT actor_email, action, target_type, target_id, summary
       FROM ops_audit WHERE action = 'catalog.publish'`,
    ).first<any>();
    expect(publishAudit).toMatchObject({
      actor_email: 'token-admin',
      action: 'catalog.publish',
      target_type: 'managed_exit_catalog',
      target_id: '1',
    });
    expect(String(publishAudit.summary)).toMatch(/^published r0 → r1 \([A-Za-z0-9_-]{16}\)$/);

    const stored = await env.DB.prepare(
      'SELECT revision, ciphertext, nonce, content_sha256 FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<any>();
    expect(stored.revision).toBe(1);
    expect(stored.ciphertext).not.toContain('Managed Test');
    expect(stored.ciphertext).not.toContain('TONO_CLIENT_UUID');
    expect(stored.nonce).not.toBe('');

    const adminFetched = await admin('exit-catalog', undefined, 'GET');
    expect(adminFetched.status).toBe(200);
    expect(await adminFetched.json()).toEqual({
      revision: 1,
      yaml,
      sha256: stored.content_sha256,
      updatedAt: createdBody.updatedAt,
    });

    // An account is served its own identity, and the digest is recomputed over
    // what it actually received — the template's digest would read as tampering
    // to a client that verifies, and every client verifies.
    const account = await createAccount('managed-catalog');
    const fetched = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
    const servedBody = await fetched.json() as any;
    expect(servedBody.revision).toBe(1);
    expect(servedBody.yaml).not.toContain('TONO_CLIENT_UUID');
    const issued = /uuid: ([0-9a-f-]{36})/.exec(servedBody.yaml)?.[1];
    expect(issued).toBeTruthy();
    expect(servedBody.sha256).not.toBe(stored.content_sha256);
    // Same encoding the Worker uses (base64url, per src/crypto.ts), so this
    // compares digests rather than encodings.
    const digestOf = async (text: string) => btoa(
      String.fromCharCode(...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
      )),
    ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(servedBody.sha256).toBe(await digestOf(servedBody.yaml));

    // Stable for this account: the client persists the digest and compares it, so
    // a fresh identity per request would look tampered every time.
    const refetched = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect((await refetched.json() as any).yaml).toBe(servedBody.yaml);

    // And distinct from another account's, which is the entire point.
    const other = await createAccount('managed-catalog-two');
    const otherFetched = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    const otherIssued = /uuid: ([0-9a-f-]{36})/.exec(
      (await otherFetched.json() as any).yaml,
    )?.[1];
    expect(otherIssued).toBeTruthy();
    expect(otherIssued).not.toBe(issued);

    const conflict = await admin(
      'exit-catalog',
      { yaml: 'proxies: []\n', expectedRevision: 0 },
      'PUT',
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as any).error.code).toBe('CATALOG_CONFLICT');

    const cleared = await admin(
      'exit-catalog',
      { yaml: 'proxies: []', expectedRevision: 1 },
      'PUT',
    );
    expect(cleared.status).toBe(200);
    expect((await cleared.json() as any).revision).toBe(2);

    const utf8Oversized = await admin(
      'exit-catalog',
      { yaml: `proxies:\n${'#界\n'.repeat(210_000)}`, expectedRevision: 2 },
      'PUT',
    );
    expect(utf8Oversized.status).toBe(400);
    expect((await utf8Oversized.json() as any).error.code).toBe('INVALID_CATALOG');
  });

  it('binds one home exit per user and filters that proxy from other catalogs', async () => {
    const yaml = `proxies:
  - name: "Shared JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
  - name: "Home Residential A"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
  - name: "Home Residential B"
    type: vless
    server: 9.9.9.9
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const homeA = await admin('home-exits', {
      proxyName: 'Home Residential A',
      displayName: '家庭 A',
      egressIpv4: '203.0.113.10',
    });
    expect(homeA.status).toBe(201);
    const homeABody = await homeA.json() as any;
    expect(homeABody.homeExit.proxyName).toBe('Home Residential A');
    expect(homeABody.homeExit.egressIpv4).toBe('203.0.113.10');

    const homeB = await admin('home-exits', {
      proxyName: 'Home Residential B',
      displayName: '家庭 B',
      egressIpv4: '203.0.113.20',
    });
    expect(homeB.status).toBe(201);
    const homeBId = ((await homeB.json()) as any).homeExit.id;

    const conflict = await admin('home-exits', {
      proxyName: 'Home Residential A',
      displayName: 'dup',
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as any).error.code).toBe('HOME_EXIT_CONFLICT');

    const owner = await createAccount('home-owner');
    const other = await createAccount('home-other');

    const bound = await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeABody.homeExit.id },
      'PUT',
    );
    expect(bound.status).toBe(201);
    expect((await bound.json() as any).binding).toMatchObject({
      userId: owner.user.id,
      proxyName: 'Home Residential A',
      egressIpv4: '203.0.113.10',
    });

    const rebound = await admin(
      `users/${owner.user.id}/home-binding`,
      { proxyName: 'Home Residential B' },
      'PUT',
    );
    expect(rebound.status).toBe(200);
    const reboundBody = await rebound.json() as any;
    expect(reboundBody.binding.proxyName).toBe('Home Residential B');
    expect(reboundBody.binding.homeExitId).toBe(homeBId);

    // Re-bind owner to A for the filter assertion below.
    expect((await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeABody.homeExit.id },
      'PUT',
    )).status).toBe(200);

    const ownerCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(ownerCatalog.status).toBe(200);
    const ownerBody = await ownerCatalog.json() as any;
    expect(ownerBody.yaml).toContain('Shared JP');
    expect(ownerBody.yaml).toContain('Home Residential A');
    expect(ownerBody.yaml).not.toContain('Home Residential B');
    const ownerIssued = /uuid: ([0-9a-f-]{36})/.exec(ownerBody.yaml)?.[1];
    expect(ownerIssued).toBeTruthy();
    expect(ownerBody.yaml).not.toContain('TONO_CLIENT_UUID');
    expect(ownerBody.sha256).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(otherCatalog.status).toBe(200);
    const otherBody = await otherCatalog.json() as any;
    expect(otherBody.yaml).toContain('Shared JP');
    expect(otherBody.yaml).not.toContain('Home Residential A');
    expect(otherBody.yaml).not.toContain('Home Residential B');
    const otherIssued = /uuid: ([0-9a-f-]{36})/.exec(otherBody.yaml)?.[1];
    expect(otherIssued).toBeTruthy();
    expect(otherIssued).not.toBe(ownerIssued);

    // Admin catalog remains the full authority.
    const adminCatalog = await admin('exit-catalog', undefined, 'GET');
    expect(adminCatalog.status).toBe(200);
    const adminBody = await adminCatalog.json() as any;
    expect(adminBody.yaml).toContain('Home Residential A');
    expect(adminBody.yaml).toContain('Home Residential B');
    expect(adminBody.yaml).toContain('Shared JP');
    expect(adminBody.yaml).toContain('{{TONO_CLIENT_UUID}}');

    const listed = await admin('home-bindings', undefined, 'GET');
    expect(listed.status).toBe(200);
    expect((await listed.json() as any).bindings).toEqual([
      expect.objectContaining({
        userId: owner.user.id,
        proxyName: 'Home Residential A',
      }),
    ]);

    const inUse = await admin(`home-exits/${homeABody.homeExit.id}`, undefined, 'DELETE');
    expect(inUse.status).toBe(409);
    expect((await inUse.json() as any).error.code).toBe('HOME_EXIT_IN_USE');

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    const unboundCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const unboundBody = await unboundCatalog.json() as any;
    expect(unboundBody.yaml).toContain('Shared JP');
    expect(unboundBody.yaml).not.toContain('Home Residential A');
    expect(unboundBody.yaml).not.toContain('Home Residential B');

    expect((await admin(`home-exits/${homeABody.homeExit.id}`, undefined, 'DELETE')).status).toBe(204);
    expect((await admin(`home-exits/${homeBId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('publishes routing metadata to bound users and validates defaultProxyName', async () => {
    const yaml = `proxies:
  - name: "Shared VPS JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
  - name: "Home Residential Route"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const home = await admin('home-exits', {
      proxyName: 'Home Residential Route',
      displayName: '家庭路由',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id;

    const owner = await createAccount('routing-owner');
    const other = await createAccount('routing-other');

    // defaultProxyName must not collide with any registered home exit proxyName.
    const invalid = await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeId, defaultProxyName: 'Home Residential Route' },
      'PUT',
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json() as any).error.code).toBe('INVALID_DEFAULT_PROXY');

    const bound = await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeId, defaultProxyName: 'Shared VPS JP' },
      'PUT',
    );
    expect(bound.status).toBe(201);
    expect((await bound.json() as any).binding).toMatchObject({
      proxyName: 'Home Residential Route',
      defaultProxyName: 'Shared VPS JP',
    });

    const ownerCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(ownerCatalog.status).toBe(200);
    expect((await ownerCatalog.json() as any).routing).toEqual({
      homeProxy: 'Home Residential Route',
      defaultProxy: 'Shared VPS JP',
    });

    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(otherCatalog.status).toBe(200);
    expect((await otherCatalog.json() as any)).not.toHaveProperty('routing');

    const dashAfterBind = await operations('dashboard');
    expect((await dashAfterBind.json() as any).dashboard.inventory.usersWithoutHome).toBe(1);

    // The admin full catalog never carries routing metadata.
    const adminCatalog = await admin('exit-catalog', undefined, 'GET');
    expect(adminCatalog.status).toBe(200);
    expect((await adminCatalog.json() as any)).not.toHaveProperty('routing');

    // Re-binding without defaultProxyName leaves routing with only homeProxy.
    const rebound = await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeId },
      'PUT',
    );
    expect(rebound.status).toBe(200);
    expect((await rebound.json() as any).binding.defaultProxyName).toBeUndefined();
    const noDefault = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await noDefault.json() as any).routing).toEqual({ homeProxy: 'Home Residential Route' });

    // The ops product route accepts and persists defaultProxyName as well.
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const opsBound = await api(`ops/users/${owner.user.id}/home-binding`, {
      method: 'PUT',
      headers: accessHeaders,
      body: JSON.stringify({ homeExitId: homeId, defaultProxyName: 'Shared VPS JP' }),
    });
    expect(opsBound.status).toBe(200);
    expect((await opsBound.json() as any).binding.defaultProxyName).toBe('Shared VPS JP');
    const opsCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await opsCatalog.json() as any).routing).toEqual({
      homeProxy: 'Home Residential Route',
      defaultProxy: 'Shared VPS JP',
    });

    const opsInvalid = await api(`ops/users/${owner.user.id}/home-binding`, {
      method: 'PUT',
      headers: accessHeaders,
      body: JSON.stringify({ homeExitId: homeId, defaultProxyName: 'Home Residential Route' }),
    });
    expect(opsInvalid.status).toBe(400);
    expect((await opsInvalid.json() as any).error.code).toBe('INVALID_DEFAULT_PROXY');

    // The ops users listing surfaces defaultProxyName for the admin console.
    const opsUsers = await operations('users');
    expect(opsUsers.status).toBe(200);
    const opsListed = (await opsUsers.json() as any).users
      .find((row: any) => row.id === owner.user.id);
    expect(opsListed.homeBinding).toMatchObject({
      homeExitId: homeId,
      proxyName: 'Home Residential Route',
      defaultProxyName: 'Shared VPS JP',
    });

    // The ops console reads the full plaintext catalog without routing metadata.
    const opsCatalogFull = await operations('exit-catalog');
    expect(opsCatalogFull.status).toBe(200);
    const opsCatalogBody = await opsCatalogFull.json() as any;
    expect(opsCatalogBody.yaml).toContain('Shared VPS JP');
    expect(opsCatalogBody.yaml).toContain('Home Residential Route');
    expect(opsCatalogBody).not.toHaveProperty('routing');
  });

  it('advances the catalog revision on every home-exit/binding write so clients re-sync', async () => {
    const yaml = `proxies:
  - name: "Shared VPS"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
  - name: "Home Route"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    const revision = async () =>
      Number(((await (await admin('exit-catalog', undefined, 'GET')).json()) as any).revision);
    const base = await revision();

    const home = await admin('home-exits', { proxyName: 'Home Route', displayName: '家宽' });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id;
    expect(await revision()).toBe(base + 1);

    const owner = await createAccount('revision-owner');
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(201);
    expect(await revision()).toBe(base + 2);

    // Re-binding the same exit is still a served-catalog event (routing re-apply).
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(200);
    expect(await revision()).toBe(base + 3);

    expect(
      (await admin(`home-exits/${homeId}`, { notes: 'retire note' }, 'PATCH')).status,
    ).toBe(200);
    expect(await revision()).toBe(base + 4);

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    expect(await revision()).toBe(base + 5);

    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
    expect(await revision()).toBe(base + 6);
  });

  it('validates socks5 home-exit fields on both admin and ops write paths', async () => {
    const base = { proxyName: 'Home Socks A', displayName: '家宽 Socks A' };
    const creds = {
      kind: 'socks5',
      socks5Host: '203.0.113.50',
      socks5Port: 11080,
      socks5Username: 'resi-user',
      socks5Password: 'resi-secret',
    };

    // Missing any of the four upstream fields is a 400.
    for (const omit of ['socks5Host', 'socks5Port', 'socks5Username', 'socks5Password'] as const) {
      const body: Record<string, unknown> = { ...base, ...creds };
      delete body[omit];
      expect((await admin('home-exits', body)).status).toBe(400);
      expect((await api('ops/home-exits', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        },
        body: JSON.stringify(body),
      })).status).toBe(400);
    }
    // Out-of-range / non-integer ports are a 400.
    for (const port of [0, 65536, 1.5, '11080']) {
      expect((await admin('home-exits', { ...base, ...creds, socks5Port: port })).status).toBe(400);
    }
    // Malformed hosts are a 400; IPv4 literals and hostnames are accepted.
    for (const host of ['', 'not a host', '10.0.0.1 x', 'http://x', '-bad-.com', '256.1.1.1']) {
      expect((await admin('home-exits', { ...base, ...creds, socks5Host: host })).status).toBe(400);
    }
    // A catalog-kind exit must not carry socks5 fields.
    expect((await admin('home-exits', { ...base, socks5Host: '203.0.113.50' })).status).toBe(400);
    expect((await admin('home-exits', { ...base, kind: 'weird' })).status).toBe(400);

    // Happy path: both write paths accept a complete socks5 exit, and the
    // response shows kind/host/port but never the credentials.
    const created = await admin('home-exits', { ...base, ...creds });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as any;
    expect(createdBody.homeExit.kind).toBe('socks5');
    expect(createdBody.homeExit.socks5Host).toBe('203.0.113.50');
    expect(createdBody.homeExit.socks5Port).toBe(11080);
    expect(createdBody.homeExit).not.toHaveProperty('socks5Username');
    expect(createdBody.homeExit).not.toHaveProperty('socks5Password');
    const homeId = createdBody.homeExit.id as string;

    // PATCH keeps stored fields when omitted and validates merged values.
    expect((await admin(`home-exits/${homeId}`, { socks5Port: 0 }, 'PATCH')).status).toBe(400);
    expect((await admin(`home-exits/${homeId}`, { socks5Host: 'bad host' }, 'PATCH')).status).toBe(400);
    const patched = await admin(`home-exits/${homeId}`, { socks5Port: 11081 }, 'PATCH');
    expect(patched.status).toBe(200);
    expect((await patched.json() as any).homeExit.socks5Port).toBe(11081);
    // Switching back to catalog wipes the upstream fields.
    const toCatalog = await admin(`home-exits/${homeId}`, { kind: 'catalog' }, 'PATCH');
    expect(toCatalog.status).toBe(200);
    const catalogBody = await toCatalog.json() as any;
    expect(catalogBody.homeExit.kind).toBe('catalog');
    expect(catalogBody.homeExit).not.toHaveProperty('socks5Host');
    // And switching to socks5 without the full field set fails.
    expect((await admin(`home-exits/${homeId}`, { kind: 'socks5' }, 'PATCH')).status).toBe(400);

    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('serves homeSocks5 credentials only inside the bound user catalog routing', async () => {
    const yaml = `proxies:
  - name: "Shared VPS JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const home = await admin('home-exits', {
      proxyName: 'Home Socks Route',
      displayName: '家宽 Socks',
      kind: 'socks5',
      socks5Host: 'resi-gateway.example.com',
      socks5Port: 11080,
      socks5Username: 'resi-user',
      socks5Password: 'resi-secret',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id as string;

    const owner = await createAccount('socks5-owner');
    const other = await createAccount('socks5-other');
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(201);

    const ownerBody = await (await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })).json() as any;
    expect(ownerBody.routing).toEqual({
      homeSocks5: {
        host: 'resi-gateway.example.com',
        port: 11080,
        username: 'resi-user',
        password: 'resi-secret',
      },
    });
    // A socks5-kind exit names no catalog node, so nothing is filtered out.
    expect(ownerBody.yaml).toContain('Shared VPS JP');

    // Unbound users get no routing and no credential material at all.
    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    const otherText = await otherCatalog.text();
    expect(otherText).not.toContain('homeSocks5');
    expect(otherText).not.toContain('resi-user');
    expect(otherText).not.toContain('resi-secret');

    // No GET endpoint may echo the credentials: admin/ops exit listings,
    // binding views, and the ops user list all show at most host:port.
    const adminList = await admin('home-exits', undefined, 'GET');
    expect((await adminList.clone().text()).includes('resi-secret')).toBe(false);
    const adminRows = (await adminList.json() as any).homeExits;
    expect(adminRows).toEqual([
      expect.objectContaining({ kind: 'socks5', socks5Host: 'resi-gateway.example.com', socks5Port: 11080 }),
    ]);
    expect(adminRows[0]).not.toHaveProperty('socks5Username');
    expect(adminRows[0]).not.toHaveProperty('socks5Password');

    const opsList = await operations('home-exits');
    expect(await opsList.text()).not.toContain('resi-secret');

    const bindings = await admin('home-bindings', undefined, 'GET');
    expect((await bindings.clone().text()).includes('resi-secret')).toBe(false);
    expect((await bindings.json() as any).bindings).toEqual([
      expect.objectContaining({ userId: owner.user.id, kind: 'socks5', socks5Host: 'resi-gateway.example.com' }),
    ]);

    const binding = await admin(`users/${owner.user.id}/home-binding`, undefined, 'GET');
    expect((await binding.clone().text()).includes('resi-secret')).toBe(false);
    expect((await binding.json() as any).binding).toEqual(
      expect.objectContaining({ kind: 'socks5', socks5Host: 'resi-gateway.example.com', socks5Port: 11080 }),
    );

    const opsUsers = await operations('users');
    const opsUsersText = await opsUsers.text();
    expect(opsUsersText).not.toContain('resi-secret');
    expect(opsUsersText).not.toContain('resi-user');

    // Ops/admin plaintext catalogs carry no routing (and no credentials).
    const opsCatalog = await operations('exit-catalog');
    const opsCatalogBody = await opsCatalog.json() as any;
    expect(opsCatalogBody).not.toHaveProperty('routing');

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('moves routingSha256 for a routing-only rotation that leaves revision and yaml untouched', async () => {
    const yaml = `proxies:
  - name: "Shared VPS JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    // A socks5 home exit names no catalog node, so its rotations never touch
    // the served proxies YAML — the routing document is the only thing moving.
    const home = await admin('home-exits', {
      proxyName: 'Home Socks Rotation',
      displayName: '家宽轮换',
      kind: 'socks5',
      socks5Host: 'resi-gateway.example.com',
      socks5Port: 11080,
      socks5Username: 'resi-user',
      socks5Password: 'resi-secret',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id as string;

    const owner = await createAccount('routing-digest-owner');
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(201);

    const fetchOwner = async () => (await (await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })).json()) as any;

    const bound = await fetchOwner();
    expect(bound.routingSha256).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Refetching without a change is stable across all three components.
    const refetched = await fetchOwner();
    expect(refetched.revision).toBe(bound.revision);
    expect(refetched.sha256).toBe(bound.sha256);
    expect(refetched.routingSha256).toBe(bound.routingSha256);

    // Rotate the upstream credential in place. The admin PATCH also advances
    // the fleet revision as belt and braces; writing the row directly is the
    // server state a client has to be able to detect on its own.
    await env.DB.prepare('UPDATE home_exits SET socks5_password = ? WHERE id = ?')
      .bind('resi-rotated', homeId).run();

    const rotated = await fetchOwner();
    expect(rotated.revision).toBe(bound.revision);
    expect(rotated.sha256).toBe(bound.sha256);
    expect(rotated.routingSha256).not.toBe(bound.routingSha256);
    expect(rotated.routing.homeSocks5.password).toBe('resi-rotated');

    // A default-proxy change is a routing-only change too.
    await env.DB.prepare('UPDATE user_home_bindings SET default_proxy_name = ? WHERE user_id = ?')
      .bind('Shared VPS JP', owner.user.id).run();
    const defaulted = await fetchOwner();
    expect(defaulted.revision).toBe(bound.revision);
    expect(defaulted.sha256).toBe(bound.sha256);
    expect(defaulted.routingSha256).not.toBe(rotated.routingSha256);

    // Unbinding moves the digest rather than dropping the field, so a client
    // that lost its routing sees the key move instead of going blind.
    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    const unbound = await fetchOwner();
    expect(unbound).not.toHaveProperty('routing');
    expect(unbound.routingSha256).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(unbound.routingSha256).not.toBe(defaulted.routingSha256);

    // The ops/admin plaintext catalogs carry no routing, so no routing digest.
    expect((await (await operations('exit-catalog')).json() as any))
      .not.toHaveProperty('routingSha256');
    expect((await (await admin('exit-catalog', undefined, 'GET')).json() as any))
      .not.toHaveProperty('routingSha256');

    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('serves two accounts different yaml digests at one revision without calling it an error', async () => {
    const yaml = `proxies:
  - name: "Shared VPS JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
  - name: "Home Residential Split"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const home = await admin('home-exits', {
      proxyName: 'Home Residential Split',
      displayName: '家庭分流',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id as string;

    const owner = await createAccount('digest-split-owner');
    const other = await createAccount('digest-split-other');
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(201);

    const fetchFor = async (accessToken: string) => {
      const response = await api('exit-catalog', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(response.status).toBe(200);
      return (await response.json()) as any;
    };

    const ownerBody = await fetchFor(owner.accessToken);
    const otherBody = await fetchFor(other.accessToken);

    // Same fleet revision, different bodies: the identity substitution and the
    // home-exit filter are both per account. Different digests at one revision
    // are the normal shape of this endpoint, not tampering.
    expect(otherBody.revision).toBe(ownerBody.revision);
    expect(otherBody.sha256).not.toBe(ownerBody.sha256);
    expect(ownerBody.yaml).toContain('Home Residential Split');
    expect(otherBody.yaml).not.toContain('Home Residential Split');
    expect(otherBody.routingSha256).not.toBe(ownerBody.routingSha256);

    // Each account's own digest is stable on a refetch at the same revision.
    const ownerAgain = await fetchFor(owner.accessToken);
    expect(ownerAgain.sha256).toBe(ownerBody.sha256);
    expect(ownerAgain.routingSha256).toBe(ownerBody.routingSha256);
    const otherAgain = await fetchFor(other.accessToken);
    expect(otherAgain.sha256).toBe(otherBody.sha256);
    expect(otherAgain.routingSha256).toBe(otherBody.routingSha256);

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('assigns a pasted home line to a user and imports unused stock', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const owner = await createAccount('paste-assign');
    const other = await createAccount('paste-other');

    const unauthorized = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: owner.user.id, line: '198.51.100.41:6886:alice:secret-one' }),
    });
    expect(unauthorized.status).toBe(401);

    for (const line of [
      'not-a-line',
      '198.51.100.41:6886',
      '198.51.100.41:0:alice:secret-one',
      '10.0.0.1:6886:alice:secret-one',
    ]) {
      const bad = await api('ops/home-exits/assign', {
        method: 'POST',
        headers: accessHeaders,
        body: JSON.stringify({ userId: owner.user.id, line }),
      });
      expect(bad.status).toBe(400);
    }

    const assigned = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        userId: owner.user.id,
        line: '198.51.100.41:6886:alice:secret-one',
      }),
    });
    expect(assigned.status).toBe(201);
    const assignedBody = await assigned.json() as any;
    expect(assignedBody.homeExit.kind).toBe('socks5');
    expect(assignedBody.homeExit.socks5Host).toBe('198.51.100.41');
    expect(assignedBody.homeExit.socks5Port).toBe(6886);
    expect(assignedBody.homeExit).not.toHaveProperty('socks5Username');
    expect(assignedBody.homeExit).not.toHaveProperty('socks5Password');
    expect(assignedBody.binding.userId).toBe(owner.user.id);
    expect(assignedBody.refreshQueued).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(assignedBody)).not.toContain('secret-one');

    const conflict = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        userId: owner.user.id,
        line: 'alice:secret-two@gw.example.com:11080',
      }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as any).error.code).toBe('HOME_ALREADY_BOUND');

    const replaced = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        userId: owner.user.id,
        line: 'socks5://alice:secret-two@gw.example.com:11080',
        replace: true,
      }),
    });
    expect(replaced.status).toBe(201);
    const replacedBody = await replaced.json() as any;
    expect(replacedBody.replaced).toBe(true);
    expect(replacedBody.homeExit.socks5Host).toBe('gw.example.com');
    expect(replacedBody.retiredHomeExitId).toBe(assignedBody.homeExit.id);

    const listed = await operations('home-exits');
    const rows = (await listed.json() as any).homeExits as Array<{ id: string; status: string }>;
    expect(rows.find((row) => row.id === assignedBody.homeExit.id)?.status).toBe('retired');
    expect(rows.find((row) => row.id === replacedBody.homeExit.id)?.status).toBe('active');
    expect(JSON.stringify(rows)).not.toContain('secret-two');

    const ownerCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const ownerRouting = (await ownerCatalog.json() as any).routing;
    expect(ownerRouting.homeSocks5).toEqual({
      host: 'gw.example.com',
      port: 11080,
      username: 'alice',
      password: 'secret-two',
    });
    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(JSON.stringify(await otherCatalog.json())).not.toContain('secret-two');

    const imported = await api('ops/home-exits/import', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        lines: [
          '203.0.113.20:9000:pool-a:pool-secret',
          '203.0.113.20:9000:pool-a:pool-secret',
          'bad-line',
        ],
      }),
    });
    expect(imported.status).toBe(201);
    const importedBody = await imported.json() as any;
    expect(importedBody.created).toHaveLength(1);
    expect(importedBody.skipped).toHaveLength(1);
    expect(importedBody.failed).toHaveLength(1);
    expect(JSON.stringify(importedBody)).not.toContain('pool-secret');

    const taken = await api('ops/home-exits/assign', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        userId: other.user.id,
        line: 'alice:secret-two@gw.example.com:11080',
      }),
    });
    expect(taken.status).toBe(409);
    expect((await taken.json() as any).error.code).toBe('HOME_EXIT_IN_USE');
  });

  it('keeps a Claude account ledger and an onboarding shortcut', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const owner = await createAccount('claude-ledger');
    const opened = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: owner.user.id, accountRef: 'acct-one@example.com' }),
    });
    expect(opened.status).toBe(201);
    const openedBody = await opened.json() as any;
    expect(openedBody.account).toMatchObject({
      accountRef: 'acct-one@example.com',
      status: 'assigned',
      userId: owner.user.id,
    });

    const clash = await api('ops/product-accounts', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ userId: owner.user.id, accountRef: 'acct-two@example.com' }),
    });
    expect(clash.status).toBe(409);

    const listed = await operations('users');
    const row = ((await listed.json() as any).users as any[]).find((item) => item.id === owner.user.id);
    expect(row.product).toMatchObject({
      accountRef: 'acct-one@example.com',
      status: 'assigned',
      replaceCount: 0,
      incomplete: false,
    });
    expect(row.firstEntitledAt).toBeGreaterThan(0);

    const replaced = await api(`ops/product-accounts/${openedBody.account.id}/replace`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ accountRef: 'acct-two@example.com' }),
    });
    expect(replaced.status).toBe(200);
    const replacedBody = await replaced.json() as any;
    expect(replacedBody.previous.status).toBe('retired');
    expect(replacedBody.account.accountRef).toBe('acct-two@example.com');

    const banned = await api(`ops/product-accounts/${replacedBody.account.id}/ban`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ detail: 'model ban' }),
    });
    expect(banned.status).toBe(200);
    expect((await banned.json() as any).account.status).toBe('banned');

    const detail = await operations(`users/${owner.user.id}/detail`);
    const detailBody = await detail.json() as any;
    expect(detailBody.product.replaceCount).toBe(1);
    expect(detailBody.product.accounts).toHaveLength(2);

    const pending = await api('ops/users/onboard', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        email: 'not-yet@example.com',
        line: '198.51.100.77:7000:pool:secret-line',
        accountRef: 'acct-pending@example.com',
      }),
    });
    expect(pending.status).toBe(202);
    const pendingBody = await pending.json() as any;
    expect(pendingBody.incomplete).toContain('user_not_registered');
    expect(pendingBody.exitIdentityIssued).toBe(false);
    expect(pendingBody.userId).toBeNull();

    const ready = await api('ops/users/onboard', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        email: owner.email,
        line: '198.51.100.78:7000:owner:secret-line',
        accountRef: 'acct-three@example.com',
      }),
    });
    // owner currently has no assigned Claude (banned), so this should assign.
    expect([200, 202, 409]).toContain(ready.status);
    if (ready.status !== 409) {
      const readyBody = await ready.json() as any;
      expect(readyBody.exitIdentityIssued).toBe(true);
      expect(readyBody.userId).toBe(owner.user.id);
    }
    const listedReady = await operations('users');
    const readyRow = ((await listedReady.json() as any).users as any[]).find((item: any) => item.id === owner.user.id);
    expect(readyRow.hasExitIdentity).toBe(true);

    const closed = await api(`ops/users/${owner.user.id}/close`, {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({}),
    });
    expect(closed.status).toBe(200);
    const listedClosed = await operations('users');
    const closedRow = ((await listedClosed.json() as any).users as any[]).find((item: any) => item.id === owner.user.id);
    expect(closedRow.status).toBe('disabled');
    expect(closedRow.homeBinding).toBeNull();
  });

  it('stores a node billing profile and reports who is on a named node', async () => {
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const created = await api('ops/node-profiles', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        catalogName: 'Tokyo · North',
        provider: 'dmit',
        billingUrl: 'https://example.com/clientarea',
        trafficQuotaBytes: 1_000_000_000,
        renewsAt: Math.floor(Date.now() / 1000) + 86400,
      }),
    });
    expect(created.status).toBe(201);
    const profile = (await created.json() as any).profile;
    expect(profile.billingUrl).toBe('https://example.com/clientarea');

    const badUrl = await api('ops/node-profiles', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ catalogName: 'Bad', billingUrl: 'javascript:alert(1)' }),
    });
    expect(badUrl.status).toBe(400);

    const incident = await operations(`incidents/node/${encodeURIComponent('Tokyo · North')}`);
    expect(incident.status).toBe(200);
    expect((await incident.json() as any).affected).toEqual([]);

    const dash = await operations('dashboard');
    expect((await dash.json() as any).dashboard.inventory.renewingSoon).toBe(1);
  });

  it('validates, encrypts, versions, and serves the managed traffic policy', async () => {
    expect((await api('traffic-policy')).status).toBe(401);
    const empty = await admin('traffic-policy', undefined, 'GET');
    expect(empty.status).toBe(200);
    expect((await empty.json() as any).revision).toBe(0);

    const policy = {
      mediaEndpoints: [{ ports: [8000, 443], address: '43.146.27.17' }],
      domains: [
        { ports: [443, 80], host: 'wx.qlogo.cn' },
        { host: 'res.wx.qq.com', ports: [443] },
      ],
      version: 1,
    };
    const blindWrite = await admin('traffic-policy', { policy }, 'PUT');
    expect(blindWrite.status).toBe(400);
    expect((await blindWrite.json() as any).error.code).toBe('VALIDATION_ERROR');

    const created = await admin('traffic-policy', { policy, expectedRevision: 0 }, 'PUT');
    expect(created.status).toBe(200);
    const createdBody = await created.json() as any;
    expect(JSON.parse(createdBody.json)).toEqual({
      version: 1,
      domains: [
        { host: 'res.wx.qq.com', ports: [443] },
        { host: 'wx.qlogo.cn', ports: [80, 443] },
      ],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443, 8000] }],
    });
    const publishAudit = await env.DB.prepare(
      `SELECT actor_email, action, target_type, target_id, summary
       FROM ops_audit WHERE action = 'traffic-policy.publish'`,
    ).first<any>();
    expect(publishAudit).toMatchObject({
      actor_email: 'token-admin',
      action: 'traffic-policy.publish',
      target_type: 'managed_traffic_policy',
      target_id: '1',
    });
    expect(String(publishAudit.summary)).toMatch(/^published r0 → r1 \([A-Za-z0-9_-]{16}\)$/);
    const stored = await env.DB.prepare(
      'SELECT ciphertext, nonce, content_sha256 FROM managed_traffic_policy WHERE singleton_id = 1',
    ).first<any>();
    expect(stored.ciphertext).not.toContain('res.wx.qq.com');
    expect(stored.ciphertext).not.toContain('43.146.27.17');
    expect(stored.nonce).not.toBe('');
    expect(createdBody.sha256).toBe(stored.content_sha256);
    expect(await (await admin('traffic-policy', undefined, 'GET')).json()).toEqual(createdBody);

    const account = await createAccount('managed-traffic-policy');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(await fetched.json()).toEqual(createdBody);
    const conflict = await admin('traffic-policy', { policy, expectedRevision: 0 }, 'PUT');
    expect(conflict.status).toBe(409);

    const webPolicy = {
      ...policy,
      version: 2,
      webDomains: [
        { host: 'www.bilibili.com', ports: [443] },
        { host: 'ykimg.alicdn.com', ports: [443] },
      ],
    };
    const updated = await admin(
      'traffic-policy',
      { policy: webPolicy, expectedRevision: 1 },
      'PUT',
    );
    expect(updated.status).toBe(200);
    expect(JSON.parse((await updated.json() as any).json)).toEqual({
      version: 2,
      domains: [
        { host: 'res.wx.qq.com', ports: [443] },
        { host: 'wx.qlogo.cn', ports: [80, 443] },
      ],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443, 8000] }],
      webDomains: [
        { host: 'www.bilibili.com', ports: [443] },
        { host: 'ykimg.alicdn.com', ports: [443] },
      ],
    });

    const nativeWeChatPolicy = {
      ...webPolicy,
      version: 4,
      directSuffixes: [{ host: 'edu.cn', ports: [443, 80] }],
      tcpEndpoints: [
        { address: '49.51.67.253', ports: [443, 80] },
      ],
    };
    const nativeUpdated = await admin(
      'traffic-policy',
      { policy: nativeWeChatPolicy, expectedRevision: 2 },
      'PUT',
    );
    expect(nativeUpdated.status).toBe(200);
    expect(JSON.parse((await nativeUpdated.json() as any).json)).toEqual({
      version: 4,
      domains: [
        { host: 'res.wx.qq.com', ports: [443] },
        { host: 'wx.qlogo.cn', ports: [80, 443] },
      ],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443, 8000] }],
      webDomains: [
        { host: 'www.bilibili.com', ports: [443] },
        { host: 'ykimg.alicdn.com', ports: [443] },
      ],
      directSuffixes: [{ host: 'edu.cn', ports: [80, 443] }],
      tcpEndpoints: [{ address: '49.51.67.253', ports: [80, 443] }],
    });
    const fetchedV4 = await admin('traffic-policy', undefined, 'GET');
    expect(fetchedV4.status).toBe(200);
    expect(JSON.parse((await fetchedV4.json() as { json: string }).json)).toEqual({
      version: 4,
      domains: [
        { host: 'res.wx.qq.com', ports: [443] },
        { host: 'wx.qlogo.cn', ports: [80, 443] },
      ],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443, 8000] }],
      webDomains: [
        { host: 'www.bilibili.com', ports: [443] },
        { host: 'ykimg.alicdn.com', ports: [443] },
      ],
      directSuffixes: [{ host: 'edu.cn', ports: [80, 443] }],
      tcpEndpoints: [{ address: '49.51.67.253', ports: [80, 443] }],
    });

    const invalidPolicies = [
      { ...policy, version: 3 },
      { ...policy, version: 2 },
      { ...policy, domains: [{ host: '*.qq.com', ports: [443] }] },
      { ...policy, domains: [{ host: 'api.anthropic.com', ports: [443] }] },
      { ...policy, domains: [{ host: 'res.wx.qq.com', ports: [22] }] },
      { ...policy, mediaEndpoints: [{ address: '10.0.0.1', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '43.146.27.0/24', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '43.146.27.999', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '43.146.27.17', ports: [80] }] },
      { ...webPolicy, webDomains: [{ host: '*.bilibili.com', ports: [443] }] },
      { ...webPolicy, webDomains: [{ host: 'api.anthropic.com', ports: [443] }] },
      { ...webPolicy, webDomains: [{ host: 'www.bilibili.com', ports: [80] }] },
      {
        ...webPolicy,
        domains: [{ host: 'v.qq.com', ports: [443] }],
        webDomains: [{ host: 'v.qq.com', ports: [443] }],
      },
      // v3: the suffix must be an exact allowlist entry, never a host under
      // it, never protected, and ports must stay within [80, 443].
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'example.com', ports: [443] }] },
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'www.baidu.com', ports: [443] }] },
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'anthropic.com', ports: [443] }] },
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'baidu.com', ports: [8080] }] },
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'baidu.com', ports: [] }] },
      {
        ...nativeWeChatPolicy,
        directSuffixes: [{ host: 'baidu.com', ports: [443] }, { host: 'baidu.com', ports: [80] }],
      },
    ];
    for (const invalid of invalidPolicies) {
      const response = await admin('traffic-policy', { policy: invalid, expectedRevision: 3 }, 'PUT');
      expect(response.status).toBe(400);
      expect((await response.json() as any).error.code).toBe('VALIDATION_ERROR');
    }
  });

  // Private half of the test-only keypair whose public half is bound as
  // TRAFFIC_POLICY_PUBLIC_KEY in vitest.config.ts. Signing here rather than
  // pasting fixed signatures means these tests still hold if the canonical byte
  // layout changes: they sign whatever the endpoint says it will serve.
  const TEST_POLICY_PKCS8 =
    'MC4CAQAwBQYDK2VwBCIEIAIwT13QKhcJliAMcXcFnjUys571THcVvHLBTICbjKzy';
  const signPolicy = async (json: string) => {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      Uint8Array.from(atob(TEST_POLICY_PKCS8), (c) => c.charCodeAt(0)),
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'Ed25519',
      key,
      new TextEncoder().encode(`tono-traffic-policy-v1\n${json}`),
    );
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  };
  // A host no allowlist in this Worker contains, which is the whole point: a
  // signature is what makes adding one a remote-only change.
  const unlistedPolicy = {
    version: 4,
    domains: [],
    mediaEndpoints: [],
    webDomains: [{ host: 'www.dianping.com', ports: [443] }],
    directSuffixes: [],
    tcpEndpoints: [],
  };

  it('signs a policy over the bytes it will serve, not over the bytes submitted', async () => {
    // The document served is this endpoint's canonicalised output — reordered,
    // sorted, ports normalised. A signature over the operator's input would not
    // cover it, so the tool asks what it would be signing first.
    const submitted = {
      version: 4,
      domains: [],
      mediaEndpoints: [],
      webDomains: [
        { ports: [443], host: 'www.dianping.com' },
        { host: 'shop.dianping.com', ports: [443] },
      ],
      directSuffixes: [],
      tcpEndpoints: [],
    };
    const preview = await admin('traffic-policy', { policy: submitted, dryRun: true }, 'PUT');
    expect(preview.status).toBe(200);
    const previewed = await preview.json() as any;
    expect(previewed.dryRun).toBe(true);
    expect(previewed.signatureRequired).toBe(true);
    expect(previewed.signatureContext).toBe('tono-traffic-policy-v1\n');
    // Canonical, and demonstrably not what was submitted.
    expect(previewed.json).not.toBe(JSON.stringify(submitted));
    expect(JSON.parse(previewed.json).webDomains.map((d: any) => d.host))
      .toEqual(['shop.dianping.com', 'www.dianping.com']);
    // A dry run stores nothing.
    expect((await (await admin('traffic-policy', undefined, 'GET')).json() as any).revision).toBe(0);

    const published = await admin('traffic-policy', {
      policy: submitted,
      expectedRevision: 0,
      signature: await signPolicy(previewed.json),
    }, 'PUT');
    expect(published.status).toBe(200);
    const body = await published.json() as any;
    expect(body.json).toBe(previewed.json);

    // And the client is handed the signature so it can make the same decision.
    const account = await createAccount('signed-policy-delivery');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
    const delivered = await fetched.json() as any;
    expect(delivered.signature).toBe(body.signature);
    expect(JSON.parse(delivered.json).webDomains.map((d: any) => d.host))
      .toEqual(['shop.dianping.com', 'www.dianping.com']);
  });

  it('refuses an unlisted host that arrives without a valid signature', async () => {
    // Unsigned: the allowlist is still the only authority, exactly as before.
    const unsigned = await admin(
      'traffic-policy', { policy: unlistedPolicy, expectedRevision: 0 }, 'PUT',
    );
    expect(unsigned.status).toBe(400);
    expect((await unsigned.json() as any).error.code).toBe('VALIDATION_ERROR');

    // A well-formed signature over a *different* document. This is the attack the
    // dry-run flow could otherwise enable: capture a signature, reuse it.
    const other = await admin('traffic-policy', {
      policy: { version: 4, domains: [], mediaEndpoints: [], webDomains: [{ host: 'www.bilibili.com', ports: [443] }], directSuffixes: [], tcpEndpoints: [] },
      dryRun: true,
    }, 'PUT');
    const replayed = await admin('traffic-policy', {
      policy: unlistedPolicy,
      expectedRevision: 0,
      signature: await signPolicy((await other.json() as any).json),
    }, 'PUT');
    expect(replayed.status).toBe(400);
    expect((await replayed.json() as any).error.code).toBe('TRAFFIC_POLICY_SIGNATURE_INVALID');

    // Signed by the wrong key, right shape.
    const preview = await admin('traffic-policy', { policy: unlistedPolicy, dryRun: true }, 'PUT');
    const foreign = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const forged = await crypto.subtle.sign(
      'Ed25519', foreign.privateKey,
      new TextEncoder().encode(`tono-traffic-policy-v1\n${(await preview.json() as any).json}`),
    );
    const impostor = await admin('traffic-policy', {
      policy: unlistedPolicy,
      expectedRevision: 0,
      signature: btoa(String.fromCharCode(...new Uint8Array(forged))),
    }, 'PUT');
    expect(impostor.status).toBe(400);
    expect((await impostor.json() as any).error.code).toBe('TRAFFIC_POLICY_SIGNATURE_INVALID');

    // Nothing above was stored.
    expect((await (await admin('traffic-policy', undefined, 'GET')).json() as any).revision).toBe(0);
  });

  it('will not let a signature pull a protected host out of the tunnel', async () => {
    // The invariant that must survive a leaked key. A signature relaxes which
    // hosts may route direct; it must never relax which hosts may not. If this
    // ever passes, one stolen key exposes this control plane and Claude traffic
    // — strictly worse than the allowlist the signature replaces.
    for (const field of ['domains', 'webDomains', 'directSuffixes'] as const) {
      for (const host of ['api.anthropic.com', 'claude.ai', 'api.afk.ccwu.cc'.replace('api.afk.ccwu.cc', 'tono.app')]) {
        const attempt = { ...unlistedPolicy, webDomains: [], [field]: [{ host, ports: [443] }] };
        // Even the dry run, which canonicalises as trusted, must refuse.
        const preview = await admin('traffic-policy', { policy: attempt, dryRun: true }, 'PUT');
        expect(preview.status, `${field}/${host}`).toBe(400);
      }
    }
  });

  it('clears a stored signature when an unsigned policy replaces a signed one', async () => {
    // Otherwise the old signature ships alongside new bytes and every client
    // that verifies rejects the whole policy — managed direct routing off,
    // fleet-wide, from a republish that looked like it worked.
    const preview = await admin('traffic-policy', { policy: unlistedPolicy, dryRun: true }, 'PUT');
    const signed = await admin('traffic-policy', {
      policy: unlistedPolicy,
      expectedRevision: 0,
      signature: await signPolicy((await preview.json() as any).json),
    }, 'PUT');
    expect(signed.status).toBe(200);
    expect((await signed.json() as any).signature).toBeTruthy();

    const listedOnly = {
      version: 4,
      domains: [],
      mediaEndpoints: [],
      webDomains: [{ host: 'www.bilibili.com', ports: [443] }],
      directSuffixes: [],
      tcpEndpoints: [],
    };
    const unsigned = await admin(
      'traffic-policy', { policy: listedOnly, expectedRevision: 1 }, 'PUT',
    );
    expect(unsigned.status).toBe(200);
    expect((await unsigned.json() as any).signature).toBeUndefined();
    expect(await env.DB.prepare(
      'SELECT signature FROM managed_traffic_policy WHERE singleton_id = 1',
    ).first<any>()).toEqual({ signature: null });

    // And the policy is still served, rather than 503-ing on a signature that
    // no longer covers anything.
    const account = await createAccount('signature-cleared');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
    expect((await fetched.json() as any).signature).toBeUndefined();
  });

  it('refuses to serve a signed policy whose stored row was altered', async () => {
    const preview = await admin('traffic-policy', { policy: unlistedPolicy, dryRun: true }, 'PUT');
    const canonical = (await preview.json() as any).json;
    expect((await admin('traffic-policy', {
      policy: unlistedPolicy, expectedRevision: 0, signature: await signPolicy(canonical),
    }, 'PUT')).status).toBe(200);

    // Substitute a signature of the right shape that does not cover these bytes,
    // the way a compromised database would.
    await env.DB.prepare(
      'UPDATE managed_traffic_policy SET signature = ? WHERE singleton_id = 1',
    ).bind(await signPolicy(`${canonical} `)).run();
    const account = await createAccount('policy-row-altered');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(503);
    expect((await fetched.json() as any).error.code).toBe('TRAFFIC_POLICY_UNAVAILABLE');
  });

  it('tells the operator when a policy needs no signature at all', async () => {
    // Adding a host the allowlists already cover must not start requiring a key
    // ceremony. Most republishes are this case.
    const preview = await admin('traffic-policy', {
      policy: {
        version: 4,
        domains: [],
        mediaEndpoints: [],
        webDomains: [{ host: 'www.bilibili.com', ports: [443] }],
        directSuffixes: [],
        tcpEndpoints: [],
      },
      dryRun: true,
    }, 'PUT');
    expect(preview.status).toBe(200);
    expect((await preview.json() as any).signatureRequired).toBe(false);
  });

  it('accepts the Feishu family as direct suffixes instead of exact pins', async () => {
    // Shape produced by tooling/scripts/retarget-direct-suffixes.rb. An exact
    // pin only ever covers the apex, so CDN traffic on *.feishucdn.com was
    // never matched; DOMAIN-SUFFIX entries need no DNS answer at all.
    const retargeted = {
      version: 4,
      domains: [{ host: 'res.wx.qq.com', ports: [443] }],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443] }],
      webDomains: [{ host: 'www.bilibili.com', ports: [443] }],
      directSuffixes: [
        { host: 'feishu.cn', ports: [80, 443] },
        { host: 'feishucdn.com', ports: [80, 443] },
        { host: 'larkoffice.com', ports: [443] },
        { host: 'larksuite.com', ports: [443] },
      ],
      tcpEndpoints: [{ address: '49.51.67.253', ports: [443] }],
    };
    const written = await admin('traffic-policy', { policy: retargeted, expectedRevision: 0 }, 'PUT');
    expect(written.status).toBe(200);
    const stored = JSON.parse((await written.json() as any).json);
    expect(stored.directSuffixes.map((entry: any) => entry.host)).toEqual([
      'feishu.cn', 'feishucdn.com', 'larkoffice.com', 'larksuite.com',
    ]);
    expect(stored.webDomains).toEqual([{ host: 'www.bilibili.com', ports: [443] }]);

    // A www. form cannot be a suffix entry, which is why the script folds those
    // ports into the apex rather than carrying the host across.
    const wwwSuffix = await admin('traffic-policy', {
      policy: { ...retargeted, directSuffixes: [{ host: 'www.feishu.cn', ports: [443] }] },
      expectedRevision: 1,
    }, 'PUT');
    expect(wwwSuffix.status).toBe(400);

    // 8080 is why the script refuses to fold non-80/443 ports into a suffix.
    const oddPort = await admin('traffic-policy', {
      policy: { ...retargeted, directSuffixes: [{ host: 'feishucdn.com', ports: [8080] }] },
      expectedRevision: 1,
    }, 'PUT');
    expect(oddPort.status).toBe(400);

    // A repeated suffix must be refused at this boundary. The client rejects the
    // whole revision when it sees one, so accepting it here silently disables
    // managed direct routing on every device until someone republishes.
    const duplicateSuffix = await admin('traffic-policy', {
      policy: {
        ...retargeted,
        directSuffixes: [
          { host: 'feishu.cn', ports: [80] },
          { host: 'feishu.cn', ports: [443] },
        ],
      },
      expectedRevision: 1,
    }, 'PUT');
    expect(duplicateSuffix.status).toBe(400);
    expect((await duplicateSuffix.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts reviewed DingTalk and Feishu native-app domains', async () => {
    // Native app domains feed the signed process/path route on both clients;
    // suffixes cover the macOS browser/CDN policy, while Windows keeps its
    // address-free suffixes disabled until WFP has an equivalent class.
    const officePolicy = {
      version: 4,
      domains: [
        { host: 'open.dingtalk.com', ports: [443, 80] },
        { host: 'open.feishu.cn', ports: [443, 80] },
        { host: 'open.larksuite.com', ports: [443] },
        { host: 'api.snssdk.com', ports: [443] },
      ],
      mediaEndpoints: [],
      webDomains: [],
      directSuffixes: [
        { host: 'dingtalk.com', ports: [80, 443] },
        { host: 'feishu.cn', ports: [80, 443] },
        { host: 'larksuite.com', ports: [443] },
      ],
      tcpEndpoints: [],
    };
    const written = await admin('traffic-policy', {
      policy: officePolicy,
      expectedRevision: 0,
    }, 'PUT');
    expect(written.status).toBe(200);
    const stored = JSON.parse((await written.json() as any).json);
    expect(stored.domains.map((entry: any) => entry.host)).toEqual([
      'api.snssdk.com', 'open.dingtalk.com', 'open.feishu.cn', 'open.larksuite.com',
    ]);
    expect(stored.directSuffixes.map((entry: any) => entry.host)).toEqual([
      'dingtalk.com', 'feishu.cn', 'larksuite.com',
    ]);

    const boundary = await admin('traffic-policy', {
      policy: {
        ...officePolicy,
        domains: [{ host: 'evil-dingtalk.com', ports: [443] }],
        directSuffixes: [],
      },
      expectedRevision: 1,
    }, 'PUT');
    expect(boundary.status).toBe(400);
    expect((await boundary.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unexpected top-level fields on the managed policy and catalog writes', async () => {
    const policy = {
      version: 1,
      domains: [{ host: 'res.wx.qq.com', ports: [443] }],
      mediaEndpoints: [],
    };
    const strayPolicyKey = await admin(
      'traffic-policy',
      { policy, expectedRevision: 0, revision: 9 },
      'PUT',
    );
    expect(strayPolicyKey.status).toBe(400);
    expect((await strayPolicyKey.json() as any).error.code).toBe('VALIDATION_ERROR');

    const strayCatalogKey = await admin(
      'exit-catalog',
      { yaml: 'proxies: []\n', expectedRevision: 0, revision: 9 },
      'PUT',
    );
    expect(strayCatalogKey.status).toBe(400);
    expect((await strayCatalogKey.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('creates an account directly from a verified email and consumes one code winner atomically', async () => {
    const email = `email-otp-${++sequence}@example.com`;
    const started = await startEmailSignIn({
      email,
      deviceName: 'Primary Mac',
      installationId: 'email-otp-installation',
    });
    expect(started.response.status).toBe(202);
    expect(started.code).toMatch(/^\d{6}$/);

    const stored = await env.DB.prepare(
      'SELECT secret_hash, consumed_at FROM auth_challenges WHERE id = ?',
    ).bind(started.challengeId).first<any>();
    expect(stored.secret_hash).not.toContain(started.code);
    expect(stored.consumed_at).toBeNull();

    const attempts = await Promise.all([
      api('auth/email/verify', json({ challengeId: started.challengeId, code: started.code })),
      api('auth/email/verify', json({ challengeId: started.challengeId, code: started.code })),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 401]);
    expect((await api('auth/email/verify', json({
      challengeId: started.challengeId,
      code: started.code,
    }))).status).toBe(401);

    const identity = await env.DB.prepare(
      "SELECT provider, subject FROM auth_identities WHERE provider = 'email'",
    ).first<any>();
    expect(identity).toEqual({ provider: 'email', subject: email });

    const secondEmail = `direct-${sequence}@example.com`;
    const direct = await emailSignIn({
      email: secondEmail,
      deviceName: 'Direct Mac',
      installationId: 'direct-email-installation',
    });
    expect(direct.status).toBe(200);
    expect((await direct.json() as any).user.email).toBe(secondEmail);

    const outsideAllowlist = await startEmailSignIn({
      email: `outside-${sequence}@unauthorized.invalid`,
      deviceName: 'Unknown Mac',
      installationId: 'outside-allowlist-installation',
    });
    expect(outsideAllowlist.response.status).toBe(202);
    expect(outsideAllowlist.code).toBeUndefined();
  });

  it('verifies Google OIDC signature, audience, nonce, direct signup, and replay protection', async () => {
    const email = `google-${++sequence}@example.com`;
    const challengeResponse = await api('auth/oidc/challenge', json({
      provider: 'google',
      deviceName: 'Google Mac',
      installationId: 'google-installation',
    }));
    expect(challengeResponse.status).toBe(200);
    const challenge = await challengeResponse.json() as any;
    const stored = await env.DB.prepare(
      'SELECT secret_hash FROM auth_challenges WHERE id = ?',
    ).bind(challenge.challengeId).first<any>();
    expect(stored.secret_hash).not.toBe(challenge.nonce);

    const wrongAudience = await oidcToken('google', challenge.nonce, {
      subject: 'google-user-1',
      email,
      audience: 'attacker-client.example',
    });
    expect((await api('auth/oidc/verify', json({
      provider: 'google',
      challengeId: challenge.challengeId,
      idToken: wrongAudience,
    }))).status).toBe(401);

    const validToken = await oidcToken('google', challenge.nonce, {
      subject: 'google-user-1',
      email,
    });
    const verified = await api('auth/oidc/verify', json({
      provider: 'google',
      challengeId: challenge.challengeId,
      idToken: validToken,
    }));
    expect(verified.status).toBe(200);
    expect((await verified.json() as any).user.email).toBe(email);
    expect((await api('auth/oidc/verify', json({
      provider: 'google',
      challengeId: challenge.challengeId,
      idToken: validToken,
    }))).status).toBe(401);

    const identity = await env.DB.prepare(
      "SELECT user_id, email FROM auth_identities WHERE provider = 'google' AND subject = ?",
    ).bind('google-user-1').first<any>();
    expect(identity.email).toBe(email);
  });

  it('links a verified Apple identity to the matching existing account', async () => {
    const account = await createAccount('apple-link');
    const challengeResponse = await api('auth/oidc/challenge', json({
      provider: 'apple',
      deviceName: 'Apple Mac',
      installationId: 'apple-link-installation-two',
    }));
    const challenge = await challengeResponse.json() as any;
    const token = await oidcToken('apple', challenge.nonce, {
      subject: 'apple-linked-subject',
      email: account.email,
    });
    const linked = await api('auth/oidc/verify', json({
      provider: 'apple',
      challengeId: challenge.challengeId,
      idToken: token,
    }));
    expect(linked.status).toBe(200);
    expect((await linked.json() as any).user.id).toBe(account.user.id);
    const identity = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE provider = 'apple' AND subject = ?",
    ).bind('apple-linked-subject').first<any>();
    expect(identity.user_id).toBe(account.user.id);
  });

  it('redeems, confirms, logs in without duplicating an installation, rotates refresh, and limits devices', async () => {
    const first = await createAccount('lifecycle');
    resetMockInventory(first.device.id, first.enrollment.hostname);
    const refresh = await api('auth/refresh', json({ refreshToken: first.refreshToken }));
    expect(refresh.status).toBe(200);
    const rotated = await refresh.json() as any;
    expect((await api('auth/refresh', json({ refreshToken: first.refreshToken }))).status).toBe(401);

    const conf = await confirm({ ...first, accessToken: rotated.accessToken });
    expect(conf.status).toBe(200);
    expect(tailscaleRequests.some((r) => r.includes('/tailnet/') && r.includes('/devices'))).toBe(true);
    expect(tailscaleRequests.some((r) =>
      r.includes(`/device/${encodeURIComponent(MGMT_ID)}/tags`) && r.includes('tag:tunnel-client'),
    )).toBe(true);
    // Must not resolve via GET /device/{clientSubmittedStableId}
    expect(tailscaleRequests.some((r) => r.startsWith('GET ') && r.includes(`/device/${STABLE_ID}`))).toBe(false);

    const login = (installationId: string) => emailSignIn({
      email: first.email,
      deviceName: installationId,
      installationId,
    });
    expect((await login('lifecycle-installation-one')).status).toBe(200);
    expect((await login('lifecycle-installation-two')).status).toBe(200);
    // LRU Auto-eviction: third device logs in seamlessly and evicts the oldest active device
    expect((await login('lifecycle-installation-three')).status).toBe(200);
    const activeCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM devices WHERE user_id = ? AND status IN ('pending', 'active')"
    ).bind(first.user.id).first<any>();
    expect(activeCount.c).toBe(2);
    const count = await env.DB.prepare("SELECT count(*) n FROM devices WHERE installation_id='lifecycle-installation-one'").first<any>();
    expect(count.n).toBe(1);
  });

  it('supports an explicit per-user device allowance without changing the default', async () => {
    const account = await createAccount('expanded-device-limit');
    expect(account.user.deviceLimit).toBe(2);

    const expanded = await admin(
      `users/${account.user.id}`,
      { deviceLimit: 5 },
      'PATCH',
    );
    expect(expanded.status).toBe(200);

    const me = await api('me', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json() as any).user.deviceLimit).toBe(5);

    const login = (suffix: string) => emailSignIn({
      email: account.email,
      deviceName: `Expanded ${suffix}`,
      installationId: `expanded-device-limit-installation-${suffix}`,
    });
    for (const suffix of ['two', 'three', 'four', 'five']) {
      expect((await login(suffix)).status).toBe(200);
    }
    // LRU Auto-eviction: sixth device logs in seamlessly and evicts the oldest active device
    const sixth = await login('six');
    expect(sixth.status).toBe(200);

    const stored = await env.DB.prepare(
      'SELECT device_limit FROM users WHERE id = ?',
    ).bind(account.user.id).first<any>();
    expect(stored.device_limit).toBe(5);

    const activeDevices = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM devices WHERE user_id = ? AND status IN ('pending', 'active')"
    ).bind(account.user.id).first<any>();
    expect(activeDevices.c).toBe(5);
  });

  it('automatically rotates and evicts the least recently seen device when limit is reached', async () => {
    const account = await createAccount('lru-rotation');
    const login = (name: string, installationId: string) => emailSignIn({
      email: account.email,
      deviceName: name,
      installationId,
    });

    // Login on device 2
    const res2 = await login('Device 2', 'installation-two');
    expect(res2.status).toBe(200);
    const dev2 = await res2.json() as any;

    // Login on device 3 (exceeds default limit of 2) -> automatically evicts device 1
    const res3 = await login('Device 3', 'installation-three');
    expect(res3.status).toBe(200);
    const dev3 = await res3.json() as any;

    // Device 1 should now be revoked
    const dev1Status = await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>();
    expect(dev1Status.status).toBe('revoked');

    // Trying to use Device 1's refresh token should now fail with 401
    const refresh1 = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(refresh1.status).toBe(401);

    // Device 2 and Device 3 should be active
    const active = await env.DB.prepare(
      "SELECT id, status FROM devices WHERE user_id = ? AND status IN ('pending', 'active')"
    ).bind(account.user.id).all<any>();
    expect(active.results.length).toBe(2);
    const activeIds = active.results.map((r: any) => r.id);
    expect(activeIds).toContain(dev2.device.id);
    expect(activeIds).toContain(dev3.device.id);
  });

  it('confirm resolves via inventory with distinct IDs and stores management id', async () => {
    const account = await createAccount('three-id');
    resetMockInventory(account.device.id, account.enrollment.hostname);

    const tokenRequest = tailscaleRequests.find((request) => request.includes('/oauth/token'));
    expect(tokenRequest).toContain('scope=auth_keys+devices%3Acore');
    expect(tokenRequest).toContain('tags=tag%3Atono-controller');

    const conf = await confirm(account, { stableNodeId: STABLE_ID, nodeId: API_NODE_ID });
    expect(conf.status).toBe(200);
    const body = await conf.json() as any;
    expect(body.device.status).toBe('active');
    expect(body.device.tailscaleNodeId).toBe(MGMT_ID);
    expect(body.device.stableNodeId).toBe(STABLE_ID);
    expect(body.device.tailscaleApiNodeId).toBe(API_NODE_ID);
    expect(body.device.tailscaleIPs).toEqual(TS_IPS);
    expect(account.enrollment.hostname).toMatch(/^tono-[a-f0-9]{32}$/);

    const row = await env.DB.prepare(
      'SELECT tailscale_node_id, tailscale_stable_id, tailscale_api_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.tailscale_node_id).toBe(MGMT_ID);
    expect(row.tailscale_stable_id).toBe(STABLE_ID);
    expect(row.tailscale_api_node_id).toBe(API_NODE_ID);

    // Tags + delete paths use management id only
    expect(tailscaleRequests.some((r) => r.includes(`/device/${MGMT_ID}/tags`))).toBe(true);
    expect(tailscaleRequests.some((r) => r.includes(`/device/${API_NODE_ID}`) || r.includes(`/device/${STABLE_ID}`))).toBe(false);
  });

  it('derives device and installation identity from D1, not mutable JWT claims', async () => {
    const account = await createAccount('jwt-device-context');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    const session = await env.DB.prepare(
      'SELECT id FROM sessions WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
    ).bind(account.user.id, account.device.id).first<any>();
    const forgedClaims = await jwtSign({
      sub: account.user.id,
      sid: session.id,
      did: 'attacker-controlled-device-id',
      iid: 'attacker-controlled-installation-id',
      exp: Math.floor(Date.now() / 1000) + 60,
      }, JWT_TEST_SECRET);

    const devices = await api('devices', {
      headers: { authorization: `Bearer ${forgedClaims}` },
    });
    expect(devices.status).toBe(200);
    const listed = await devices.json() as any;
    expect(listed.devices.find((device: any) => device.id === account.device.id)?.current).toBe(true);

    const wrongDevice = await api('devices/attacker-controlled-device-id/enrollment', json({
      installationId: 'attacker-controlled-installation-id',
    }, forgedClaims));
    expect(wrongDevice.status).toBe(404);

    const confirmed = await confirm({ ...account, accessToken: forgedClaims });
    expect(confirmed.status).toBe(200);
  });

  it('concurrent confirm race: second confirm of same device gets 409; winner stays active', async () => {
    const account = await createAccount('race');
    resetMockInventory(account.device.id, account.enrollment.hostname);

    // Hold the first request at the external tag call, after its D1 claim and
    // durable guard have been written. The second request is truly concurrent.
    const gate = pauseNextTagPromotion();
    const firstRequest = confirm(account);
    await gate.started;
    const second = await confirm(account);
    expect(second.status).toBe(409);
    gate.release();
    const first = await firstRequest;
    expect(first.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT status, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.status).toBe('active');
    expect(row.tailscale_node_id).toBe(MGMT_ID);

    // Winner's node must not have been wrongfully deleted
    expect(mockInventory.some((d) => d.id === MGMT_ID)).toBe(true);
    const deleteOfWinner = tailscaleRequests.filter(
      (r) => r.startsWith('DELETE ') && r.includes(`/device/${MGMT_ID}`),
    );
    expect(deleteOfWinner.length).toBe(0);
  });

  it('does not rotate enrollment while a confirm claim is live', async () => {
    const account = await createAccount('enrollment-claim-race');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    await env.DB.prepare(
      'UPDATE devices SET enrollment_issued_at = ? WHERE id = ?',
    ).bind(Math.floor(Date.now() / 1000) - 61, account.device.id).run();
    const gate = pauseNextTagPromotion();
    const confirming = confirm(account);
    await gate.started;
    try {
      const enrollment = await api(`devices/${account.device.id}/enrollment`, json({
        installationId: 'enrollment-claim-race-installation-one',
      }, account.accessToken));
      expect(enrollment.status).toBe(429);
      const row = await env.DB.prepare(
        'SELECT enrollment_hostname FROM devices WHERE id = ?',
      ).bind(account.device.id).first<any>();
      expect(row.enrollment_hostname).toBe(account.enrollment.hostname);
    } finally {
      gate.release();
    }
    expect((await confirming).status).toBe(200);
  });

  it('second sequential claim while first holds claim returns 409 without deleting', async () => {
    const account = await createAccount('claim-race');
    resetMockInventory(account.device.id, account.enrollment.hostname);

    // Simulate an in-flight claim held by another worker
    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "UPDATE devices SET claim_token = 'held-by-other', claim_expires_at = ? WHERE id = ?",
    ).bind(t + 30, account.device.id).run();

    const conf = await confirm(account);
    expect(conf.status).toBe(409);

    // Still pending, management id not stolen/deleted
    const row = await env.DB.prepare('SELECT status, tailscale_node_id FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>();
    expect(row.status).toBe('pending');
    expect(tailscaleRequests.filter((r) => r.startsWith('DELETE ')).length).toBe(0);
  });

  it('email-code verification rate limit returns 429 after threshold', async () => {
    const account = await createAccount('ratelimit');
    const started = await startEmailSignIn({
      email: account.email,
      deviceName: 'Mac',
      installationId: 'ratelimit-installation-one',
    });
    const wrongCode = started.code === '000000' ? '000001' : '000000';
    const attempt = () => api('auth/email/verify', json({
      challengeId: started.challengeId,
      code: wrongCode,
    }));

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await attempt();
      statuses.push(r.status);
      if (r.status === 429) {
        const body = await r.json() as any;
        expect(body.error.code).toBe('RATE_LIMITED');
      }
    }
    expect(statuses).toContain(429);
    // First attempts are rejected as invalid codes before the limiter closes.
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(1);
  });

  it('atomically limits parallel email-code attempts', async () => {
    const account = await createAccount('parallel-ratelimit');
    const started = await startEmailSignIn({
      email: account.email,
      deviceName: 'Mac',
      installationId: 'parallel-rate-install',
    });
    const wrongCode = started.code === '000000' ? '000001' : '000000';
    const attempts = await Promise.all(Array.from({ length: 12 }, () =>
      api('auth/email/verify', json({
        challengeId: started.challengeId,
        code: wrongCode,
      })),
    ));
    const statuses = attempts.map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(9);
  });

  it('bounds request bodies before JSON parsing', async () => {
    const response = await api('auth/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(20 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect((await response.json() as any).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a mismatched public key instead of falling back to the sole IP candidate', async () => {
    const account = await createAccount('identity-mismatch');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    const response = await confirm(account, { publicKey: 'not-the-inventory-key' });
    expect(response.status).toBe(400);
    expect(tailscaleRequests.some((request) => request.includes('/tags'))).toBe(false);
    const row = await env.DB.prepare(
      'SELECT status, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.status).toBe('pending');
    expect(row.tailscale_node_id).toBeNull();
  });

  it('binds confirm to the server-issued enrollment hostname', async () => {
    const account = await createAccount('hostname-binding');
    resetMockInventory(account.device.id, 'tono-ffffffffffffffffffffffffffffffff');
    const response = await confirm(account);
    expect(response.status).toBe(400);
    expect(tailscaleRequests.some((request) => request.includes('/tags'))).toBe(false);
    const row = await env.DB.prepare(
      'SELECT status, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.status).toBe('pending');
    expect(row.tailscale_node_id).toBeNull();
  });

  it('rejects a mismatched stable id when inventory exposes one', async () => {
    const account = await createAccount('stable-id-mismatch');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    mockInventory[0].stableNodeId = 'server-stable-id';
    const response = await confirm(account, { stableNodeId: 'different-client-stable-id' });
    expect(response.status).toBe(400);
    expect(tailscaleRequests.some((request) => request.includes('/tags'))).toBe(false);
    const row = await env.DB.prepare(
      'SELECT status, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.status).toBe('pending');
    expect(row.tailscale_node_id).toBeNull();
  });

  it('failed promotion compensation enqueues revocation job', async () => {
    const account = await createAccount('promo-fail');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    failNextTagPromotion = true;

    const conf = await confirm(account);
    expect(conf.status).toBe(502);

    const job = await env.DB.prepare(
      'SELECT * FROM revocation_jobs WHERE tailscale_node_id = ?',
    ).bind(MGMT_ID).first<any>();
    expect(job).toBeTruthy();
    expect(job.device_id).toBe(account.device.id);
    // Best-effort process should complete the delete in mock
    expect(job.completed_at).toBeTypeOf('number');

    const device = await env.DB.prepare(
      'SELECT status, claim_token, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(device.status).toBe('pending');
    expect(device.claim_token).toBeNull();
    expect(device.tailscale_node_id).toBeNull();
  });

  it('keeps a durable deletion guard when D1 activation throws after promotion', async () => {
    const account = await createAccount('activate-fail');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_activation
       BEFORE UPDATE OF status ON devices
       WHEN NEW.status = 'active'
       BEGIN
         SELECT RAISE(ABORT, 'TEST_ACTIVATION_FAILURE');
       END`,
    ).run();
    try {
      const response = await confirm(account);
      expect(response.status).toBe(503);
      const job = await env.DB.prepare(
        'SELECT completed_at, reason FROM revocation_jobs WHERE tailscale_node_id = ?',
      ).bind(MGMT_ID).first<any>();
      expect(job).toBeTruthy();
      expect(job.reason).toBe('confirm_guard');
      expect(job.completed_at).toBeTypeOf('number');
      expect(mockInventory.some((device) => device.id === MGMT_ID)).toBe(false);
      const device = await env.DB.prepare(
        'SELECT status, tailscale_node_id, claim_token FROM devices WHERE id = ?',
      ).bind(account.device.id).first<any>();
      expect(device.status).toBe('pending');
      expect(device.tailscale_node_id).toBeNull();
      expect(device.claim_token).toBeNull();
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_activation').run();
    }
  });

  it('fences re-enrollment until an expired in-flight identity is deleted', async () => {
    const account = await createAccount('expiry-race');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    const gate = pauseNextTagPromotion();
    const confirmRequest = confirm(account);
    await gate.started;

    // The claim is in flight with its guard persisted. Expire the pending row
    // and reopen the installation through the normal login path.
    await env.DB.prepare(
      'UPDATE devices SET pending_expires_at = ? WHERE id = ?',
    ).bind(Math.floor(Date.now() / 1000) - 1, account.device.id).run();
    const login = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expiry-race-installation-one',
    });
    expect(login.status).toBe(409);
    expect((await login.json() as any).error.code).toBe('REVOCATION_PENDING');

    gate.release();
    const staleConfirm = await confirmRequest;
    expect(staleConfirm.status).toBe(409);
    const retry = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expiry-race-installation-one',
    });
    expect(retry.status).toBe(200);
    const device = await env.DB.prepare(
      'SELECT status, claim_generation, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(device.status).toBe('pending');
    expect(device.tailscale_node_id).toBeNull();
    expect(mockInventory.some((candidate) => candidate.id === MGMT_ID)).toBe(false);
  });

  it('pending expire enqueues revocation when management id present', async () => {
    const account = await createAccount('expire-rev');
    const t = Math.floor(Date.now() / 1000);
    // Simulate mid-confirm: management id stored on still-pending device that is now expired
    await env.DB.prepare(
      `UPDATE devices SET tailscale_node_id = ?, pending_expires_at = ?, status = 'pending' WHERE id = ?`,
    ).bind(MGMT_ID, t - 10, account.device.id).run();

    // Login runs ensureDevice → expirePending (auth for expired pending session would 401)
    const login = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expire-rev-installation-one',
    });
    expect(login.status).toBe(409);
    expect((await login.json() as any).error.code).toBe('REVOCATION_PENDING');

    const device = await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>();
    // expirePending revokes; ensureDevice then re-opens a pending row on the same device id
    expect(['revoked', 'pending']).toContain(device.status);

    const job = await env.DB.prepare(
      'SELECT * FROM revocation_jobs WHERE device_id = ? AND tailscale_node_id = ?',
    ).bind(account.device.id, MGMT_ID).first<any>();
    expect(job).toBeTruthy();

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);
    const retry = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expire-rev-installation-one',
    });
    expect(retry.status).toBe(200);
  });

  it('processes durable revocations before retention housekeeping can fail', async () => {
    const account = await createAccount('revocation-before-retention');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);

    // Leave the outbox pending after the request path's immediate attempt.
    failNextDelete = true;
    const disabled = await admin(`users/${account.user.id}`, { status: 'disabled' }, 'PATCH');
    expect(disabled.status).toBe(200);
    const pending = await env.DB.prepare(
      'SELECT id, completed_at FROM revocation_jobs WHERE device_id = ?',
    ).bind(account.device.id).first<any>();
    expect(pending).toBeTruthy();
    expect(pending.completed_at).toBeNull();

    // Force the first retention statement to abort. Security enforcement must
    // already have retried the durable deletion when this failure surfaces.
    await env.DB.prepare(
      "INSERT INTO rate_limits(key, count, window_start) VALUES('force-retention-failure', 1, 0)",
    ).run();
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_retention
       BEFORE DELETE ON rate_limits
       BEGIN
         SELECT RAISE(ABORT, 'TEST_RETENTION_FAILURE');
       END`,
    ).run();
    try {
      const context = createExecutionContext();
      await worker.scheduled(createScheduledController(), env as unknown as Env, context);
      await expect(waitOnExecutionContext(context)).rejects.toThrow(/TEST_RETENTION_FAILURE/);

      const completed = await env.DB.prepare(
        'SELECT completed_at, last_error FROM revocation_jobs WHERE id = ?',
      ).bind(pending.id).first<any>();
      expect(completed.completed_at).toBeTypeOf('number');
      expect(completed.last_error).toBeNull();
      expect(mockInventory.some((device) => device.id === MGMT_ID)).toBe(false);
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_retention').run();
    }
  });

  it('scheduled cleanup revokes superseded pending enrollment hostnames', async () => {
    const account = await createAccount('stale-enrollment');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    mockInventory.push({
      id: 'mgmt-superseded',
      nodeId: 'nodeid-superseded',
      name: 'tono-ffffffffffffffffffffffffffffffff',
      nodeKey: 'nodekey:public-key-superseded',
      addresses: ['100.64.0.99'],
      tags: ['tag:pending-tunnel-client'],
      description: `tono-device-${account.device.id}`,
    });

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);

    expect(tailscaleRequests.some((request) =>
      request.startsWith('DELETE ') && request.includes('/device/mgmt-superseded'),
    )).toBe(true);
    expect(tailscaleRequests.some((request) =>
      request.startsWith('DELETE ') && request.includes(`/device/${MGMT_ID}`),
    )).toBe(false);
  });

  it('disables access and revokes the active tailnet device', async () => {
    const account = await createAccount('disabled');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    const response = await admin(`users/${account.user.id}`, { status: 'disabled' }, 'PATCH');
    expect(response.status).toBe(200);
    expect((await api('me', { headers: { authorization: `Bearer ${account.accessToken}` } })).status).toBe(401);
    expect((await api('auth/refresh', json({ refreshToken: account.refreshToken }))).status).toBe(401);
    const device = await env.DB.prepare('SELECT status FROM devices WHERE id=?').bind(account.device.id).first<any>();
    expect(device.status).toBe('revoked');
    const job = await env.DB.prepare('SELECT completed_at FROM revocation_jobs WHERE device_id=?').bind(account.device.id).first<any>();
    expect(job.completed_at).toBeTypeOf('number');
  });

  it('refuses to re-enable a user if a prior disable left a live device without an outbox job', async () => {
    const account = await createAccount('reenable-invariant');
    // Simulate an invocation ending immediately after the user status write,
    // before enforceUser could transition the pending device and create jobs.
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .bind(account.user.id).run();
    const response = await admin(`users/${account.user.id}`, { status: 'active' }, 'PATCH');
    expect(response.status).toBe(409);
    expect((await response.json() as any).error.code).toBe('REVOCATION_PENDING');
    const user = await env.DB.prepare('SELECT status FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(user.status).toBe('disabled');
  });

  it('only lets the bound installation re-enroll its active device', async () => {
    const account = await createAccount('reenroll');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    // Re-enroll needs inventory for any subsequent confirm; enrollment issues a key
    const own = await api(`devices/${account.device.id}/enrollment`, json({
      installationId: 'reenroll-installation-one',
    }, account.accessToken));
    expect(own.status).toBe(200);
    expect((await own.json() as any).enrollment.authKey).toMatch(/^tskey-mock-/);

    const other = await emailSignIn({
      email: account.email,
      deviceName: 'Other Mac',
      installationId: 'reenroll-installation-two',
    });
    expect(other.status).toBe(200);
    const otherAuth = await other.json() as any;
    expect((await api(`devices/${account.device.id}/enrollment`, json({}, otherAuth.accessToken))).status).toBe(404);
  });

  it('does not issue a replacement enrollment while the prior identity revocation is pending', async () => {
    const account = await createAccount('reenroll-revoke-failure');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    const keyRequestsBefore = tailscaleRequests.filter(
      (request) => request.startsWith('POST ') && request.includes('/keys'),
    ).length;

    failNextDelete = true;
    const blocked = await api(`devices/${account.device.id}/enrollment`, json({
      installationId: 'reenroll-revoke-failure-installation-one',
    }, account.accessToken));
    expect(blocked.status).toBe(409);
    expect((await blocked.json() as any).error.code).toBe('REVOCATION_PENDING');
    expect(tailscaleRequests.filter(
      (request) => request.startsWith('POST ') && request.includes('/keys'),
    )).toHaveLength(keyRequestsBefore);

    const pendingJob = await env.DB.prepare(
      'SELECT completed_at FROM revocation_jobs WHERE device_id = ? AND tailscale_node_id = ?',
    ).bind(account.device.id, MGMT_ID).first<any>();
    expect(pendingJob).toBeTruthy();
    expect(pendingJob.completed_at).toBeNull();

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);

    const retry = await api(`devices/${account.device.id}/enrollment`, json({
      installationId: 'reenroll-revoke-failure-installation-one',
    }, account.accessToken));
    expect(retry.status).toBe(200);
    expect((await retry.json() as any).enrollment.authKey).toMatch(/^tskey-mock-/);
  });

  it('releases the enrollment lease after a transient key-issuance failure', async () => {
    const email = `key-retry-${++sequence}@example.com`;
    failNextKeyIssue = true;
    const redeem = await emailSignIn({
      email,
      deviceName: 'Primary Mac',
      installationId: 'key-retry-installation-one',
    });
    expect(redeem.status).toBe(502);

    const login = await emailSignIn({
      email,
      deviceName: 'Primary Mac',
      installationId: 'key-retry-installation-one',
    });
    expect(login.status).toBe(200);
    expect((await login.json() as any).enrollment.authKey).toMatch(/^tskey-mock-/);
  });

  it('serves an exit identity roster that excludes accounts an exit must drop', async () => {
    const yaml = `proxies:
  - name: "Metered"
    type: vless
    server: 8.8.4.4
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    // A roster entry only exists once an account has been issued an identity,
    // which happens on its first catalog fetch.
    const active = await createAccount('roster-active');
    const capped = await createAccount('roster-capped');
    for (const account of [active, capped]) {
      expect((await api('exit-catalog', {
        headers: { authorization: `Bearer ${account.accessToken}` },
      })).status).toBe(200);
    }

    expect((await api('home/exit-identities')).status).toBe(401);

    const listed = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect(listed.status).toBe(200);
    const roster = await listed.json() as any;
    expect(typeof roster.observedAt).toBe('number');
    const identities = roster.identities as Array<{ userId: string; clientUUID: string }>;
    expect(identities.map((entry) => entry.userId).sort())
      .toEqual([active.user.id, capped.user.id].sort());
    // Two accounts, two identities: a roster that repeated one would put both on
    // the same counter and make usage unattributable again.
    expect(new Set(identities.map((entry) => entry.clientUUID)).size).toBe(2);

    // Passing the quota removes the account from the roster, because removal is
    // what stops traffic — an enforcement that only stops counting stops nothing.
    await env.DB.prepare(
      'UPDATE users SET quota_bytes = 100, usage_bytes = 100 WHERE id = ?',
    ).bind(capped.user.id).run();
    const afterQuota = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect((await afterQuota.json() as any).identities.map((e: any) => e.userId))
      .toEqual([active.user.id]);

    // So does being disabled.
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .bind(active.user.id).run();
    const afterSuspend = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect((await afterSuspend.json() as any).identities).toEqual([]);
  });

  it('revokes sessions and devices as soon as a usage report reaches quota', async () => {
    const account = await createAccount('quota');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    expect((await admin(`users/${account.user.id}`, { quotaBytes: 100 }, 'PATCH')).status).toBe(200);
    const usage = await api('home/usage', json({ reports: [{
      reportId: `report-${sequence}`,
      userId: account.user.id,
      totalBytes: 100,
      observedAt: Math.floor(Date.now() / 1000),
    }] }, HOME_TOKEN));
    expect(usage.status).toBe(200);
    expect((await api('me', { headers: { authorization: `Bearer ${account.accessToken}` } })).status).toBe(401);
    const device = await env.DB.prepare('SELECT status FROM devices WHERE id=?').bind(account.device.id).first<any>();
    expect(device.status).toBe('revoked');
  });

  it('sets, updates, and clears expiresAt through the admin PATCH route', async () => {
    const account = await createAccount('expiry');
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86_400;

    const set = await admin(`users/${account.user.id}`, { expiresAt }, 'PATCH');
    expect(set.status).toBe(200);
    let row = await env.DB.prepare('SELECT expires_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(Number(row.expires_at)).toBe(expiresAt);

    const updated = await admin(`users/${account.user.id}`, { expiresAt: expiresAt + 3_600 }, 'PATCH');
    expect(updated.status).toBe(200);
    row = await env.DB.prepare('SELECT expires_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(Number(row.expires_at)).toBe(expiresAt + 3_600);

    const cleared = await admin(`users/${account.user.id}`, { expiresAt: null }, 'PATCH');
    expect(cleared.status).toBe(200);
    row = await env.DB.prepare('SELECT expires_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(row.expires_at).toBeNull();
  });

  it('rejects invalid expiresAt values with 400', async () => {
    const account = await createAccount('expiry-invalid');
    for (const expiresAt of [0, -100, 1.5, 'tomorrow', Number.MAX_SAFE_INTEGER + 1]) {
      const response = await admin(`users/${account.user.id}`, { expiresAt }, 'PATCH');
      expect(response.status).toBe(400);
      expect((await response.json() as any).error.code).toBe('VALIDATION_ERROR');
    }
    const row = await env.DB.prepare('SELECT expires_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(row.expires_at).toBeNull();
  });

  it('exposes only verified peer usage mappings to the authenticated home agent', async () => {
    const account = await createAccount('home-inventory');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);

    const unauthorized = await api('home/inventory');
    expect(unauthorized.status).toBe(401);

    const response = await api('home/inventory', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.devices).toEqual([{
      stableNodeId: STABLE_ID,
      publicKey: PUBLIC_KEY.replace(/^nodekey:/, ''),
      userId: account.user.id,
      status: 'active',
      usageBytes: 0,
    }]);
    expect(JSON.stringify(payload)).not.toContain(account.email);
    expect(JSON.stringify(payload)).not.toContain(account.device.installationId);
    expect(JSON.stringify(payload)).not.toContain(MGMT_ID);
    expect(JSON.stringify(payload)).not.toContain(API_NODE_ID);
  });

  it('treats reportId as an immutable idempotency key', async () => {
    const account = await createAccount('usage-idempotency');
    const observedAt = Math.floor(Date.now() / 1000);
    const reportId = `immutable-report-${sequence}`;
    const original = {
      reportId,
      userId: account.user.id,
      totalBytes: 25,
      observedAt,
    };
    expect((await api('home/usage', json({ reports: [original] }, HOME_TOKEN))).status).toBe(200);
    expect((await api('home/usage', json({ reports: [original] }, HOME_TOKEN))).status).toBe(200);

    const conflict = await api('home/usage', json({ reports: [{
      ...original,
      totalBytes: 50,
    }] }, HOME_TOKEN));
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as any).error.code).toBe('USAGE_REPORT_CONFLICT');

    const user = await env.DB.prepare('SELECT usage_bytes FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(user.usage_bytes).toBe(25);
    const stored = await env.DB.prepare('SELECT total_bytes FROM usage_reports WHERE report_id = ?')
      .bind(reportId).first<any>();
    expect(stored.total_bytes).toBe(25);
  });

  it('rejects non-object usage report entries as validation errors', async () => {
    const response = await api('home/usage', json({ reports: [null] }, HOME_TOKEN));
    expect(response.status).toBe(400);
    expect((await response.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('stores the catalog revision a snapshot result reports and bounds it', async () => {
    const owner = await createAccount('snapshot-catalog-owner');
    const queued = await admin('device-actions', {
      deviceId: owner.device.id, action: 'diagnostic_snapshot', ttlSeconds: 300,
    });
    expect(queued.status).toBe(201);
    const command = (await queued.json() as any).action;
    const poll = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await poll.json() as any).actions[0].id).toBe(command.id);

    // Out of range is still refused, the same bounds the telemetry window uses.
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { connected: true, catalogRevision: -1 },
    }, owner.accessToken))).status).toBe(400);

    // Every signed-in client with a catalog installed puts this field in the
    // snapshot, and answering "which catalog is that Mac running" on demand is
    // what the action is for, so the result has to land rather than 400.
    const result = {
      outcome: 'succeeded',
      snapshot: { connected: true, catalogRevision: 41 },
    };
    expect((await api(`device-actions/${command.id}/result`, json(result, owner.accessToken))).status).toBe(200);
    const stored = await env.DB.prepare('SELECT result_json FROM device_actions WHERE id = ?')
      .bind(command.id).first<any>();
    expect(JSON.parse(stored.result_json)).toEqual(result);
  });

  it('isolates allowlisted device actions and safely replays bounded canonical results', async () => {
    const owner = await createAccount('action-owner');
    const other = await createAccount('action-other');
    expect((await admin('device-actions', {
      deviceId: owner.device.id, action: 'run_shell', code: 'id',
    })).status).toBe(400);
    expect((await admin('device-actions', {
      deviceId: owner.device.id, action: 'diagnostic_snapshot', parameters: {},
    })).status).toBe(400);
    expect((await admin('device-actions', {
      deviceId: owner.device.id, action: 'diagnostic_snapshot', code: 'id',
    })).status).toBe(400);
    expect((await admin('device-actions', null)).status).toBe(400);

    const queued = await admin('device-actions', {
      deviceId: owner.device.id, action: 'diagnostic_snapshot', ttlSeconds: 300,
    });
    expect(queued.status).toBe(201);
    const command = (await queued.json() as any).action;
    const otherPoll = await api('device-actions', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect((await otherPoll.json() as any).actions).toEqual([]);

    const first = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await first.json() as any).actions[0].status).toBe('delivered');
    const replay = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await replay.json() as any).actions[0].id).toBe(command.id);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { connected: true, shell: '/bin/sh' },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', message: 'x'.repeat(201),
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { lastErrorCategory: '/Users/customer/private' },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { lastCrashLabel: '/Users/customer/private' },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json(null, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { connected: true, reconnectAttempt: 2 },
    }, other.accessToken))).status).toBe(404);

    const result = {
      outcome: 'succeeded',
      snapshot: {
        connected: true, reconnectAttempt: 2, lastErrorCategory: 'data_plane',
        lastCrashLabel: 'SIGSEGV',
      },
    };
    expect((await api(`device-actions/${command.id}/result`, json(result, owner.accessToken))).status).toBe(200);
    expect((await api(`device-actions/${command.id}/result`, json(result, owner.accessToken))).status).toBe(200);
    expect((await api(`device-actions/${command.id}/result`, json({ outcome: 'failed' }, owner.accessToken))).status).toBe(409);
    const stored = await env.DB.prepare('SELECT status, result_json FROM device_actions WHERE id = ?')
      .bind(command.id).first<any>();
    expect(stored.status).toBe('succeeded');
    expect(JSON.parse(stored.result_json)).toEqual(result);

    const trafficQueued = await admin('device-actions', {
      deviceId: owner.device.id, action: 'claude_traffic_snapshot', ttlSeconds: 300,
    });
    expect(trafficQueued.status).toBe(201);
    const trafficCommand = (await trafficQueued.json() as any).action;
    const trafficPoll = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await trafficPoll.json() as any).actions[0].id).toBe(trafficCommand.id);
    const trafficSummary = {
      observedSince: Math.floor(Date.now() / 1000) - 60,
      droppedEndpointCount: 0,
      observedConnectionCount: 8,
      identifiedProcessConnectionCount: 3,
      proxiedConnectionCount: 7,
      directConnectionCount: 0,
      blockedConnectionCount: 1,
      directRouteAttemptCount: 0,
      managedDirectRouteCount: 2,
      unclassifiedRouteCount: 0,
      unsafeProtectionObservationCount: 0,
      webManagedDirectConnectionCount: 0,
      weChatConnectionCount: 2,
      weChatManagedDirectConnectionCount: 0,
      weChatProxiedConnectionCount: 2,
      weChatBlockedConnectionCount: 0,
      weChatEndpointUnknownProcessConnectionCount: 1,
      unknownManagedDirectConnectionCount: 0,
      otherManagedDirectConnectionCount: 0,
      protectedDirectConnectionCount: 0,
      connectionLimitReached: false,
      connected: true,
      killSwitchArmed: true,
      tunPresent: true,
      protectedDNSConfigured: true,
      exitIdentityConsistency: 'MATCHED',
      physicalBypassProbe: 'BLOCKED',
    };
    expect((await api(`device-actions/${trafficCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        entries: [{
          service: 'claude', client: 'web', host: 'www.reclaude.ai',
          network: 'TCP', port: 443, route: 'PROXIED', connections: 1,
          upBytes: 10, downBytes: 20,
        }],
      },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${trafficCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        entries: [{
          service: 'anthropic', client: 'code', host: 'api.anthropic.com',
          network: 'TCP', port: 443, route: 'PROXIED', connections: 2,
          upBytes: 100, downBytes: 200, processPath: '/Users/customer/bin/claude',
        }],
      },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${trafficCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        protectedDirectConnectionCount: 1,
        entries: [],
      },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${trafficCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        physicalBypassProbe: 'IGNORED',
        entries: [],
      },
    }, owner.accessToken))).status).toBe(400);
    const trafficResult = {
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        entries: [
          {
            service: 'anthropic', client: 'code', host: 'api.anthropic.com',
            network: 'TCP', port: 443, route: 'PROXIED', connections: 2,
            upBytes: 100, downBytes: 200,
          },
          {
            service: 'claude', client: 'unknown', host: 'claude.ai',
            network: 'UDP', port: 443, route: 'PROXIED', connections: 3,
            upBytes: 300, downBytes: 400,
          },
          {
            service: 'other', client: 'code', host: 'example.com',
            network: 'TCP', port: 443, route: 'PROXIED', connections: 1,
            upBytes: 50, downBytes: 60,
          },
        ],
      },
    };
    expect((await api(`device-actions/${trafficCommand.id}/result`, json(
      trafficResult, owner.accessToken,
    ))).status).toBe(200);
    const storedTraffic = await env.DB.prepare('SELECT status, result_json FROM device_actions WHERE id = ?')
      .bind(trafficCommand.id).first<any>();
    expect(storedTraffic.status).toBe('succeeded');
    expect(JSON.parse(storedTraffic.result_json)).toEqual(trafficResult);

    const expiring = await admin('device-actions', {
      deviceId: owner.device.id, action: 'refresh_catalog', ttlSeconds: 1,
    });
    const expiringID = (await expiring.json() as any).action.id;
    await env.DB.prepare('UPDATE device_actions SET expires_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000) - 1, expiringID).run();
    const afterExpiry = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await afterExpiry.json() as any).actions).toEqual([]);
    expect((await env.DB.prepare('SELECT status FROM device_actions WHERE id = ?').bind(expiringID).first<any>()).status).toBe('expired');
    expect((await api(`device-actions/${expiringID}/result`, json({
      outcome: 'succeeded',
    }, owner.accessToken))).status).toBe(409);

    await env.DB.prepare("UPDATE devices SET status = 'revoked' WHERE id = ?").bind(owner.device.id).run();
    expect((await admin('device-actions', {
      deviceId: owner.device.id, action: 'refresh_catalog',
    })).status).toBe(404);
    expect((await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })).status).toBe(401);
  });

  const routingResearchPayload = (overrides: Record<string, unknown> = {}) => {
    const observedUntil = Math.floor(Date.now() / 1000) - 60;
    return {
      schemaVersion: 1,
      snapshotId: crypto.randomUUID(),
      observedSince: observedUntil - 6 * 60 * 60,
      observedUntil,
      appVersion: '0.0.1',
      build: '40',
      osVersion: '26.4',
      architecture: 'arm64',
      observedConnectionCount: 3,
      identifiedAppConnectionCount: 2,
      connectionLimitReached: false,
      entries: [
        {
          app: 'other', connectionCount: 1, directConnectionCount: 0,
          proxiedConnectionCount: 1, blockedConnectionCount: 0,
          trafficVolume: 'under_1_mib',
        },
        {
          app: 'wechat', connectionCount: 2, directConnectionCount: 1,
          proxiedConnectionCount: 1, blockedConnectionCount: 0,
          trafficVolume: '10_to_100_mib',
        },
      ],
      ...overrides,
    };
  };

  const routingResearchV2Payload = (overrides: Record<string, unknown> = {}) => ({
    ...routingResearchPayload(),
    schemaVersion: 2,
    bundleComponents: [
      {
        app: 'wechat', bundleComponent: 'main_executable',
        connectionCount: 1, directConnectionCount: 1,
        proxiedConnectionCount: 0, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      },
      {
        app: 'wechat', bundleComponent: 'framework_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: '10_to_100_mib',
      },
    ],
    ...overrides,
  });

  it('upgrades the routing-research table from the 4 KiB v1 constraint', async () => {
    const definition = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'routing_research_snapshots'",
    ).first<any>();
    expect(definition.sql).toContain('length(aggregate_json) <= 8192');

    const account = await createAccount('routing-research-migration');
    const observedUntil = Math.floor(Date.now() / 1000) - 60;
    await expect(env.DB.prepare(
      `INSERT INTO routing_research_snapshots(
         id, snapshot_id, user_id, device_id, received_at, observed_since,
         observed_until, app_version, build, os_version, architecture,
         aggregate_json
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), crypto.randomUUID(), account.user.id,
      account.device.id, observedUntil, observedUntil - 6 * 60 * 60,
      observedUntil, '0.0.1', '40', '26.4', 'arm64', 'x'.repeat(5_000),
    ).run()).resolves.toBeDefined();
  });

  it('stores only a canonical authenticated routing-research aggregate and replays it idempotently', async () => {
    const account = await createAccount('routing-research-happy');
    const payload = routingResearchPayload();
    expect((await api('routing-research/snapshots', json(payload))).status).toBe(401);
    expect((await api(
      'routing-research/snapshots',
      json(payload, account.accessToken),
    )).status).toBe(409);
    const mismatchedOwner = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, 'a-different-account',
      ),
    );
    expect(mismatchedOwner.status).toBe(409);
    expect((await mismatchedOwner.json() as any).error.code).toBe(
      'ROUTING_RESEARCH_OWNER_MISMATCH',
    );

    const accepted = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect(accepted.status).toBe(201);
    const receipt = await accepted.json() as any;
    expect(Object.keys(receipt).sort()).toEqual(['receivedAt', 'snapshotId']);
    expect(receipt.snapshotId).toBe(payload.snapshotId);

    const stored = await env.DB.prepare(
      'SELECT * FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).first<any>();
    expect(stored.user_id).toBe(account.user.id);
    expect(stored.device_id).toBe(account.device.id);
    expect(stored.app_version).toBe('0.0.1');
    expect(stored.build).toBe('40');
    expect(JSON.parse(stored.aggregate_json)).toEqual({
      ...payload,
      snapshotId: payload.snapshotId.toLowerCase(),
      entries: [...payload.entries].sort((left, right) => left.app.localeCompare(right.app)),
    });

    const replay = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(receipt);
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(1);

    const conflict = routingResearchPayload({
      snapshotId: payload.snapshotId,
      observedConnectionCount: 4,
      identifiedAppConnectionCount: 3,
      entries: [
        payload.entries[0],
        {
          ...payload.entries[1], connectionCount: 3,
          proxiedConnectionCount: 2,
        },
      ],
    });
    // Keep the immutable window fields identical so this tests ID reuse rather
    // than an unrelated timestamp difference.
    conflict.observedSince = payload.observedSince;
    conflict.observedUntil = payload.observedUntil;
    const rejectedConflict = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        conflict, account.accessToken, account.user.id,
      ),
    );
    expect(rejectedConflict.status).toBe(409);
    expect((await rejectedConflict.json() as any).error.code).toBe('SNAPSHOT_ID_CONFLICT');

    await expect(env.DB.prepare(
      'UPDATE routing_research_snapshots SET build = ? WHERE snapshot_id = ?',
    ).bind('41', payload.snapshotId).run()).rejects.toThrow(
      /ROUTING_RESEARCH_SNAPSHOT_IMMUTABLE/,
    );
  });

  it('accepts only fixed schema-v2 native bundle component categories', async () => {
    const account = await createAccount('routing-research-components');
    const payload = routingResearchV2Payload({
      bundleComponents: [
        {
          app: 'wechat', bundleComponent: 'main_executable',
          connectionCount: 1, directConnectionCount: 1,
          proxiedConnectionCount: 0, blockedConnectionCount: 0,
          trafficVolume: 'under_1_mib',
        },
        {
          app: 'wechat', bundleComponent: 'framework_helper',
          connectionCount: 1, directConnectionCount: 0,
          proxiedConnectionCount: 1, blockedConnectionCount: 0,
          trafficVolume: '10_to_100_mib',
        },
      ],
    });
    const response = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect(response.status).toBe(201);
    const stored = await env.DB.prepare(
      'SELECT aggregate_json FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).first<any>();
    expect(JSON.parse(stored.aggregate_json).bundleComponents).toEqual([
      payload.bundleComponents[1], payload.bundleComponents[0],
    ]);
  });

  it('accepts the expanded reviewed app families and keeps snapshots bounded', async () => {
    const account = await createAccount('routing-research-expanded-apps');
    const apps = [
      'wechat', 'qq', 'feishu', 'lark', 'dingtalk', 'trae', 'chrome', 'edge',
      'safari', 'firefox', 'arc', 'brave', 'claude', 'wecom',
      'tencent_meeting', 'wps', 'baidu_netdisk', 'alipan', 'douyin',
      'bilibili',
    ];
    const entries = apps.map((app) => ({
      app, connectionCount: 1, directConnectionCount: 0,
      proxiedConnectionCount: 1, blockedConnectionCount: 0,
      trafficVolume: 'under_1_mib',
    }));
    const payload = routingResearchV2Payload({
      observedConnectionCount: entries.length,
      identifiedAppConnectionCount: entries.length,
      connectionLimitReached: true,
      entries,
      bundleComponents: [{
        app: 'tencent_meeting', bundleComponent: 'framework_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      }],
    });
    const accepted = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect(accepted.status).toBe(201);
    const stored = await env.DB.prepare(
      'SELECT aggregate_json FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).first<any>();
    const canonical = JSON.parse(stored.aggregate_json);
    expect(canonical.entries).toHaveLength(20);
    expect(canonical.bundleComponents).toEqual(payload.bundleComponents);
  });

  it('rejects raw metadata, covert strings, malformed totals, timestamps, and oversized research bodies', async () => {
    const account = await createAccount('routing-research-validation');
    const submit = async (payload: unknown) => api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect((await submit({
      ...routingResearchPayload(),
      processPath: '/Users/customer/Applications/Private.app',
    })).status).toBe(400);
    expect((await submit({
      ...routingResearchPayload(),
      bundleComponents: [],
    })).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{
        app: 'wechat', bundleComponent: '/Users/customer/WeChat.app',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'none',
      }],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{
        app: 'chrome', bundleComponent: 'framework_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'none',
      }],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{
        app: 'wechat', bundleComponent: 'customer_named_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'none',
      }],
    }))).status).toBe(400);
    const duplicateComponent = routingResearchV2Payload().bundleComponents[0];
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [duplicateComponent, duplicateComponent],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{
        ...duplicateComponent,
        connectionCount: 3, directConnectionCount: 1,
        proxiedConnectionCount: 2,
      }],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{ ...duplicateComponent, executable: 'WeChat' }],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      entries: [
        routingResearchPayload().entries[0],
        { ...routingResearchPayload().entries[1], trafficVolume: 'none' },
      ],
      bundleComponents: [duplicateComponent],
    }))).status).toBe(400);
    const rawEntry = routingResearchPayload();
    rawEntry.entries = [{ ...rawEntry.entries[0], host: 'private.example.com' } as any];
    rawEntry.observedConnectionCount = 1;
    rawEntry.identifiedAppConnectionCount = 0;
    expect((await submit(rawEntry)).status).toBe(400);
    expect((await submit(routingResearchPayload({
      entries: [{
        app: 'private-editor', connectionCount: 3, directConnectionCount: 0,
        proxiedConnectionCount: 3, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      }],
      identifiedAppConnectionCount: 3,
    }))).status).toBe(400);
    const tooManyFixedApps = [
      'wechat', 'qq', 'feishu', 'lark', 'dingtalk', 'trae', 'chrome', 'edge',
      'safari', 'firefox', 'arc', 'brave', 'claude', 'wecom',
      'tencent_meeting', 'wps', 'baidu_netdisk', 'alipan', 'douyin',
      'bilibili', 'netease_music',
    ].map((app) => ({
      app, connectionCount: 1, directConnectionCount: 0,
      proxiedConnectionCount: 1, blockedConnectionCount: 0,
      trafficVolume: 'under_1_mib',
    }));
    expect((await submit(routingResearchPayload({
      observedConnectionCount: tooManyFixedApps.length,
      identifiedAppConnectionCount: tooManyFixedApps.length,
      connectionLimitReached: true,
      entries: tooManyFixedApps,
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      appVersion: '/Users/customer/Documents',
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      build: 'private.example.com',
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      observedConnectionCount: 4,
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      entries: [{
        app: 'wechat', connectionCount: 3, directConnectionCount: 1,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: '10_to_100_mib',
      }],
      identifiedAppConnectionCount: 3,
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      entries: [{
        app: 'wechat', connectionCount: 3, directConnectionCount: 1,
        proxiedConnectionCount: 2, blockedConnectionCount: 0,
        trafficVolume: 'exactly_123_bytes',
      }],
      identifiedAppConnectionCount: 3,
    }))).status).toBe(400);
    const fiveHourUntil = Math.floor(Date.now() / 1000) - 60;
    expect((await submit(routingResearchPayload({
      observedSince: fiveHourUntil - 5 * 60 * 60,
      observedUntil: fiveHourUntil,
    }))).status).toBe(400);
    const staleUntil = Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60;
    expect((await submit(routingResearchPayload({
      observedSince: staleUntil - 6 * 60 * 60,
      observedUntil: staleUntil,
    }))).status).toBe(400);
    expect((await submit({
      ...routingResearchPayload(),
      padding: 'x'.repeat(9 * 1024),
    })).status).toBe(413);
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(0);
  });

  it('caps distinct routing-research snapshots per device without blocking an exact retry', async () => {
    const account = await createAccount('routing-research-rate');
    const accepted: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const payload = routingResearchPayload();
      accepted.push(payload);
      expect((await api(
        'routing-research/snapshots',
        await routingResearchJson(
          payload, account.accessToken, account.user.id,
        ),
      )).status).toBe(201);
    }
    const limited = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        routingResearchPayload(), account.accessToken, account.user.id,
      ),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json() as any).error.code).toBe('RATE_LIMITED');
    expect((await api(
      'routing-research/snapshots',
      await routingResearchJson(
        accepted[0], account.accessToken, account.user.id,
      ),
    )).status).toBe(200);
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(4);
  });

  it('suppresses all routing-research metadata below the cohort minimum', async () => {
    const accounts = await Promise.all([
      createAccount('routing-suppressed-one'),
      createAccount('routing-suppressed-two'),
    ]);
    for (const account of accounts) {
      const payload = routingResearchV2Payload();
      expect((await api(
        'routing-research/snapshots',
        await routingResearchJson(
          payload, account.accessToken, account.user.id,
        ),
      )).status).toBe(201);
    }
    const response = await admin(
      'routing-research/summary?days=30', undefined, 'GET',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      days: 30,
      cohortMinimum: 3,
      suppressed: true,
      byApp: [],
      byBundleComponent: [],
      byBuild: [],
    });
  });

  it('returns only cohort-safe app, route, volume, and build research summaries', async () => {
    const accounts = await Promise.all([
      createAccount('routing-summary-one'),
      createAccount('routing-summary-two'),
      createAccount('routing-summary-three'),
    ]);
    for (const [index, account] of accounts.entries()) {
      const entries = [{
        app: 'wechat', connectionCount: 2, directConnectionCount: 1,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: '10_to_100_mib',
      }];
      if (index === 0) entries.push({
        app: 'safari', connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      });
      const bundleComponents = [{
        app: 'wechat', bundleComponent: 'main_executable',
        connectionCount: 1, directConnectionCount: 1,
        proxiedConnectionCount: 0, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      }];
      if (index === 0) bundleComponents.push({
        app: 'wechat', bundleComponent: 'framework_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: '10_to_100_mib',
      });
      const payload = routingResearchV2Payload({
        observedConnectionCount: index === 0 ? 3 : 2,
        identifiedAppConnectionCount: index === 0 ? 3 : 2,
        entries,
        bundleComponents,
      });
      expect((await api(
        'routing-research/snapshots',
        await routingResearchJson(
          payload, account.accessToken, account.user.id,
        ),
      )).status).toBe(201);
    }

    expect((await api('admin/routing-research/summary?days=30')).status).toBe(401);
    const response = await admin(
      'routing-research/summary?days=30',
      undefined,
      'GET',
    );
    expect(response.status).toBe(200);
    const summary = await response.json() as any;
    expect(summary).toMatchObject({
      days: 30,
      cohortMinimum: 3,
      participantCount: 3,
      deviceCount: 3,
      snapshotCount: 3,
      byApp: [{
        app: 'wechat', participantCount: 3, deviceCount: 3,
        snapshotCount: 3, connectionCount: 6,
        directConnectionCount: 3, proxiedConnectionCount: 3,
        blockedConnectionCount: 0,
        trafficVolumes: { '10_to_100_mib': 3 },
      }],
      byBundleComponent: [{
        app: 'wechat', bundleComponent: 'main_executable',
        participantCount: 3, deviceCount: 3, snapshotCount: 3,
        connectionCount: 3, directConnectionCount: 3,
        proxiedConnectionCount: 0, blockedConnectionCount: 0,
        trafficVolumes: { under_1_mib: 3 },
      }],
      byBuild: [{
        appVersion: '0.0.1', build: '40', participantCount: 3,
        deviceCount: 3, snapshotCount: 3,
      }],
    });
    const encoded = JSON.stringify(summary);
    for (const account of accounts) {
      expect(encoded).not.toContain(account.user.id);
      expect(encoded).not.toContain(account.device.id);
    }
    expect(encoded).not.toContain('snapshotId');
    expect(encoded).not.toContain('aggregate_json');
    expect((await admin(
      'routing-research/summary?days=91', undefined, 'GET',
    )).status).toBe(400);
    expect((await admin(
      'routing-research/summary?days=30&deviceId=secret', undefined, 'GET',
    )).status).toBe(400);
  });

  it('deletes routing research at retention and with its account', async () => {
    const account = await createAccount('routing-research-retention');
    const payload = routingResearchPayload();
    expect((await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    )).status).toBe(201);
    const row = await env.DB.prepare(
      'SELECT * FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).first<any>();
    await env.DB.prepare(
      'DELETE FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).run();
    const oldUntil = Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60;
    await env.DB.prepare(
      `INSERT INTO routing_research_snapshots(
         id, snapshot_id, user_id, device_id, received_at, observed_since,
         observed_until, app_version, build, os_version, architecture,
         aggregate_json
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), crypto.randomUUID(), account.user.id,
      account.device.id, oldUntil, oldUntil - 6 * 60 * 60, oldUntil,
      row.app_version, row.build, row.os_version, row.architecture,
      row.aggregate_json,
    ).run();
    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(0);

    const fresh = routingResearchPayload();
    expect((await api(
      'routing-research/snapshots',
      await routingResearchJson(
        fresh, account.accessToken, account.user.id,
      ),
    )).status).toBe(201);
    await env.DB.prepare('DELETE FROM users WHERE id = ?')
      .bind(account.user.id).run();
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(0);
  });

  // Pinned verbatim from the client's single definition of the wire contract
  // (`crates/tono-core/src/auth.rs`, `DiagnosticsReport`), which is already
  // shipped. Do NOT edit this object to make the server pass: if the two ever
  // drift, this fixture is the alarm and the server is what moves.
  const shippedClientReport = {
    schemaVersion: 1,
    reportedAtMs: 1712345678901,
    appVersion: '0.0.3',
    osVersion: 'Windows 11 Pro 23H2',
    osArch: 'x86_64',
    serviceProtocol: '2.9',
    serviceBuild: '2.6.2',
    uiState: 'protectedOffline',
    accountState: 'ready',
    selectedServer: 'US West 1',
    catalogRevision: 12,
    killSwitchMode: 'blocked',
    killSwitchWanted: true,
    killSwitchLive: false,
    killSwitchLastError: 'WFP filter add failed (0x80320013)',
    dnsEnabled: true,
    dnsLastError: 'resolver handshake timed out',
    failedStage: 'securingDNS',
    error: 'connect failed after 2 retries',
    retryAttempt: 2,
    totalElapsedMs: 4600,
    steps: [{ key: 'preparing', state: 'completed', elapsedMs: 1200 }],
    virtualAdapters: ['hyperV', 'wsl'],
    auditLogPath: '%USERPROFILE%\\AppData\\Roaming\\Tono\\traffic-audit.jsonl',
    serviceLogPath: 'C:\\ProgramData\\Tono\\logs\\tono-service.log',
  };

  // Overrides patch the report, not the envelope: the envelope is `{report}`.
  const diagnosticsPayload = (overrides: Record<string, unknown> = {}) => ({
    report: { ...shippedClientReport, ...overrides },
  });

  it('accepts the exact payload the shipped client sends, verbatim', async () => {
    const account = await createAccount('diagnostics-contract');
    // The literal body from `auth.rs`, envelope included, byte for byte.
    const response = await api('diagnostics/reports', json(
      { report: shippedClientReport },
      account.accessToken,
    ));
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    // The client requires a non-empty referenceCode and tolerates receivedAt.
    expect(body.referenceCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(typeof body.receivedAt).toBe('number');

    const stored = await env.DB.prepare(
      'SELECT * FROM diagnostics_reports WHERE reference_code = ?',
    ).bind(body.referenceCode).first<any>();
    // Every field survives, unchanged and in the contract's own key order:
    // a drift on either side breaks this equality loudly.
    expect(stored.report_json).toBe(JSON.stringify(shippedClientReport));
    // The columns come from inside the report; there is no second copy on the
    // envelope any more.
    expect(stored.client_version).toBe('0.0.3');
    expect(stored.os_version).toBe('Windows 11 Pro 23H2');
    expect((await api('diagnostics/reports', json({
      clientVersion: '0.0.3', osVersion: 'Windows 11 Pro 23H2', report: shippedClientReport,
    }, account.accessToken))).status).toBe(400);
  });

  it('accepts a user-initiated diagnostics upload and returns only a spoken reference code', async () => {
    const account = await createAccount('diagnostics-happy');
    const payload = diagnosticsPayload();
    const response = await api('diagnostics/reports', json(payload, account.accessToken));
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    // The code plus a display-only receipt time is the entire response: no
    // payload is echoed back to the client.
    expect(Object.keys(body).sort()).toEqual(['receivedAt', 'referenceCode']);
    expect(body.referenceCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(Math.abs(body.receivedAt - Math.floor(Date.now() / 1000))).toBeLessThan(60);

    const stored = await env.DB.prepare(
      'SELECT * FROM diagnostics_reports WHERE reference_code = ?',
    ).bind(body.referenceCode).first<any>();
    expect(stored.user_id).toBe(account.user.id);
    expect(stored.client_version).toBe('0.0.3');
    expect(stored.os_version).toBe('Windows 11 Pro 23H2');
    expect(JSON.parse(stored.report_json)).toEqual(payload.report);

    // An accepted report is immutable evidence; retention deletes, nothing rewrites.
    await expect(env.DB.prepare(
      'UPDATE diagnostics_reports SET client_version = ? WHERE reference_code = ?',
    ).bind('0.0.0', body.referenceCode).run()).rejects.toThrow(/DIAGNOSTICS_REPORT_IMMUTABLE/);

    // Only whitelisted fields survive; anything else is refused, not dropped.
    const extra = await api('diagnostics/reports', json(
      diagnosticsPayload({ wifiSSID: 'home-network' }),
      account.accessToken,
    ));
    expect(extra.status).toBe(400);
    expect((await extra.json() as any).error.code).toBe('VALIDATION_ERROR');

    // A required field is required; the nullable ones may be null or absent.
    const { appVersion, ...missingAppVersion } = shippedClientReport;
    expect((await api('diagnostics/reports', json(
      { report: missingAppVersion }, account.accessToken,
    ))).status).toBe(400);

    const nulled = await api('diagnostics/reports', json(diagnosticsPayload({
      serviceProtocol: null, serviceBuild: null, selectedServer: null,
      catalogRevision: null, killSwitchMode: null, killSwitchWanted: null,
      killSwitchLive: null, killSwitchLastError: null, dnsEnabled: null,
      dnsLastError: null, failedStage: null, error: null, totalElapsedMs: null,
      steps: [{ key: 'preparing', state: 'current', elapsedMs: null }],
      virtualAdapters: [],
    }), account.accessToken));
    expect(nulled.status).toBe(201);
    const nulledStored = await env.DB.prepare(
      'SELECT report_json FROM diagnostics_reports WHERE reference_code = ?',
    ).bind((await nulled.json() as any).referenceCode).first<any>();
    // Null and absent mean the same thing: neither is stored.
    expect(JSON.parse(nulledStored.report_json)).toEqual({
      schemaVersion: 1,
      reportedAtMs: 1712345678901,
      appVersion: '0.0.3',
      osVersion: 'Windows 11 Pro 23H2',
      osArch: 'x86_64',
      uiState: 'protectedOffline',
      accountState: 'ready',
      retryAttempt: 2,
      steps: [{ key: 'preparing', state: 'current' }],
      virtualAdapters: [],
      auditLogPath: shippedClientReport.auditLogPath,
      serviceLogPath: shippedClientReport.serviceLogPath,
    });

    expect((await api('diagnostics/reports', json(payload))).status).toBe(401);
  });

  it('rejects an oversized diagnostics upload instead of truncating it', async () => {
    const account = await createAccount('diagnostics-oversized');
    const overBodyCap = await api('diagnostics/reports', json(
      diagnosticsPayload({ serviceLogPath: 'y'.repeat(40 * 1024) }),
      account.accessToken,
    ));
    expect(overBodyCap.status).toBe(413);
    expect((await overBodyCap.json() as any).error.code).toBe('PAYLOAD_TOO_LARGE');

    // Within the body cap, the per-field bounds refuse rather than truncate.
    const tooManySteps = await api('diagnostics/reports', json(
      diagnosticsPayload({
        steps: Array.from({ length: 33 }, (_, index) => ({
          key: `step-${index}`, state: 'completed', elapsedMs: 10,
        })),
      }),
      account.accessToken,
    ));
    expect(tooManySteps.status).toBe(400);

    const badStepState = await api('diagnostics/reports', json(
      diagnosticsPayload({ steps: [{ key: 'preparing', state: 'skipped', elapsedMs: 1 }] }),
      account.accessToken,
    ));
    expect(badStepState.status).toBe(400);

    const longStepKey = await api('diagnostics/reports', json(
      diagnosticsPayload({ steps: [{ key: 'k'.repeat(61), state: 'failed', elapsedMs: 1 }] }),
      account.accessToken,
    ));
    expect(longStepKey.status).toBe(400);

    const longError = await api('diagnostics/reports', json(
      diagnosticsPayload({ error: 'w'.repeat(501) }),
      account.accessToken,
    ));
    expect(longError.status).toBe(400);

    const longOsVersion = await api('diagnostics/reports', json(
      diagnosticsPayload({ osVersion: 'w'.repeat(81) }),
      account.accessToken,
    ));
    expect(longOsVersion.status).toBe(400);

    // The adapter vocabulary is fixed: unknown classes and repeats are refused.
    const unknownAdapter = await api('diagnostics/reports', json(
      diagnosticsPayload({ virtualAdapters: ['hyperV', 'parallels'] }),
      account.accessToken,
    ));
    expect(unknownAdapter.status).toBe(400);

    const repeatedAdapter = await api('diagnostics/reports', json(
      diagnosticsPayload({ virtualAdapters: ['wsl', 'wsl'] }),
      account.accessToken,
    ));
    expect(repeatedAdapter.status).toBe(400);

    const wildRetry = await api('diagnostics/reports', json(
      diagnosticsPayload({ retryAttempt: 1001 }),
      account.accessToken,
    ));
    expect(wildRetry.status).toBe(400);

    const wildElapsed = await api('diagnostics/reports', json(
      diagnosticsPayload({ totalElapsedMs: 24 * 60 * 60 * 1000 + 1 }),
      account.accessToken,
    ));
    expect(wildElapsed.status).toBe(400);

    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM diagnostics_reports WHERE user_id = ?',
    ).bind(account.user.id).first<any>();
    expect(Number(rows.total)).toBeLessThanOrEqual(1);
  });

  it('caps diagnostics uploads per user per hour', async () => {
    const account = await createAccount('diagnostics-ratelimit');
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      const response = await api('diagnostics/reports', json(diagnosticsPayload(), account.accessToken));
      statuses.push(response.status);
      if (response.status === 429) {
        expect((await response.json() as any).error.code).toBe('RATE_LIMITED');
      }
    }
    expect(statuses.filter((status) => status === 201)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM diagnostics_reports WHERE user_id = ?',
    ).bind(account.user.id).first<any>();
    expect(Number(rows.total)).toBe(5);
  });

  it('lets only an admin look a diagnostics report up by reference code', async () => {
    const account = await createAccount('diagnostics-lookup');
    const upload = await api('diagnostics/reports', json(diagnosticsPayload(), account.accessToken));
    expect(upload.status).toBe(201);
    const { referenceCode } = await upload.json() as any;

    expect((await api(`admin/diagnostics/reports/${referenceCode}`)).status).toBe(401);
    expect((await api(`admin/diagnostics/reports/${referenceCode}`, {
      headers: { authorization: `Bearer ${account.accessToken}` },
    })).status).toBe(401);

    const found = await admin(`diagnostics/reports/${referenceCode}`, undefined, 'GET');
    expect(found.status).toBe(200);
    expect((await found.json() as any).report).toMatchObject({
      referenceCode,
      userId: account.user.id,
      clientVersion: '0.0.3',
      osVersion: 'Windows 11 Pro 23H2',
      report: { failedStage: 'securingDNS', virtualAdapters: ['hyperV', 'wsl'] },
    });

    // Support types the code back in however they heard it.
    const typedBack = await admin(
      `diagnostics/reports/${referenceCode.slice(0, 4).toLowerCase()}-${referenceCode.slice(4)}`,
      undefined,
      'GET',
    );
    expect(typedBack.status).toBe(200);

    const unknown = await admin('diagnostics/reports/ZZZZZZZZ', undefined, 'GET');
    expect(unknown.status).toBe(404);
    expect((await unknown.json() as any).error.code).toBe('NOT_FOUND');

    // 0/O/1/I are not in the alphabet, so a misheard code fails validation.
    expect((await admin('diagnostics/reports/O0O0O0O0', undefined, 'GET')).status).toBe(400);
  });

  // Typed as `Uint8Array<ArrayBuffer>` rather than the default
  // `Uint8Array<ArrayBufferLike>`: the latter admits SharedArrayBuffer, which
  // `BlobPart` rejects, so the request body below would not typecheck.
  const gzip = async (text: string): Promise<Uint8Array<ArrayBuffer>> =>
    new Uint8Array(
      await new Response(
        new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
  const gunzip = async (bytes: ArrayBuffer) => new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text();
  const logUpload = async (
    token: string,
    payload: Uint8Array<ArrayBuffer>,
    overrides: Record<string, string> = {},
  ) => api('diagnostics/logs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/gzip',
      'X-Tono-Log-Session': 'FE5919D3-405E-4538-9C4C-1866E088F24F',
      'X-Tono-Log-Sequence': '0',
      'X-Tono-Log-Lines': '3',
      'X-Tono-Log-Client-Version': '0.0.63',
      'X-Tono-Log-Os-Version': 'macOS 26.3',
      ...overrides,
    },
    // Wrapped because a Uint8Array is not a `BodyInit` under the Workers types,
    // even though workerd accepts one at run time.
    body: new Blob([payload]),
  });

  it('stores a raw log segment in R2 and indexes it in D1', async () => {
    const account = await createAccount('log-happy');
    const body = await gzip('{"kind":"connection_opened"}\n{"kind":"mihomo_route"}\n');
    const response = await logUpload(account.accessToken, body);
    expect(response.status).toBe(201);
    const { segment } = await response.json() as any;

    const row = await env.DB.prepare(
      'SELECT * FROM diagnostics_log_objects WHERE id = ?',
    ).bind(segment.id).first() as any;
    expect(row.user_id).toBe(account.user.id);
    expect(row.sequence).toBe(0);
    expect(row.byte_size).toBe(body.byteLength);
    // The key is server-derived from the account, so a client cannot choose
    // where its own segment lands.
    expect(row.r2_key).toBe(
      `logs/${account.user.id}/${new Date(row.received_at * 1000).toISOString().slice(0, 10)}`
      + '/FE5919D3-405E-4538-9C4C-1866E088F24F-0000000.jsonl.gz',
    );
    const stored = await (env as unknown as Env).DIAGNOSTICS_LOGS.get(row.r2_key);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(body);
  });

  it('answers a replayed segment from the index instead of storing it twice', async () => {
    const account = await createAccount('log-replay');
    const first = await logUpload(account.accessToken, await gzip('{"a":1}\n'));
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as any).segment.id;

    // A client that lost its cursor re-sends the same sequence with different
    // bytes. The stored object must not be replaced, or triage would see a
    // segment whose content no longer matches what the first upload recorded.
    const replay = await logUpload(account.accessToken, await gzip('{"different":true}\n'));
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as any).segment.id).toBe(firstId);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM diagnostics_log_objects WHERE user_id = ?',
    ).bind(account.user.id).first() as any;
    expect(count.n).toBe(1);
    const row = await env.DB.prepare(
      'SELECT r2_key FROM diagnostics_log_objects WHERE id = ?',
    ).bind(firstId).first() as any;
    // Decompress before asserting. Reading the object as text compares gzip
    // bytes, in which no plaintext marker ever appears — an assertion that
    // passes whether or not the replay overwrote the segment.
    const stored = await (env as unknown as Env).DIAGNOSTICS_LOGS.get(row.r2_key);
    const text = await gunzip(await stored!.arrayBuffer());
    expect(text).toContain('"a":1');
    expect(text).not.toContain('different');
  });

  it('refuses a log body that is not gzip', async () => {
    const account = await createAccount('log-plaintext');
    const response = await logUpload(
      account.accessToken,
      new TextEncoder().encode('{"kind":"connection_opened"}\n'),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toBe('Expected a gzip body');
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM diagnostics_log_objects',
    ).first() as any;
    expect(count.n).toBe(0);
  });

  it('refuses log metadata that could escape the derived object key', async () => {
    const account = await createAccount('log-key-escape');
    const body = await gzip('{"a":1}\n');
    for (const session of ['../../etc/passwd', 'a/b', 'has space', '']) {
      const response = await logUpload(account.accessToken, body, {
        'X-Tono-Log-Session': session,
      });
      expect(response.status).toBe(400);
    }
    expect(((await logUpload(account.accessToken, body, {
      'X-Tono-Log-Sequence': '-1',
    })).status)).toBe(400);
    expect(((await logUpload(account.accessToken, body, {
      'X-Tono-Log-Sequence': '1e3',
    })).status)).toBe(400);
  });

  it('rejects an oversized log segment without storing a partial object', async () => {
    const account = await createAccount('log-oversize');
    // Incompressible bytes, so the gzip stays above the 2 MiB cap.
    const noise = new Uint8Array(new ArrayBuffer(3 * 1024 * 1024));
    crypto.getRandomValues(noise.subarray(0, 65_536));
    for (let offset = 65_536; offset < noise.byteLength; offset += 65_536) {
      noise.set(noise.subarray(0, 65_536), offset);
    }
    const body = new Uint8Array(new ArrayBuffer(noise.byteLength + 2));
    body.set([0x1f, 0x8b]);
    body.set(noise, 2);
    expect((await logUpload(account.accessToken, body)).status).toBe(413);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM diagnostics_log_objects',
    ).first() as any;
    expect(count.n).toBe(0);
  });

  it('serves a stored segment to admins and lists it per account', async () => {
    const account = await createAccount('log-admin');
    const body = await gzip('{"kind":"connection_opened","host":"example.test"}\n');
    const { segment } = await (await logUpload(account.accessToken, body)).json() as any;

    const listed = await admin(`diagnostics/logs?userId=${account.user.id}`, undefined, 'GET');
    expect(listed.status).toBe(200);
    const { segments } = await listed.json() as any;
    expect(segments.map((row: any) => row.id)).toEqual([segment.id]);
    expect(segments[0].byteSize).toBe(body.byteLength);
    expect(segments[0].clientVersion).toBe('0.0.63');

    const download = await admin(`diagnostics/logs/${segment.id}`, undefined, 'GET');
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/gzip');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(body);

    // No admin token, no payload — this bucket is the one place holding
    // unredacted hostnames.
    expect((await api(`admin/diagnostics/logs/${segment.id}`, { method: 'GET' })).status).toBe(401);
  });

  it('deletes the R2 payload when a log segment passes retention', async () => {
    const account = await createAccount('log-retention');
    const { segment } = await (await logUpload(
      account.accessToken,
      await gzip('{"a":1}\n'),
    )).json() as any;
    const row = await env.DB.prepare(
      'SELECT r2_key FROM diagnostics_log_objects WHERE id = ?',
    ).bind(segment.id).first() as any;

    const inside = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, inside);
    await waitOnExecutionContext(inside);
    expect(await (env as unknown as Env).DIAGNOSTICS_LOGS.get(row.r2_key)).not.toBeNull();

    // The row is immutable by trigger, so it cannot simply be aged in place.
    // Asserting that first is what keeps the replace-outright dance below from
    // quietly becoming the only reason this test passes.
    await expect(env.DB.prepare(
      'UPDATE diagnostics_log_objects SET received_at = ? WHERE id = ?',
    ).bind(Math.floor(Date.now() / 1000) - 15 * 86_400, segment.id).run())
      .rejects.toThrow(/DIAGNOSTICS_LOG_IMMUTABLE/);
    await env.DB.prepare('DELETE FROM diagnostics_log_objects WHERE id = ?')
      .bind(segment.id).run();
    await env.DB.prepare(
      `INSERT INTO diagnostics_log_objects(
         id, user_id, device_id, session_id, sequence, r2_key,
         byte_size, line_count, received_at, client_version, os_version
       ) VALUES(?, ?, NULL, 'aged', 0, ?, 10, 1, ?, '0.0.63', 'macOS 26.3')`,
    ).bind(
      segment.id,
      account.user.id,
      row.r2_key,
      Math.floor(Date.now() / 1000) - 15 * 86_400,
    ).run();

    const after = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, after);
    await waitOnExecutionContext(after);
    expect(await (env as unknown as Env).DIAGNOSTICS_LOGS.get(row.r2_key)).toBeNull();
    expect(await env.DB.prepare(
      'SELECT id FROM diagnostics_log_objects WHERE id = ?',
    ).bind(segment.id).first()).toBeNull();
  });

  it('deletes diagnostics reports once they pass retention', async () => {
    const account = await createAccount('diagnostics-retention');
    const upload = await api('diagnostics/reports', json(diagnosticsPayload(), account.accessToken));
    const { referenceCode } = await upload.json() as any;

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);
    // Still inside retention.
    expect((await admin(`diagnostics/reports/${referenceCode}`, undefined, 'GET')).status).toBe(200);

    await env.DB.prepare(
      'DELETE FROM diagnostics_reports WHERE reference_code = ?',
    ).bind(referenceCode).run();
    await env.DB.prepare(
      `INSERT INTO diagnostics_reports(
         id, reference_code, user_id, received_at, client_version, os_version, report_json
       ) VALUES(?, ?, ?, ?, '2.5.4', 'Windows 11', '{}')`,
    ).bind(
      crypto.randomUUID(),
      referenceCode,
      account.user.id,
      Math.floor(Date.now() / 1000) - 31 * 86_400,
    ).run();

    const later = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, later);
    await waitOnExecutionContext(later);
    expect((await admin(`diagnostics/reports/${referenceCode}`, undefined, 'GET')).status).toBe(404);
  });

  it('scheduled cleanup purges expired and revoked sessions older than 24 hours while keeping active sessions', async () => {
    const account = await createAccount('session-cleanup');
    const now = Math.floor(Date.now() / 1000);

    // Insert an expired session, an old revoked session, and a fresh revoked session
    await env.DB.prepare(
      `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, revoked_at, created_at)
       VALUES('sess-expired', ?, 'hash1', ?, NULL, ?),
             ('sess-revoked-old', ?, 'hash2', ?, ?, ?),
             ('sess-revoked-fresh', ?, 'hash3', ?, ?, ?)`,
    ).bind(
      account.user.id, now - 100, now - 500,
      account.user.id, now + 1000, now - 90_000, now - 100_000,
      account.user.id, now + 1000, now - 3600, now - 5000,
    ).run();

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);

    // Expired session and old revoked session should be purged
    const expired = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind('sess-expired').first();
    const revokedOld = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind('sess-revoked-old').first();
    const revokedFresh = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind('sess-revoked-fresh').first();

    expect(expired).toBeNull();
    expect(revokedOld).toBeNull();
    expect(revokedFresh).not.toBeNull();
  });

  const telemetryWindowPayload = (overrides: Record<string, unknown> = {}) => {
    const nowMs = Date.now();
    const base = {
      schemaVersion: 1,
      kind: 'periodic_window',
      windowStartMs: nowMs - 20 * 60 * 1000,
      windowEndMs: nowMs,
      appVersion: '0.0.19',
      osVersion: 'Windows 11 Pro 23H2',
      osArch: 'x86_64',
      uiState: 'connected',
      accountState: 'ready',
      selectedServer: 'Salt Lake City · Summit',
      catalogRevision: 7,
      killSwitchMode: 'locked',
      killSwitchWanted: true,
      killSwitchLive: true,
      dnsEnabled: true,
      eventCount: 2,
      eventsDropped: 0,
      events: [
        { ts: nowMs - 60_000, kind: 'networkChange', counter: 1 },
        { ts: nowMs - 30_000, kind: 'connectOk', node: 'Salt Lake City · Summit', elapsedMs: 2100 },
      ],
    };
    return { window: { ...base, ...overrides } };
  };

  it('accepts periodic telemetry windows and lists them for admin forensics', async () => {
    const account = await createAccount('telemetry-window');
    const response = await api('telemetry/windows', json(telemetryWindowPayload(), account.accessToken));
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(typeof body.id).toBe('string');
    expect(typeof body.receivedAt).toBe('number');

    const stored = await env.DB.prepare(
      'SELECT * FROM telemetry_windows WHERE id = ?',
    ).bind(body.id).first<any>();
    expect(stored.user_id).toBe(account.user.id);
    expect(JSON.parse(stored.payload_json).events).toHaveLength(2);

    expect((await api('telemetry/windows', json(telemetryWindowPayload()))).status).toBe(401);

    const withEmail = await api('telemetry/windows', json(telemetryWindowPayload({
      eventCount: 1,
      events: [{ ts: Date.now(), kind: 'signInOk', email: 'user@example.com' }],
    }), account.accessToken));
    expect(withEmail.status).toBe(400);

    const listed = await admin(`telemetry/windows?userId=${account.user.id}`, undefined, 'GET');
    expect(listed.status).toBe(200);
    const listBody = await listed.json() as any;
    expect(listBody.windows.length).toBeGreaterThanOrEqual(1);
    expect(listBody.windows[0].userId).toBe(account.user.id);
  });

  it('reports per-user online activity with device attribution to Access admins', async () => {
    const account = await createAccount('activity');
    const posted = await api('telemetry/windows', json(telemetryWindowPayload(), account.accessToken));
    expect(posted.status).toBe(201);
    const stored = await env.DB.prepare(
      'SELECT device_id FROM telemetry_windows ORDER BY received_at DESC LIMIT 1',
    ).first<any>();
    expect(stored.device_id).toBe(account.device.id);

    const unauthorized = await api('ops/activity', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unauthorized.status).toBe(401);

    const response = await operations('activity');
    expect(response.status).toBe(200);
    const { activity } = await response.json() as any;
    expect(activity.onlineUsers).toBeGreaterThanOrEqual(1);
    expect(activity.onlineDevices).toBeGreaterThanOrEqual(1);
    const me = activity.users.find((u: any) => u.userId === account.user.id);
    expect(me).toBeDefined();
    expect(me.online).toBe(true);
    expect(me.deviceId).toBe(account.device.id);
    expect(me.selectedServer).toBe('Salt Lake City · Summit');
    expect(me.uiState).toBe('connected');
    expect(me.catalogRevision).toBe(7);
    expect(me.payloadJson).toBeUndefined();
    expect(me.exitDelayMs).toBeNull();
    expect(me.tcpDelayMs).toBeNull();
    expect(me.nodeHealth).toBe('unknown');
  });

  it('caps future client path clocks at receipt time without rewriting forensic JSON', async () => {
    const account = await createAccount('activity-future-clock');
    const futureAtMs = Date.now() + 365 * 86_400_000;
    const posted = await api('telemetry/windows', json(telemetryWindowPayload({
      exitDelayMs: 900,
      tcpDelayMs: 500,
      exitDelayAtMs: futureAtMs,
      tcpDelayAtMs: futureAtMs,
    }), account.accessToken));
    expect(posted.status).toBe(201);
    const created = await posted.json() as any;

    const stored = await env.DB.prepare(
      'SELECT payload_json FROM telemetry_windows WHERE id = ?',
    ).bind(created.id).first<any>();
    expect(JSON.parse(stored.payload_json).exitDelayAtMs).toBe(futureAtMs);

    const activityResponse = await operations('activity');
    const { activity } = await activityResponse.json() as any;
    const me = activity.users.find((user: any) => user.userId === account.user.id);
    expect(me.exitDelayAtMs).toBe(me.lastSeenAt * 1_000);
    expect(me.tcpDelayAtMs).toBe(me.lastSeenAt * 1_000);

    const detailResponse = await operations(`users/${account.user.id}/detail`);
    const detail = await detailResponse.json() as any;
    expect(detail.heartbeat.exitDelayAtMs).toBe(detail.heartbeat.lastSeenAt * 1_000);
    expect(detail.heartbeat.tcpDelayAtMs).toBe(detail.heartbeat.lastSeenAt * 1_000);
  });

  it('returns one deterministic latest heartbeat per device without inflating user occupancy', async () => {
    const account = await createAccount('activity-multi-device');
    const secondLogin = await emailSignIn({
      email: account.email,
      deviceName: 'Second Mac',
      installationId: 'activity-multi-device-installation-two',
    });
    expect(secondLogin.status).toBe(200);
    const second = await secondLogin.json() as any;
    const receivedAt = Math.floor(Date.now() / 1_000);
    const windowStartMs = (receivedAt - 1_200) * 1_000;
    const windowEndMs = receivedAt * 1_000;
    const heartbeat = (
      rowId: string,
      deviceId: string,
      at: number,
      selectedServer: string,
    ) => env.DB.prepare(
      `INSERT INTO telemetry_windows(
         id, user_id, device_id, received_at, window_start_ms, window_end_ms,
         client_version, os_version, payload_json
       ) VALUES(?, ?, ?, ?, ?, ?, '0.0.90', 'macOS 26', ?)`,
    ).bind(
      rowId,
      account.user.id,
      deviceId,
      at,
      windowStartMs,
      windowEndMs,
      JSON.stringify(telemetryWindowPayload({ selectedServer }).window),
    );

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
         VALUES('profile-shared-node', 'Shared Node', 'active', ?, ?)`,
      ).bind(receivedAt, receivedAt),
      heartbeat('activity-primary-old', account.device.id, receivedAt - 10, 'Old Node'),
      // Same second, same device: highest id must win rather than returning both
      // rows or whichever SQLite happened to encounter first.
      heartbeat('activity-primary-a', account.device.id, receivedAt, 'Wrong Node'),
      heartbeat('activity-primary-z', account.device.id, receivedAt, 'Shared Node'),
      heartbeat('activity-secondary', second.device.id, receivedAt, 'Shared Node'),
    ]);

    const response = await operations('activity');
    expect(response.status).toBe(200);
    const { activity } = await response.json() as any;
    const mine = activity.users.filter((row: any) => row.userId === account.user.id);
    expect(mine).toHaveLength(2);
    expect(activity.onlineUsers).toBe(1);
    expect(activity.onlineDevices).toBe(2);
    expect(mine.find((row: any) => row.deviceId === account.device.id)?.selectedServer)
      .toBe('Shared Node');
    expect(mine.find((row: any) => row.deviceId === second.device.id)?.selectedServer)
      .toBe('Shared Node');

    const fleet = await operations('fleet-nodes');
    const shared = ((await fleet.json() as any).nodes as any[])
      .find((node) => node.name === 'Shared Node');
    expect(shared.occupancy).toBe(1);
    expect(shared.affectedUsers).toHaveLength(1);
    expect(shared.affectedUsers[0].userId).toBe(account.user.id);
  });

  it('accepts split path delays on a telemetry window and joins node health for every customer', async () => {
    const account = await createAccount('path-status');
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const ingested = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer collector-test-token-with-at-least-32-chars',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        report: {
          updated_at: 1_786_270_932,
          nodes: [
            {
              name: 'Tokyo · Fuji',
              host: '203.0.113.40',
              ok: true,
              block: { status: 'OK', label: '正常', overseas: { ok: true, success: 5, total: 5 } },
            },
            {
              name: 'Tokyo · Sakura',
              host: '203.0.113.41',
              ok: false,
              block: { status: 'LIKELY_BLOCKED', label: '疑似被墙', overseas: { ok: false, success: 0, total: 5 } },
            },
          ],
        },
      }),
    });
    expect(ingested.status).toBe(200);

    const posted = await api('telemetry/windows', json(telemetryWindowPayload({
      selectedServer: 'Tokyo · Fuji',
      exitDelayMs: 816,
      tcpDelayMs: 42,
      exitDelayAtMs: Date.now() - 5_000,
      tcpDelayAtMs: Date.now() - 60_000,
    }), account.accessToken));
    expect(posted.status).toBe(201);

    const unknownKey = await api('telemetry/windows', json(telemetryWindowPayload({
      pingMs: 12,
    }), account.accessToken));
    expect(unknownKey.status).toBe(400);

    const response = await operations('activity');
    const { activity } = await response.json() as any;
    const me = activity.users.find((u: any) => u.userId === account.user.id);
    expect(me.selectedServer).toBe('Tokyo · Fuji');
    expect(me.exitDelayMs).toBe(816);
    expect(me.tcpDelayMs).toBe(42);
    expect(me.nodeHealth).toBe('ok');
    expect(me.nodeHealthLabel).toBe('大陆正常');

    const other = await createAccount('path-status-down');
    const sakura = await api('telemetry/windows', json(telemetryWindowPayload({
      selectedServer: 'Tokyo · Sakura',
      exitDelayMs: 775,
    }), other.accessToken));
    expect(sakura.status).toBe(201);
    const after = await operations('activity');
    const { activity: next } = await after.json() as any;
    const onSakura = next.users.find((u: any) => u.userId === other.user.id);
    expect(onSakura.nodeHealth).toBe('down');
    expect(onSakura.nodeHealthLabel).toBe('整机失联');
    expect(onSakura.exitDelayMs).toBe(775);
    expect(onSakura.tcpDelayMs).toBeNull();
  });

  it('retires a catalog node as text and keeps remaining UUID placeholders', () => {
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      '      - Tokyo · Sakura',
      '      - Tokyo · Fuji',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const plan = retirementCatalogPlan(yaml, 'Tokyo · Sakura');
    expect(plan.safe).toBe(true);
    expect(plan.changes.catalogEntryRemoved).toBe(true);
    expect(plan.changes.proxyGroupReferencesRemoved).toEqual(['Tono-Exit']);
    expect(plan.yaml).toContain('Tokyo · Fuji');
    expect(plan.yaml).not.toContain('Tokyo · Sakura');
    expect(plan.yaml).toContain('{{TONO_CLIENT_UUID}}');
    expect(plan.yaml.match(/\{\{TONO_CLIENT_UUID\}\}/g)).toHaveLength(1);
    expect(plan.yaml).not.toContain('\n  uuid:\n');
  });

  it('refuses to dump a catalog whose retirement would empty Tono-Exit', () => {
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    proxies:',
      '      - Tokyo · Sakura',
    ].join('\n') + '\n';
    const plan = retirementCatalogPlan(yaml, 'Tokyo · Sakura');
    expect(plan.safe).toBe(false);
    expect(plan.yaml).toContain('Tokyo · Sakura');
    expect(plan.warnings.some((warning) => warning.includes('清空代理组'))).toBe(true);
  });

  it('previews and retires a fleet node over HTTP, leaving an audit row', async () => {
    const accessHeaders = async () => ({
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    });
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    server: 203.0.113.60',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    server: 203.0.113.61',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      '      - Tokyo · Sakura',
      '      - Tokyo · Fuji',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const putCatalog = await api('ops/exit-catalog', {
      method: 'PUT',
      headers: await accessHeaders(),
      body: JSON.stringify({ yaml, expectedRevision: 0 }),
    });
    expect(putCatalog.status).toBe(200);
    expect((await putCatalog.json() as any).revision).toBe(1);

    const sakura = encodeURIComponent('Tokyo · Sakura');
    expect((await operations('fleet-nodes/NoSuchNode/retire-preview')).status).toBe(404);

    const previewResponse = await operations(`fleet-nodes/${sakura}/retire-preview`);
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as any;
    expect(preview.node.name).toBe('Tokyo · Sakura');
    expect(preview.node.catalogListed).toBe(true);
    expect(preview.expectedRevision).toBe(1);
    expect(preview.canRetire).toBe(true);
    expect(preview.warnings).toEqual([]);
    expect(preview.affectedUsers).toEqual([]);
    expect(preview.changes).toEqual({
      catalogEntryRemoved: true,
      proxyGroupReferencesRemoved: ['Tono-Exit'],
      profileMarkedRetired: true,
    });
    // The rewritten catalog is server state, never a preview payload.
    expect(preview.nextYaml).toBeUndefined();

    const retire = (value: unknown, headers?: Record<string, string>) =>
      accessHeaders().then((base) => api(`ops/fleet-nodes/${sakura}/retire`, {
        method: 'POST',
        headers: { ...base, ...headers },
        body: JSON.stringify(value),
      }));

    const formShaped = await retire(
      { expectedRevision: 1, confirmation: 'Tokyo · Sakura', reason: '机房到期' },
      { 'content-type': 'text/plain' },
    );
    expect(formShaped.status).toBe(415);

    const unconfirmed = await retire({ expectedRevision: 1, confirmation: 'Tokyo', reason: '机房到期' });
    expect(unconfirmed.status).toBe(400);
    expect((await unconfirmed.json() as any).error.code).toBe('RETIRE_CONFIRMATION_REQUIRED');

    const stale = await retire({ expectedRevision: 0, confirmation: 'Tokyo · Sakura', reason: '机房到期' });
    expect(stale.status).toBe(409);
    expect((await stale.json() as any).error.code).toBe('CATALOG_CONFLICT');
    expect(await env.DB.prepare(
      "SELECT id FROM ops_audit WHERE action = 'node.retire'",
    ).first()).toBeNull();

    const retired = await retire({ expectedRevision: 1, confirmation: 'Tokyo · Sakura', reason: '机房到期' });
    expect(retired.status).toBe(200);
    const outcome = await retired.json() as any;
    expect(outcome.previousRevision).toBe(1);
    expect(outcome.revision).toBe(2);
    expect(outcome.node.catalogListed).toBe(false);
    expect(outcome.node.profile.status).toBe('retired');

    const audit = await env.DB.prepare(
      "SELECT * FROM ops_audit WHERE action = 'node.retire'",
    ).all<any>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0].actor_email).toBe(ACCESS_ADMIN_EMAIL);
    expect(audit.results[0].target_type).toBe('fleet_node');
    expect(audit.results[0].target_id).toBe('Tokyo · Sakura');
    expect(String(audit.results[0].summary)).toContain('机房到期');

    const served = await api('ops/exit-catalog', {
      method: 'GET',
      headers: await accessHeaders(),
    });
    const servedBody = await served.json() as any;
    expect(servedBody.revision).toBe(2);
    expect(servedBody.yaml).not.toContain('Tokyo · Sakura');
    expect(servedBody.yaml).toContain('Tokyo · Fuji');

    // The node is out of the catalog but not out of sight: its retired profile
    // keeps it on the fleet list, and a second retirement has nothing to do.
    const again = await retire({ expectedRevision: 2, confirmation: 'Tokyo · Sakura', reason: '再来一次' });
    expect(again.status).toBe(422);
    expect((await again.json() as any).error.code).toBe('RETIRE_UNSAFE');
  });

  it('counts a customer offline for days among those a retirement would affect', async () => {
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    server: 203.0.113.60',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    server: 203.0.113.61',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      '      - Tokyo · Sakura',
      '      - Tokyo · Fuji',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const putCatalog = await api('ops/exit-catalog', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
      },
      body: JSON.stringify({ yaml, expectedRevision: 0 }),
    });
    expect(putCatalog.status).toBe(200);

    const away = await createAccount('retire-away');
    const moved = await createAccount('retire-moved');
    const heartbeat = (
      rowId: string,
      account: { user: { id: string }; device: { id: string } },
      at: number,
      selectedServer: string,
    ) => env.DB.prepare(
      `INSERT INTO telemetry_windows(
         id, user_id, device_id, received_at, window_start_ms, window_end_ms,
         client_version, os_version, payload_json
       ) VALUES(?, ?, ?, ?, ?, ?, '0.0.90', 'macOS 26', ?)`,
    ).bind(
      rowId,
      account.user.id,
      account.device.id,
      at,
      (at - 1_200) * 1_000,
      at * 1_000,
      JSON.stringify(telemetryWindowPayload({ selectedServer }).window),
    );

    const nowSec = Math.floor(Date.now() / 1_000);
    await env.DB.batch([
      // Telemetry is retained for thirty days; the activity view ranks one.
      heartbeat('retire-away-window', away, nowSec - 5 * 86_400, 'Tokyo · Sakura'),
      // This customer had it selected once and has since moved off it.
      heartbeat('retire-moved-old', moved, nowSec - 6 * 86_400, 'Tokyo · Sakura'),
      heartbeat('retire-moved-new', moved, nowSec - 4 * 86_400, 'Tokyo · Fuji'),
    ]);

    const sakura = encodeURIComponent('Tokyo · Sakura');
    const preview = await (await operations(`fleet-nodes/${sakura}/retire-preview`)).json() as any;
    // Being asleep is not being unaffected: this exit is still their selection
    // and they are still the ones who lose it.
    expect(preview.affectedUsers).toHaveLength(1);
    expect(preview.affectedUsers[0]).toMatchObject({
      userId: away.user.id,
      selectedServer: 'Tokyo · Sakura',
      online: false,
    });

    const incidents = await (await operations(`incidents/node/${sakura}`)).json() as any;
    expect(incidents.affected.map((row: any) => row.userId)).toEqual([away.user.id]);

    // The activity endpoint is a liveness view and stays inside its day.
    const { activity } = await (await operations('activity')).json() as any;
    expect(activity.users.map((row: any) => row.userId)).toEqual([]);
  });

  it('keeps collector text bodies out of the fleet list but reachable per node', async () => {
    expect((await api('ops/fleet-nodes', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    try {
      const ingested = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer collector-test-token-with-at-least-32-chars',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          report: {
            nodes: [{
              name: 'Fleet Text Node',
              ok: true,
              block: { status: 'OK', label: '正常' },
              security_check: 'fleet security body',
              backtrace: 'fleet backtrace body',
            }],
          },
          agents: {
            data: [{ name: 'Fleet Text Node', cpu: 12, observed_at: Math.floor(Date.now() / 1000) }],
          },
        }),
      });
      expect(ingested.status).toBe(200);

      const response = await operations('fleet-nodes');
      expect(response.status).toBe(200);
      const fleet = await response.json() as any;
      expect(fleet.sources).toMatchObject({
        catalog: { state: 'ready' },
        quality: { state: 'ready' },
        agents: { state: 'ready' },
      });
      const node = fleet.nodes.find((row: any) => row.name === 'Fleet Text Node');
      expect(node).toMatchObject({
        catalogListed: false,
        qualityStatus: 'OK',
        qualityLabel: '正常',
        agentStatus: 'online',
      });
      expect(node.quality.securityCheck).toBeUndefined();
      expect(node.quality.backtrace).toBeUndefined();

      const text = await operations(`fleet-nodes/${encodeURIComponent('Fleet Text Node')}/quality-text`);
      expect(text.status).toBe(200);
      expect(await text.json()).toEqual({
        securityCheck: 'fleet security body',
        backtrace: 'fleet backtrace body',
      });
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('serves only the metrics fields a caller asks for and rejects unknown ones', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    try {
      const ingested = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer collector-test-token-with-at-least-32-chars',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agents: {
            data: [{
              name: 'Field Node',
              cpu: 33,
              mem_used: 512,
              mem_total: 1024,
              load_1: 0.5,
              observed_at: Math.floor(Date.now() / 1000) - 60,
            }],
          },
        }),
      });
      expect(ingested.status).toBe(200);

      const thin = await operations('metrics?range=24h&node=Field%20Node&fields=cpu,memUsed');
      expect(thin.status).toBe(200);
      const { metrics } = await thin.json() as any;
      const points = metrics.series['Field Node'] as any[];
      expect(points.length).toBeGreaterThanOrEqual(1);
      for (const point of points) {
        expect(Object.keys(point).sort()).toEqual(['cpu', 'memUsed', 't']);
      }
      expect(points[0].cpu).toBe(33);
      expect(points[0].memUsed).toBe(512);

      for (const bad of ['fields=cpu,bogus', 'fields=', 'fields=%20']) {
        const rejected = await operations(`metrics?range=24h&${bad}`);
        expect(rejected.status).toBe(400);
        expect((await rejected.json() as any).error.message).toBe('Unsupported metrics field');
      }
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('serves hourly usage deltas on the ops route and rejects unknown ranges', async () => {
    expect((await api('ops/usage-hours', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);

    const rejected = await operations('usage-hours?range=90days');
    expect(rejected.status).toBe(400);
    expect((await rejected.json() as any).error.message).toBe('Unsupported usage-hours range');

    await env.DB.prepare('DELETE FROM operations_user_usage_hours').run();
    const hour = Math.floor(Date.now() / 1000 / 3600) * 3600;
    for (const [at, bytes] of [[hour - 7200, 1000], [hour - 3600, 1600]] as const) {
      await env.DB.prepare(
        'INSERT INTO operations_user_usage_hours(user_id, hour_at, usage_bytes) VALUES(?, ?, ?)',
      ).bind('usage-hours-route-user', at, bytes).run();
    }

    const response = await operations('usage-hours');
    expect(response.status).toBe(200);
    const { usageHours } = await response.json() as any;
    expect(usageHours.resolutionSeconds).toBe(3600);
    expect(usageHours.to - usageHours.from).toBe(24 * 3600);
    expect(usageHours.users).toEqual([{
      userId: 'usage-hours-route-user',
      points: [
        // The first hour has no predecessor: unmeasured, never zero.
        { t: hour - 7200, bytes: null },
        { t: hour - 3600, bytes: 600 },
      ],
    }]);
    expect(usageHours.fleet).toEqual([
      { t: hour - 7200, bytes: null },
      { t: hour - 3600, bytes: 600 },
    ]);

    const week = await operations('usage-hours?range=7d');
    expect(week.status).toBe(200);
    const weekBody = await week.json() as any;
    expect(weekBody.usageHours.to - weekBody.usageHours.from).toBe(7 * 24 * 3600);
  });

  it('pages and filters the ops audit log', async () => {
    expect((await api('ops/audit', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);

    const seed = (rowId: string, at: number, actor: string, action: string, targetId: string) =>
      env.DB.prepare(
        `INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary)
         VALUES(?, ?, ?, ?, 'user', ?, ?)`,
      ).bind(rowId, at, actor, action, targetId, `${action} ${targetId}`).run();
    await seed('aud-1', 1000, 'a@example.com', 'user.onboard', 'usr_a');
    await seed('aud-2', 2000, 'b@example.com', 'user.update', 'usr_b');
    await seed('aud-3', 3000, 'a@example.com', 'user.update', 'usr_a');
    await seed('aud-4', 4000, 'a@example.com', 'user.close', 'usr_a');

    const plain = await operations('audit');
    expect(plain.status).toBe(200);
    const plainBody = await plain.json() as any;
    expect(plainBody.entries.map((entry: any) => entry.id)).toEqual(['aud-4', 'aud-3', 'aud-2', 'aud-1']);
    expect(plainBody.entries[0]).toMatchObject({
      at: 4000,
      actorEmail: 'a@example.com',
      action: 'user.close',
      targetType: 'user',
      targetId: 'usr_a',
    });
    expect(plainBody.hasMore).toBe(false);
    expect(plainBody.nextBefore).toBeNull();

    const firstPage = await operations('audit?limit=2');
    const firstBody = await firstPage.json() as any;
    expect(firstBody.entries.map((entry: any) => entry.id)).toEqual(['aud-4', 'aud-3']);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextBefore).toBe(3000);

    const secondPage = await operations(`audit?limit=2&before=${firstBody.nextBefore}`);
    const secondBody = await secondPage.json() as any;
    expect(secondBody.entries.map((entry: any) => entry.id)).toEqual(['aud-2', 'aud-1']);
    expect(secondBody.hasMore).toBe(false);

    const byTarget = await operations('audit?targetId=usr_b');
    expect(((await byTarget.json() as any).entries as any[]).map((entry) => entry.id)).toEqual(['aud-2']);

    const byActor = await operations(`audit?actorEmail=${encodeURIComponent('a@example.com')}`);
    expect(((await byActor.json() as any).entries as any[]).map((entry) => entry.id))
      .toEqual(['aud-4', 'aud-3', 'aud-1']);

    for (const bad of ['limit=0', 'limit=501', 'limit=ten', 'before=0', 'before=soon']) {
      expect((await operations(`audit?${bad}`)).status).toBe(400);
    }
  });

  it('pages the audit log past rows written in the same second', async () => {
    // A PATCH that both resets usage and changes a field writes two rows one
    // after the other, and the log's clock has no room between them.
    const seed = (rowId: string, at: number) =>
      env.DB.prepare(
        `INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary)
         VALUES(?, ?, 'a@example.com', 'user.update', 'user', 'usr_tie', ?)`,
      ).bind(rowId, at, `update ${rowId}`).run();
    await seed('aud-tie-a', 5000);
    await seed('aud-tie-b', 5000);
    await seed('aud-tie-older', 4000);

    const walk = async () => {
      const ids: string[] = [];
      let cursor = '';
      for (let page = 0; page < 10; page += 1) {
        const body = await (await operations(`audit?limit=1${cursor}`)).json() as any;
        ids.push(...body.entries.map((entry: any) => entry.id));
        if (!body.hasMore) return ids;
        cursor = `&before=${body.nextBefore}&beforeId=${encodeURIComponent(body.nextBeforeId)}`;
      }
      throw new Error('audit paging did not terminate');
    };

    // One row per page, so the boundary falls inside the pair. Neither of them
    // may be skipped, and the newest-first order stays deterministic.
    expect(await walk()).toEqual(['aud-tie-b', 'aud-tie-a', 'aud-tie-older']);

    // The timestamp alone is still a valid cursor for a hand-written request.
    const older = await (await operations('audit?before=5000')).json() as any;
    expect(older.entries.map((entry: any) => entry.id)).toEqual(['aud-tie-older']);
    expect((await operations('audit?beforeId=aud-tie-a')).status).toBe(400);
  });

  it('lists the customers currently on a node for incident triage', async () => {
    expect((await api('ops/incidents/node/Some%20Node', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);

    const account = await createAccount('incident-node');
    const posted = await api('telemetry/windows', json(telemetryWindowPayload({
      selectedServer: 'Incident · Node',
    }), account.accessToken));
    expect(posted.status).toBe(201);

    const response = await operations(`incidents/node/${encodeURIComponent('Incident · Node')}`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.node).toBe('Incident · Node');
    expect(body.onlineWindowSeconds).toBe(40 * 60);
    expect(body.affected).toHaveLength(1);
    expect(body.affected[0]).toMatchObject({
      userId: account.user.id,
      deviceId: account.device.id,
      online: true,
      selectedServer: 'Incident · Node',
    });

    const quiet = await operations('incidents/node/Quiet%20Node');
    expect(((await quiet.json() as any).affected)).toEqual([]);

    expect((await operations(`incidents/node/${encodeURIComponent('x'.repeat(201))}`)).status).toBe(400);
  });

  describe('True LRU device eviction and last_seen_at updates', () => {
    it('updates last_seen_at upon active device re-login, auth refresh, and telemetry', async () => {
      const account = await createAccount('lru-test');
      resetMockInventory(account.device.id, account.enrollment.hostname);
      const conf = await confirm(account);
      expect(conf.status).toBe(200);
      const devId = account.device.id;

      // 1. Initial confirmed_at and last_seen_at are populated
      const initialDev = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?').bind(devId).first<any>();
      expect(Number(initialDev.last_seen_at)).toBeGreaterThan(0);

      // Backdate last_seen_at to simulate time passing
      const backdatedTime = Number(initialDev.last_seen_at) - 1000;
      await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(backdatedTime, devId).run();

      // 2. Active device re-login updates last_seen_at
      const reLogin = await emailSignIn({
        email: account.email,
        deviceName: 'Primary Mac',
        installationId: 'lru-test-installation-one',
      });
      expect(reLogin.status).toBe(200);
      const afterReLogin = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?').bind(devId).first<any>();
      expect(Number(afterReLogin.last_seen_at)).toBeGreaterThan(backdatedTime);

      // Backdate again
      await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(backdatedTime, devId).run();

      // 3. Telemetry update
      const telRes = await api('telemetry/windows', json(telemetryWindowPayload({
        selectedServer: 'Test Node',
      }), account.accessToken));
      expect(telRes.status).toBe(201);
      const afterTel = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?').bind(devId).first<any>();
      expect(Number(afterTel.last_seen_at)).toBeGreaterThan(backdatedTime);

      // Backdate again
      await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(backdatedTime, devId).run();

      // 4. Auth refresh update
      const refreshRes = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
      expect(refreshRes.status).toBe(200);
      const afterRefresh = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?').bind(devId).first<any>();
      expect(Number(afterRefresh.last_seen_at)).toBeGreaterThan(backdatedTime);
    });

    it('evicts the least recently seen device rather than oldest created device', async () => {
      const account = await createAccount('lru-evict-order');
      const devA = account.device.id;

      const login = (name: string, installationId: string) => emailSignIn({
        email: account.email,
        deviceName: name,
        installationId,
      });

      // Login on device 2
      const res2 = await login('Device 2', 'installation-order-two');
      expect(res2.status).toBe(200);
      const acc2 = await res2.json() as any;
      const devB = acc2.device.id;

      // Ensure user has deviceLimit = 2
      await env.DB.prepare('UPDATE users SET device_limit = 2 WHERE id = ?').bind(account.user.id).run();

      // Device A was created earlier than Device B.
      // But Device A was used very recently, while Device B is stale.
      const nowSec = Math.floor(Date.now() / 1000);
      await env.DB.prepare("UPDATE devices SET status = 'active', last_seen_at = ? WHERE id = ?").bind(nowSec + 100, devA).run();
      await env.DB.prepare("UPDATE devices SET status = 'active', last_seen_at = ? WHERE id = ?").bind(nowSec - 1000, devB).run();

      // Login on device 3 (exceeds limit 2)
      const res3 = await login('Device 3', 'installation-order-three');
      expect(res3.status).toBe(200);

      // Check statuses: Device B (least recently active) must be revoked, Device A remains active!
      const statusA = await env.DB.prepare('SELECT status FROM devices WHERE id = ?').bind(devA).first<any>();
      const statusB = await env.DB.prepare('SELECT status FROM devices WHERE id = ?').bind(devB).first<any>();

      expect(statusA.status).toBe('active');
      expect(statusB.status).toBe('revoked');
    });
  });

  describe('Device-scoped exit credentials and instant revocation on exit roster', () => {
    it('mints distinct exit credentials per device and drops revoked device immediately from exit roster', async () => {
      const getCat = await admin('exit-catalog', undefined, 'GET');
      const curRev = getCat.status === 200 ? Number(((await getCat.json()) as any).revision) : 0;
      const yaml = `proxies:
  - name: Tono-Exit
    type: vless
    server: exit.example.com
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
      await admin('exit-catalog', { yaml, expectedRevision: curRev }, 'PUT');
      const email = `dual-${Date.now()}@example.com`;

      const res1 = await emailSignIn({
        email,
        deviceName: 'Phone',
        installationId: `inst-phone-${Date.now()}`,
      });
      expect(res1.status).toBe(200);
      const dev1 = await res1.json() as any;

      const res2 = await emailSignIn({
        email,
        deviceName: 'Laptop',
        installationId: `inst-laptop-${Date.now()}`,
      });
      expect(res2.status).toBe(200);
      const dev2 = await res2.json() as any;

      // Both devices fetch their exit catalog
      const cat1Res = await api('exit-catalog', {
        headers: { authorization: `Bearer ${dev1.accessToken}` },
      });
      expect(cat1Res.status).toBe(200);

      const cat2Res = await api('exit-catalog', {
        headers: { authorization: `Bearer ${dev2.accessToken}` },
      });
      expect(cat2Res.status).toBe(200);

      // Extract client UUID from device_exit_credentials
      const cred1 = await env.DB.prepare('SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?').bind(dev1.device.id).first<any>();
      const cred2 = await env.DB.prepare('SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?').bind(dev2.device.id).first<any>();

      expect(cred1).toBeTruthy();
      expect(cred2).toBeTruthy();
      expect(cred1.client_uuid).not.toBe(cred2.client_uuid);

      // The exit roster must contain BOTH device credentials
      const rosterBefore = await (await api('home/exit-identities', {
        headers: { authorization: `Bearer ${HOME_TOKEN}` },
      })).json() as any;

      const beforeUUIDs = rosterBefore.identities.map((e: any) => e.clientUUID);
      expect(beforeUUIDs).toContain(cred1.client_uuid);
      expect(beforeUUIDs).toContain(cred2.client_uuid);

      // Now revoke Device 1 (e.g. user deletes Phone from Laptop)
      const delRes = await api(`devices/${dev1.device.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${dev2.accessToken}` },
      });
      expect(delRes.status).toBe(204);

      // Device 1's credential must be deleted from device_exit_credentials
      const cred1After = await env.DB.prepare('SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?').bind(dev1.device.id).first<any>();
      expect(cred1After).toBeNull();

      // The exit roster must IMMEDIATELY drop Device 1, while keeping Device 2!
      const rosterAfter = await (await api('home/exit-identities', {
        headers: { authorization: `Bearer ${HOME_TOKEN}` },
      })).json() as any;

      const afterUUIDs = rosterAfter.identities.map((e: any) => e.clientUUID);
      expect(afterUUIDs).not.toContain(cred1.client_uuid);
      expect(afterUUIDs).toContain(cred2.client_uuid);
    });
  });
});
