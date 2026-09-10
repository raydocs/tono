import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { ApiError } from '../src/errors';
import { can } from '../src/ops/contract';
import { OPS_V1_ROUTES } from '../src/ops/handlers/dispatch';
import {
  actionForRequest,
  actionForRoute,
  requireCan,
  resolveOpsRole,
} from '../src/ops/roles';

const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
const ACCESS_AUDIENCE = 'test-access-audience-0001';
const ACCESS_ADMIN_EMAIL = 'operator@example.com';
const OIDC_KEY_ID = 'test-oidc-key';
const NODE = 'Tokyo · Kite';
const NOW = 1_800_000_000;

let oidcPrivateKey: CryptoKey;
let oidcPublicKey: JsonWebKey & { kid: string };

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

async function ops(path: string, init: RequestInit = {}) {
  const context = createExecutionContext();
  const headers = new Headers(init.headers);
  if (!headers.has('cf-access-jwt-assertion')) {
    headers.set('cf-access-jwt-assertion', await accessAssertion(ACCESS_ADMIN_EMAIL));
  }
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await worker.fetch(
    new Request(`https://test/api/v1/ops/${path}`, { ...init, headers }),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const json = (value: unknown, method = 'POST'): RequestInit => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
});

const db = () => (env as unknown as { DB: D1Database }).DB;

function splitRoute(entry: string): { method: string; pattern: string } {
  const space = entry.indexOf(' ');
  return { method: entry.slice(0, space), pattern: entry.slice(space + 1) };
}

function bindRole(role: string | undefined) {
  const e = env as unknown as Env;
  if (role === undefined) {
    e.OPS_ROLES = undefined;
    return;
  }
  e.OPS_ROLES = JSON.stringify({ [ACCESS_ADMIN_EMAIL]: role });
}

async function seedIncident() {
  await db().prepare(
    `INSERT INTO ops_incidents(
       id, dedupe_key, kind, subject_type, subject_id, severity, status, title,
       rules_version, opened_at, last_seen_at, impact_count, updated_at
     ) VALUES('inc-1', 'node:x:down', 'node_down', 'node', ?, 'warn', 'open', '节点失联', 1, ?, ?, 1, ?)`,
  ).bind(NODE, NOW, NOW, NOW).run();
}

describe('ops roles', () => {
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
      return new Response(null, { status: 404 });
    });
  });

  beforeEach(() => {
    const e = env as unknown as Env;
    e.ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    e.ACCESS_AUD = ACCESS_AUDIENCE;
    e.ACCESS_ADMIN_EMAILS = ACCESS_ADMIN_EMAIL;
    (e as Env & { OPS_CONTRACT_STRICT?: string }).OPS_CONTRACT_STRICT = '1';
    e.OPS_ROLES = undefined;
  });

  afterEach(() => {
    (env as unknown as Env).OPS_ROLES = undefined;
  });

  it('every v1 route maps to an action, every GET to a read, and an unmapped action fails closed for non-owners', () => {
    for (const entry of OPS_V1_ROUTES) {
      const { method, pattern } = splitRoute(entry);
      const action = actionForRoute(method, pattern);
      expect(action, entry).not.toBeNull();
      if (method === 'GET') expect(action, entry).toMatch(/\.read$/);
      expect(actionForRequest(method, pattern.replace(/\{[^}]+\}/g, 'sample')), entry).toBe(action);
    }
    expect(can('ledger.read', 'viewer')).toBe(false);
    expect(can('customers.raw-logs', 'operator')).toBe(false);
    expect(() => requireCan(null, 'owner')).not.toThrow();
    expect(() => requireCan(null, 'viewer')).toThrow(ApiError);
  });

  it('resolveOpsRole defaults to owner and ignores bad OPS_ROLES with one warn', () => {
    const e = env as unknown as Env;
    expect(resolveOpsRole(ACCESS_ADMIN_EMAIL, e)).toBe('owner');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    e.OPS_ROLES = '{';
    expect(resolveOpsRole(ACCESS_ADMIN_EMAIL, e)).toBe('owner');
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockClear();
    e.OPS_ROLES = '[]';
    expect(resolveOpsRole(ACCESS_ADMIN_EMAIL, e)).toBe('owner');
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockClear();
    e.OPS_ROLES = JSON.stringify({ [ACCESS_ADMIN_EMAIL]: 'superadmin' });
    expect(resolveOpsRole(ACCESS_ADMIN_EMAIL, e)).toBe('owner');
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    e.OPS_ROLES = JSON.stringify({ 'Operator@example.com': 'viewer' });
    expect(resolveOpsRole(ACCESS_ADMIN_EMAIL, e)).toBe('viewer');
  });

  it('viewer is refused on writes (v1 and legacy) and on settings reads; operator may ack; unset OPS_ROLES behaves as today', async () => {
    await seedIncident();
    bindRole('viewer');
    const ack = await ops('incidents/inc-1/ack', json({}));
    expect(ack.status).toBe(403);
    expect(((await ack.json()) as { error: { code: string } }).error.code).toBe('ROLE_FORBIDDEN');
    expect((await ops('incidents/inc-1')).status).toBe(200);
    expect((await ops('users/no-such-user', json({ notes: 'x' }, 'PATCH'))).status).toBe(403);
    expect((await ops('alert-rules')).status).toBe(403);
    bindRole('operator');
    expect((await ops('incidents/inc-1/ack', json({}))).status).toBe(200);
    bindRole(undefined);
    expect((await ops('incidents/inc-1/ack', json({}))).status).toBe(200);
    expect((await ops('users/no-such-user', json({ notes: 'x' }, 'PATCH'))).status).not.toBe(403);
  });
});
