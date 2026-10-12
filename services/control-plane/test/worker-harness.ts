// Shared setup for the worker-*.test.ts topic files, split out of the former
// worker.test.ts (A27). Each topic file calls useWorkerHarness() inside its
// outer describe so it gets the same mocks and per-test resets.
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeAll, beforeEach, expect, vi } from 'vitest';
import { sha256 } from '../src/crypto';
import worker, { type Env } from '../src/index';

export const ADMIN_TOKEN = 'admin-test-token-with-at-least-32-characters';
export const HOME_TOKEN = 'home-test-token-with-at-least-32-characters';
export const EXIT_NODE_TOKENS = {
  'exit-default': 'exit-default-token-with-at-least-32-characters',
  'exit-a': 'exit-a-token-with-at-least-32-characters-000',
  'exit-b': 'exit-b-token-with-at-least-32-characters-000',
  'exit-c': 'exit-c-token-with-at-least-32-characters-000',
  'exit-r': 'exit-r-token-with-at-least-32-characters-000',
  'exit-t': 'exit-t-token-with-at-least-32-characters-000',
} as const;
export const JWT_TEST_SECRET = 'test-jwt-secret-with-at-least-32-characters';

export const api = async (path: string, init: RequestInit = {}) => {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://test/api/v1/${path}`, init),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
};
export const json = (value: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(value),
});
export const routingResearchJson = async (
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
export const admin = (path: string, value?: unknown, method = 'POST') => api(`admin/${path}`, {
  ...(value === undefined ? {} : json(value)), method,
  headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
});

/** Deliberately distinct Tailscale identity values (production mismatch case). */
export const MGMT_ID = 'mgmt-abc';
export const API_NODE_ID = 'nodeid-xyz';
export const STABLE_ID = 'stable-n123';
export const PUBLIC_KEY = 'public-key-123';
export const TS_IPS = ['100.64.0.10'];
export const OIDC_KEY_ID = 'test-oidc-key';
export const GOOGLE_AUDIENCE = 'test-google-client.apps.googleusercontent.com';
export const APPLE_AUDIENCE = 'com.raydocs.tono';
export const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
export const ACCESS_AUDIENCE = 'test-access-audience-0001';
export const ACCESS_ADMIN_EMAIL = 'operator@example.com';

export let sequence = 0;
export const tailscaleRequests: string[] = [];
export const emailCodes = new Map<string, string>();
// `admin-worker.ts` answers these hostnames with a 302 to the console, so a
// fetch of one can only ever return HTML. Recording instead of stubbing means
// a reintroduced fallback fails a test rather than silently timing out twice
// in production.
export const ABSORBED_HOSTS = ['ops.afk.ccwu.cc', 'quality.afk.ccwu.cc'];
export const ADMIN_MONITOR_URL = 'https://admin.afk.ccwu.cc/ops/#/nodes';
export const absorbedHostFetches: string[] = [];
let oidcPrivateKey: CryptoKey;
export let oidcPublicKey: JsonWebKey & { kid: string };

export async function accessAssertion(
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

export async function operations(path: string, accessEmail = ACCESS_ADMIN_EMAIL, method = 'GET') {
  return api(`ops/${path}`, {
    method,
    headers: { 'cf-access-jwt-assertion': await accessAssertion(accessEmail) },
  });
}

/** In-memory mock inventory; tags mutate after promotion. */
export const mockInventory: Array<{
  id: string;
  nodeId: string;
  name: string;
  nodeKey: string;
  stableNodeId?: string;
  addresses: string[];
  tags: string[];
  description?: string;
}> = [];

export function resetMockInventory(
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

export function pauseNextTagPromotion() {
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

export async function createAccount(prefix: string) {
  const email = `${prefix}-${++sequence}@example.com`;
  const response = await emailSignIn({
    email,
    deviceName: 'Primary Mac',
    installationId: `${prefix}-installation-one`,
  });
  expect(response.status).toBe(200);
  return { email, ...(await response.json() as any) };
}

// A catalog is served only on identities its exits acknowledged, so tests that
// exercise other catalog behavior register their served exit names as active
// nodes with an acknowledgement an hour ahead.
export async function acknowledgeServedExits(...names: string[]) {
  const timestamp = Math.floor(Date.now() / 1000);
  for (const name of names) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO exit_nodes(id, name, token_hash, status, last_roster_at, created_at, updated_at)
       VALUES(?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(`exit-acked-${name}`, name, await sha256(`exit-acked-${name}-token`), timestamp + 3600, timestamp, timestamp).run();
  }
}

export async function startEmailSignIn(body: {
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

export async function emailSignIn(body: {
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

export function base64URL(value: Uint8Array): string {
  let raw = '';
  for (const byte of value) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function oidcToken(
  provider: 'apple' | 'google',
  nonce: string,
  options: { subject?: string; email?: string; audience?: string; hd?: string } = {},
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
    ...(options.hd ? { hd: options.hd } : {}),
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

export async function confirm(
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

/** Next value of the shared counter tests use for unique emails and ids. */
export function nextSequence() {
  return ++sequence;
}

/** Make the next mocked Tailscale call of this kind fail once. */
export function failNext(kind: 'tagPromotion' | 'keyIssue' | 'delete') {
  if (kind === 'tagPromotion') failNextTagPromotion = true;
  else if (kind === 'keyIssue') failNextKeyIssue = true;
  else failNextDelete = true;
}

// Shared by the telemetry, fleet and device-eviction topic files.
export const telemetryWindowPayload = (overrides: Record<string, unknown> = {}) => {
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

/**
 * Registers the shared fixtures every worker-*.test.ts topic file runs under:
 * OIDC/Access signing keys, the mocked outbound fetch (Resend, OIDC JWKS,
 * absorbed hosts, Tailscale), and per-test env/mock/exit-node resets. Call it
 * once at the top of the topic file's outer describe.
 */
export function useWorkerHarness() {
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
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
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
    const timestamp = Math.floor(Date.now() / 1000);
    await env.DB.batch(await Promise.all(Object.entries(EXIT_NODE_TOKENS).map(async ([nodeId, token]) => (
      env.DB.prepare(
        `INSERT INTO exit_nodes(
           id, name, token_hash, status, last_roster_at, created_at, updated_at
         ) VALUES(?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(nodeId, `Test ${nodeId}`, await sha256(token), timestamp + 3600, timestamp, timestamp)
    ))));
  });
}
