import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { OPS_V1_ROUTES } from '../src/ops/router';
import {
  CHECKER_BY_NAME,
  GET_ROUTE_TABLE,
  NAMED_CHECKERS,
  checkerForRoute,
  fixtureFileForRoute,
} from '../src/ops/contract';

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
  const response = await worker.fetch(
    new Request(`https://test/api/v1/ops/${path}`, { ...init, headers }),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const db = () => (env as unknown as { DB: D1Database }).DB;

async function seedReads() {
  const t = NOW;
  await db().prepare(
    `INSERT INTO ops_node_profiles(id, catalog_name, public_ip, provider, status, created_at, updated_at)
     VALUES('p-kite', ?, '203.0.113.9', 'Bandwagon', 'active', ?, ?)`,
  ).bind(NODE, t, t).run();
  await db().prepare(
    `INSERT INTO ops_node_status(
       node_name, verdict, label, reason, candidate_streak, catalog_listed,
       rules_version, evaluated_at, changed_at
     ) VALUES(?, 'ok', '大陆正常', '大陆正常', 0, 1, 1, ?, ?)`,
  ).bind(NODE, t, t).run();
  await db().prepare(
    `INSERT INTO ops_node_status_history(id, node_name, at, from_verdict, to_verdict, reason, rules_version)
     VALUES('h1', ?, ?, 'unknown', 'ok', '大陆正常', 1)`,
  ).bind(NODE, t).run();
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES('u-1', 'a@example.com', 'x', 'y', 'active', 0, ?, ?)`,
  ).bind(t, t).run();
  await db().prepare(
    `INSERT INTO ops_customer_status(user_id, connected, selected_server, last_seen_at, updated_at)
     VALUES('u-1', 1, ?, ?, ?)`,
  ).bind(NODE, t, t).run();
  await db().prepare(
    `INSERT INTO connection_events(
       id, at_ms, received_at, source, user_id, kind, node, tcp_delay_ms, edge_as_org, edge_via_exit
     ) VALUES('e1', ?, ?, 'window', 'u-1', 'connectOk', ?, 40, 'China Mobile', 0)`,
  ).bind(t * 1000, t, NODE).run();
  await db().prepare(
    `INSERT INTO node_error_daily(node, day_at, category, count, sample)
     VALUES(?, ?, 'dial_timeout', 2, 'timeout')`,
  ).bind(NODE, t - (t % 86400)).run();
  await db().prepare(
    `INSERT INTO ops_incidents(
       id, dedupe_key, kind, subject_type, subject_id, severity, status, title,
       rules_version, opened_at, last_seen_at, impact_count, updated_at
     ) VALUES('inc-1', 'node:kite:ok', 'node_blocked', 'node', ?, 'warn', 'open', '节点被墙', 1, ?, ?, 1, ?)`,
  ).bind(NODE, t, t, t).run();
  await db().prepare(
    `INSERT INTO ops_node_jobs(
       id, node_name, executor, type, params_json, status, attempts, max_attempts,
       idempotency_key, requested_by, created_at, not_before, expires_at, updated_at
     ) VALUES('job-1', ?, 'hub', 'collect_quality', '{}', 'queued', 0, 3,
       'idem-1', ?, ?, ?, ?, ?)`,
  ).bind(NODE, ACCESS_ADMIN_EMAIL, t, t, t + 900, t).run();
  await db().prepare(
    `INSERT INTO client_releases(id, platform, channel, version, notes, published_at, created_at, updated_at)
     VALUES('rel-1', 'macos', 'stable', '0.0.72', 'ship', ?, ?, ?)`,
  ).bind(t, t, t).run();
  await db().prepare(
    `INSERT INTO direct_candidates(etld1, first_seen, last_seen, users, bytes_30d, status)
     VALUES('bilibili.com', ?, ?, 2, 100, 'new')`,
  ).bind(t, t).run();
  await db().prepare(
    `INSERT INTO provider_accounts(id, provider, label, cloud_kind, status, created_at, updated_at)
     VALUES('pa-1', 'bandwagon', 'main', 'vps', 'active', ?, ?)`,
  ).bind(t, t).run();
  await db().prepare(
    `INSERT INTO home_exits(id, proxy_name, display_name, egress_ipv4, status, notes, created_at, updated_at)
     VALUES('home-1', 'home-1', '家宽 1', '198.51.100.8', 'active', NULL, ?, ?)`,
  ).bind(t, t).run();
  await db().prepare(
    `INSERT INTO home_line_usage_daily(home_exit_id, day_at, source, bytes_up, bytes_down, users, updated_at)
     VALUES('home-1', ?, 'client_route', 1, 2, 1, ?)`,
  ).bind(t - (t % 86400), t).run();
  await db().prepare(
    `INSERT INTO ops_alert_rules(
       id, name, enabled, min_severity, min_impact, fire_on, delay_seconds, cooldown_seconds,
       channel, target, template, created_at, updated_at
     ) VALUES('alr-1', 'down', 1, 'warn', 0, 'open', 0, 3600, 'webhook', 'https://hooks.example.com/in', 'generic', ?, ?)`,
  ).bind(t, t).run();
  await db().prepare(
    `INSERT INTO ops_alert_deliveries(
       id, rule_id, incident_id, dedupe_key, transition, status, attempts, created_at
     ) VALUES('ald-1', 'alr-1', 'inc-1', 'alr-1:inc-1:open', 'open', 'sent', 1, ?)`,
  ).bind(t).run();
  await db().prepare(
    `INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary, actor_type)
     VALUES('aud-1', ?, ?, 'node-job.create', 'node_job', 'job-1', 'queued collect_quality', 'access_admin')`,
  ).bind(t, ACCESS_ADMIN_EMAIL).run();
  await db().prepare(
    `INSERT INTO customer_activity_hours(
       user_id, device_id, hour_at, online_minutes, connected_minutes, bytes_up, bytes_down, node, platform
     ) VALUES('u-1', 'd-1', ?, 10, 8, 1, 2, ?, 'macos')`,
  ).bind(t - (t % 3600), NODE).run();
  await db().prepare(
    `INSERT INTO traffic_destination_daily(
       user_id, device_id, day_at, etld1, route, node, connections, bytes_up, bytes_down, top_process, updated_at
     ) VALUES('u-1', 'd-1', ?, 'youtube.com', 'cloud', ?, 3, 1, 2, 'Tono', ?)`,
  ).bind(t - (t % 86400), NODE, t).run();
  await db().prepare(
    `INSERT INTO service_usage_daily(user_id, day_at, family, route, bytes, sessions, last_seen_at)
     VALUES('u-1', ?, 'claude', 'cloud', 4, 1, ?)`,
  ).bind(t - (t % 86400), t).run();
  await db().prepare(
    `INSERT INTO ops_fx_rates(day, base, quote, rate, fetched_at, source)
     VALUES('2026-09-01', 'USD', 'CNY', 7.2, ?, 'frankfurter')`,
  ).bind(t).run();
}

function pathFor(route: string): string {
  const suffix = route.replace(/^GET \/api\/v1\/ops\//, '');
  return suffix
    .replaceAll('{name}', encodeURIComponent(NODE))
    .replaceAll('{month}', '2026-09')
    .replaceAll('{id}', (segment) => {
      if (route.includes('/customers/')) return 'u-1';
      if (route.includes('/incidents/')) return 'inc-1';
      if (route.includes('/provider-accounts/')) return 'pa-1';
      if (route.includes('/home-lines/')) return 'home-1';
      if (route.includes('/alert-rules/')) return 'alr-1';
      return segment;
    });
}

describe('ops GET route ↔ checker table', () => {
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
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    (env as unknown as Env).ACCESS_AUD = ACCESS_AUDIENCE;
    (env as unknown as Env).ACCESS_ADMIN_EMAILS = ACCESS_ADMIN_EMAIL;
    (env as unknown as Env & { OPS_CONTRACT_STRICT?: string }).OPS_CONTRACT_STRICT = '1';
  });

  it('maps every GET route to a checker and every checker to a route', () => {
    const getRoutes = OPS_V1_ROUTES.filter((route) => route.startsWith('GET ') && !route.endsWith('.csv'));
    expect(GET_ROUTE_TABLE.map((row) => row.route).sort()).toEqual([...getRoutes].sort());
    const used = new Set(GET_ROUTE_TABLE.map((row) => row.checker));
    expect([...used].sort()).toEqual(Object.keys(NAMED_CHECKERS).sort());
    for (const row of GET_ROUTE_TABLE) {
      expect(typeof NAMED_CHECKERS[row.checker]).toBe('function');
      expect(checkerForRoute(row.route)).toBe(NAMED_CHECKERS[row.checker]);
      expect(CHECKER_BY_NAME[row.checker]).toBe(NAMED_CHECKERS[row.checker]);
      expect(fixtureFileForRoute(row.route)).toMatch(/\.json$/);
    }
  });

  it('runs the mapped checker on every GET response', async () => {
    await seedReads();
    for (const row of GET_ROUTE_TABLE) {
      let path = pathFor(row.route);
      if (row.route.endsWith('/errors')) path += '?range=7d';
      if (row.route.endsWith('/activity')) path += '?range=24h';
      if (row.route.endsWith('/destinations') || row.route.endsWith('/services')) path += '?range=7d';
      if (row.route.endsWith('/usage')) path += '?range=30d';
      if (row.route.endsWith('/adoption')) path += '?range=30d';
      if (row.route.endsWith('/ledger')) path += '?month=2026-09';
      if (row.route.endsWith('/fx')) path += '?day=2026-09-10&base=USD';
      const response = await ops(path);
      expect(response.status, row.route).toBe(200);
      const body = await response.json() as unknown;
      expect(() => NAMED_CHECKERS[row.checker](body), row.route).not.toThrow();
    }
  });

  it('returns 304 for If-None-Match on nodes, customers, incidents', async () => {
    await seedReads();
    for (const path of ['nodes', 'customers', 'incidents']) {
      const first = await ops(path);
      expect(first.status, path).toBe(200);
      const etag = first.headers.get('etag');
      expect(etag, path).toBeTruthy();
      const again = await ops(path, { headers: { 'if-none-match': etag! } });
      expect(again.status, path).toBe(304);
    }
  });
});
