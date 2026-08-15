import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtSign } from '../src/crypto';
import worker, { type Env } from '../src/index';
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
    expect(await page.text()).toContain('Tono 发布档案');

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
      securityCheck: 'IP quality body',
      backtrace: '163 / 4837',
      block: {
        status: 'LIKELY_BLOCKED',
        asiaEdge: { success: 3, total: 3 },
      },
    });
    expect(live.quality.nodes[0].secret).toBeUndefined();
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
    const listed = (await users.json() as any).users.find((row: any) => row.id === account.user.id);
    expect(listed.homeBinding).toMatchObject({
      homeExitId: homeId,
      proxyName: 'Home Residential Ops',
      egressIpv4: '198.51.100.9',
    });
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

  it('serves strict redacted operations DTOs through GET-only queries', async () => {
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
    expect((await dashboard.json() as any).dashboard.servers).toEqual({ total: 1, active: 1 });

    const servers = await operations('servers');
    expect(servers.status).toBe(200);
    const serverPayload = await servers.json() as any;
    expect(serverPayload.servers).toEqual([{
      id: 'server-us-west',
      displayName: 'US West',
      regionCode: 'us-west',
      provider: 'provider-a',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      latestDeployment: {
        releaseVersion: '2026.08.1', status: 'active', deployedAt: timestamp,
      },
    }]);

    const nodes = await operations('nodes');
    expect((await nodes.json() as any).nodes).toEqual([{
      id: 'node-us-west-1',
      serverId: 'server-us-west',
      serverDisplayName: 'US West',
      displayName: 'US West 1',
      regionCode: 'us-west',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    }]);

    const deployments = await operations('deployments');
    const deploymentPayload = await deployments.json() as any;
    expect(Object.keys(deploymentPayload.deployments[0]).sort()).toEqual([
      'createdAt', 'deployedAt', 'environment', 'id', 'logicalNodeDisplayName', 'logicalNodeId',
      'releaseVersion', 'serverDisplayName', 'serverId', 'status',
    ]);
    const serialized = JSON.stringify({ serverPayload, deploymentPayload });
    for (const forbidden of ['uuid', 'endpoint', 'privateKey', 'ssh', 'token', 'authorization']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
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

    const literalIdentity = await admin(
      'exit-catalog',
      { yaml: yaml.replace('{{TONO_CLIENT_UUID}}', '11111111-1111-4111-8111-111111111111'), expectedRevision: 0 },
      'PUT',
    );
    expect(literalIdentity.status).toBe(400);
    expect((await literalIdentity.json() as any).error.code).toBe('INVALID_CATALOG');

    const created = await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT');
    expect(created.status).toBe(200);
    const createdBody = await created.json() as any;
    expect(createdBody.revision).toBe(1);

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
    expect((await pending.json() as any).incomplete).toContain('user_not_registered');

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
    expect((await login('lifecycle-installation-three')).status).toBe(409);
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
    expect((await login('six')).status).toBe(409);

    const stored = await env.DB.prepare(
      'SELECT device_limit FROM users WHERE id = ?',
    ).bind(account.user.id).first<any>();
    expect(stored.device_limit).toBe(5);
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
  });
});
