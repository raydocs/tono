import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { OPS_V1_ROUTES } from '../src/ops/router';
import {
  assertActivityHour,
  assertAdoptionMatrix,
  assertAlertDelivery,
  assertAlertRule,
  assertConnectionEvent,
  assertCustomerDetail,
  assertCustomerSummary,
  assertDestinationRow,
  assertDirectCandidate,
  assertHomeLine,
  assertHomeLineUsageDay,
  assertAuditList,
  assertIncident,
  assertIncidentDetail,
  assertJob,
  assertList,
  assertNodeBindings,
  assertNodeDetail,
  assertNodeErrorRow,
  assertNodeHistoryEntry,
  assertNodeSummary,
  assertProviderAccount,
  assertRelease,
  assertServiceUsage,
  assertSystemHealth,
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

async function seedNode(name = NODE) {
  const t = NOW;
  await db().prepare(
    `INSERT INTO ops_node_profiles(id, catalog_name, public_ip, provider, status, created_at, updated_at)
     VALUES(?, ?, '203.0.113.9', 'Bandwagon', 'active', ?, ?)`,
  ).bind(`p-${name}`, name, t, t).run();
  await db().prepare(
    `INSERT INTO ops_node_status(
       node_name, verdict, label, reason, candidate_streak, catalog_listed,
       rules_version, evaluated_at, changed_at
     ) VALUES(?, 'ok', '大陆正常', '大陆正常', 0, 1, 1, ?, ?)`,
  ).bind(name, t, t).run();
}

async function seedUser(id = 'u-1', email = 'a@example.com') {
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'y', 'active', 0, ?, ?)`,
  ).bind(id, email, NOW, NOW).run();
}

describe('ops v1 api', () => {
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
      if (request.url.startsWith('https://hooks.example.com/')) return new Response('ok', { status: 200 });
      return new Response(null, { status: 404 });
    });
  });

  beforeEach(() => {
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    (env as unknown as Env).ACCESS_AUD = ACCESS_AUDIENCE;
    (env as unknown as Env).ACCESS_ADMIN_EMAILS = ACCESS_ADMIN_EMAIL;
    (env as unknown as Env & { OPS_CONTRACT_STRICT?: string }).OPS_CONTRACT_STRICT = '1';
  });

  it('GET nodes list envelope and ETag', async () => {
    await seedNode();
    const res = await ops('nodes');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json() as unknown;
    const list = assertList(body, assertNodeSummary);
    expect(list.items.some((row) => row.name === NODE)).toBe(true);
    const again = await ops('nodes', { headers: { 'if-none-match': res.headers.get('etag')! } });
    expect(again.status).toBe(304);
  });

  it('GET nodes/{name} detail, history, connections, errors, bindings, jobs', async () => {
    await seedNode();
    await db().prepare(
      `INSERT INTO ops_node_status_history(id, node_name, at, from_verdict, to_verdict, reason, rules_version)
       VALUES('h1', ?, ?, 'unknown', 'ok', '大陆正常', 1)`,
    ).bind(NODE, NOW).run();
    await db().prepare(
      `INSERT INTO connection_events(
         id, at_ms, received_at, source, user_id, kind, node, code, tcp_delay_ms, edge_as_org, edge_via_exit
       ) VALUES('e1', ?, ?, 'window', 'u-1', 'connectOk', ?, NULL, 40, 'China Mobile', 0)`,
    ).bind(NOW * 1000, NOW, NODE).run();
    await db().prepare(
      `INSERT INTO node_error_daily(node, day_at, category, count, sample) VALUES(?, ?, 'dial_timeout', 2, 'timeout')`,
    ).bind(NODE, NOW - (NOW % 86400)).run();
    const enc = encodeURIComponent(NODE);
    const detail = assertNodeDetail(await (await ops(`nodes/${enc}`)).json());
    expect(detail.name).toBe(NODE);
    expect(detail.forwardPath.value.some((row) => row.carrier === 'mobile')).toBe(true);
    assertList(await (await ops(`nodes/${enc}/history`)).json(), assertNodeHistoryEntry);
    assertList(await (await ops(`nodes/${enc}/connections`)).json(), assertConnectionEvent);
    const errors = await (await ops(`nodes/${enc}/errors?range=7d`)).json() as { value: unknown[] };
    expect(Array.isArray(errors.value)).toBe(true);
    for (const row of errors.value) assertNodeErrorRow(row);
    assertNodeBindings(await (await ops(`nodes/${enc}/bindings`)).json());
    assertList(await (await ops(`nodes/${enc}/jobs`)).json(), assertJob);
  });

  it('POST nodes/{name}/jobs requires confirmName for destructive types', async () => {
    await seedNode();
    const enc = encodeURIComponent(NODE);
    const denied = await ops(`nodes/${enc}/jobs`, json({ type: 'xray_restart' }));
    expect(denied.status).toBe(400);
    const created = await ops(`nodes/${enc}/jobs`, json({ type: 'xray_restart', confirmName: NODE }));
    expect(created.status).toBe(201);
    assertJob(await created.json());
    const read = await ops(`nodes/${enc}/jobs`, json({ type: 'collect_quality' }));
    expect(read.status).toBe(201);
    assertJob(await read.json());
  });

  it('GET customers list and detail plus subresources', async () => {
    await seedUser();
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, selected_server, last_seen_at, updated_at)
       VALUES('u-1', 1, ?, ?, ?)`,
    ).bind(NODE, NOW, NOW).run();
    const list = assertList(await (await ops('customers')).json(), assertCustomerSummary);
    expect(list.items[0]?.email).toBe('a@example.com');
    assertCustomerDetail(await (await ops('customers/u-1')).json());
    assertList(await (await ops('customers/u-1/connections')).json(), assertConnectionEvent);
    assertList(await (await ops('customers/u-1/activity?range=24h')).json(), assertActivityHour);
    assertList(await (await ops('customers/u-1/destinations?range=7d')).json(), assertDestinationRow);
    assertList(await (await ops('customers/u-1/services?range=7d')).json(), assertServiceUsage);
  });

  it('incidents list, detail, ack, snooze, resolve, notes', async () => {
    await db().prepare(
      `INSERT INTO ops_incidents(
         id, dedupe_key, kind, subject_type, subject_id, severity, status, title,
         rules_version, opened_at, last_seen_at, impact_count, updated_at
       ) VALUES('inc-1', 'node:x:down', 'node_down', 'node', ?, 'warn', 'open', '节点失联', 1, ?, ?, 1, ?)`,
    ).bind(NODE, NOW, NOW, NOW).run();
    const list = assertList(await (await ops('incidents?status=open&severity=warn&subjectType=node')).json(), assertIncident);
    expect(list.items[0]?.id).toBe('inc-1');
    const detail = assertIncidentDetail(await (await ops('incidents/inc-1')).json());
    expect(detail.incident.id).toBe('inc-1');
    assertIncident(await (await ops('incidents/inc-1/ack', json({}))).json());
    assertIncident(await (await ops('incidents/inc-1/snooze', json({ until: NOW + 3600 }))).json());
    assertIncident(await (await ops('incidents/inc-1/notes', json({ note: 'watching' }))).json());
    assertIncident(await (await ops('incidents/inc-1/resolve', json({ note: 'recovered' }))).json());
  });

  it('GET jobs and POST cancel', async () => {
    await seedNode();
    const created = assertJob(await (await ops(`nodes/${encodeURIComponent(NODE)}/jobs`, json({ type: 'collect_quality' }))).json());
    assertList(await (await ops('jobs?status=queued&executor=hub')).json(), assertJob);
    const cancelled = await ops(`jobs/${created.id}/cancel`, json({}));
    expect(cancelled.status).toBe(200);
    expect(assertJob(await cancelled.json()).status).toBe('cancelled');
  });

  it('releases CRUD and adoption', async () => {
    const created = await ops('releases', json({
      platform: 'macos', channel: 'stable', version: '0.0.72', notes: 'ship',
    }));
    expect(created.status).toBe(201);
    const release = assertRelease(await created.json());
    assertList(await (await ops('releases?platform=macos&channel=stable')).json(), assertRelease);
    const patched = assertRelease(await (await ops(`releases/${release.id}`, json({ publish: true }, 'PATCH'))).json());
    expect(patched.publishedAt).not.toBeNull();
    assertAdoptionMatrix(await (await ops('releases/adoption?range=30d')).json());
  });

  it('direct-candidates accept/reject and traffic-policy draft', async () => {
    await db().prepare(
      `INSERT INTO direct_candidates(etld1, first_seen, last_seen, users, bytes_30d, status)
       VALUES('bilibili.com', ?, ?, 2, 100, 'new')`,
    ).bind(NOW, NOW).run();
    assertList(await (await ops('direct-candidates?status=new')).json(), assertDirectCandidate);
    const accepted = assertDirectCandidate(await (await ops('direct-candidates/bilibili.com/accept', json({}))).json());
    expect(accepted.status).toBe('accepted');
    const draft = await ops('traffic-policy/draft-from-candidates', json({}));
    expect(draft.status).toBe(200);
    const body = await draft.json() as { draft: unknown; note: string };
    expect(body.draft).toBeTruthy();
    expect(body.note).toBeTruthy();
    await db().prepare(
      `INSERT INTO direct_candidates(etld1, first_seen, last_seen, users, bytes_30d, status)
       VALUES('example.cn', ?, ?, 1, 10, 'new')`,
    ).bind(NOW, NOW).run();
    expect(assertDirectCandidate(await (await ops('direct-candidates/example.cn/reject', json({}))).json()).status).toBe('rejected');
  });

  it('provider-accounts and home-lines CRUD plus usage', async () => {
    const created = await ops('provider-accounts', json({
      provider: 'bandwagon', label: 'main', cloudKind: 'vps',
    }));
    expect(created.status).toBe(201);
    const account = assertProviderAccount(await created.json());
    assertList(await (await ops('provider-accounts')).json(), assertProviderAccount);
    assertProviderAccount(await (await ops(`provider-accounts/${account.id}`)).json());
    assertProviderAccount(await (await ops(`provider-accounts/${account.id}`, json({ label: 'main-2' }, 'PATCH'))).json());
    const home = await ops('home-lines', json({ proxyName: 'home-1', displayName: '家宽 1' }));
    expect(home.status).toBe(201);
    const line = assertHomeLine(await home.json());
    assertList(await (await ops('home-lines')).json(), assertHomeLine);
    assertHomeLine(await (await ops(`home-lines/${line.id}`)).json());
    assertHomeLine(await (await ops(`home-lines/${line.id}`, json({ isp: '电信' }, 'PATCH'))).json());
    assertList(await (await ops(`home-lines/${line.id}/usage?range=30d`)).json(), assertHomeLineUsageDay);
    const retired = assertHomeLine(await (await ops(`home-lines/${line.id}`, { method: 'DELETE' })).json());
    expect(retired.status).toBe('retired');
    const closed = assertProviderAccount(await (await ops(`provider-accounts/${account.id}`, { method: 'DELETE' })).json());
    expect(closed).toBeTruthy();
  });

  it('alert-rules CRUD, test, deliveries', async () => {
    const created = await ops('alert-rules', json({
      name: 'down', channel: 'webhook', target: 'https://hooks.example.com/in',
      template: 'generic', minSeverity: 'warn', fireOn: 'open',
    }));
    expect(created.status).toBe(201);
    const rule = assertAlertRule(await created.json());
    assertList(await (await ops('alert-rules')).json(), assertAlertRule);
    assertAlertRule(await (await ops(`alert-rules/${rule.id}`)).json());
    assertAlertRule(await (await ops(`alert-rules/${rule.id}`, json({ enabled: false }, 'PATCH'))).json());
    const tested = await ops(`alert-rules/${rule.id}/test`, json({}));
    expect(tested.status).toBe(200);
    assertAlertRule(await tested.json());
    assertList(await (await ops('alert-deliveries')).json(), assertAlertDelivery);
    const deleted = await ops(`alert-rules/${rule.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
  });

  it('GET audit and system/health', async () => {
    await seedNode();
    await ops(`nodes/${encodeURIComponent(NODE)}/jobs`, json({ type: 'collect_quality' }));
    // GET /api/v1/ops/audit is served by shared-admin (index.ts dispatches
    // there before opsRoutes). Shape is { entries, hasMore, nextBefore, nextBeforeId }.
    const auditRes = await ops('audit?targetId=' + encodeURIComponent(NODE));
    expect(auditRes.status).toBe(200);
    const audit = assertAuditList(await auditRes.json());
    expect(audit.entries.some((row) => row.action.includes('job'))).toBe(true);
    const health = assertSystemHealth(await (await ops('system/health')).json());
    expect(health.contractVersion).toBe(1);
    expect(health.sources.length).toBeGreaterThan(0);
    expect(health.cronLastRunAt).toBeNull();
    expect(health.cronLastDurationMs).toBeNull();
    expect(health.cronLastError).toBeNull();
    expect(health.cronSteps).toBeNull();
  });

  it('system/health surfaces persisted cron step durations', async () => {
    const steps = {
      flatten: { ok: true, ms: 10, error: null },
      project: { ok: true, ms: 20, error: null },
      verdicts: { ok: false, ms: 5, error: 'verdict boom' },
      alerts: { ok: true, ms: 1, error: null },
      jobs: { ok: true, ms: 2, error: null },
      quota: { ok: true, ms: 3, error: null },
      daily: { ok: true, ms: 4, error: null },
      retention: { ok: true, ms: 6, error: null },
    };
    await db().prepare(
      `INSERT INTO ops_cron_state(key, ran_at, payload) VALUES('last_report', ?, ?)`,
    ).bind(NOW, JSON.stringify(steps)).run();
    const health = assertSystemHealth(await (await ops('system/health')).json());
    expect(health.cronLastRunAt).toBe(NOW);
    expect(health.cronLastDurationMs).toBe(51);
    expect(health.cronLastError).toBe('verdict boom');
    expect(health.cronSteps).toEqual(steps);
  });

  it('existing ops routes still respond', async () => {
    for (const path of [
      'dashboard', 'system/version', 'fleet-nodes', 'catalog-revisions', 'users',
      'signup-allowlist', 'live', 'metrics', 'usage-hours', 'activity',
    ]) {
      const res = await ops(path);
      expect(res.status, path).toBe(200);
    }
  });

  it('covers every /api/v1/ops/ path the v1 table and router handle', () => {
    const tested = [
      'GET /api/v1/ops/nodes',
      'GET /api/v1/ops/nodes/{name}',
      'GET /api/v1/ops/nodes/{name}/history',
      'GET /api/v1/ops/nodes/{name}/connections',
      'GET /api/v1/ops/nodes/{name}/errors',
      'GET /api/v1/ops/nodes/{name}/bindings',
      'GET /api/v1/ops/nodes/{name}/jobs',
      'POST /api/v1/ops/nodes/{name}/jobs',
      'GET /api/v1/ops/customers',
      'GET /api/v1/ops/customers/{id}',
      'GET /api/v1/ops/customers/{id}/connections',
      'GET /api/v1/ops/customers/{id}/activity',
      'GET /api/v1/ops/customers/{id}/destinations',
      'GET /api/v1/ops/customers/{id}/services',
      'GET /api/v1/ops/incidents',
      'GET /api/v1/ops/incidents/{id}',
      'POST /api/v1/ops/incidents/{id}/ack',
      'POST /api/v1/ops/incidents/{id}/snooze',
      'POST /api/v1/ops/incidents/{id}/resolve',
      'POST /api/v1/ops/incidents/{id}/notes',
      'GET /api/v1/ops/jobs',
      'POST /api/v1/ops/jobs/{id}/cancel',
      'GET /api/v1/ops/releases',
      'POST /api/v1/ops/releases',
      'PATCH /api/v1/ops/releases/{id}',
      'GET /api/v1/ops/releases/adoption',
      'GET /api/v1/ops/direct-candidates',
      'POST /api/v1/ops/direct-candidates/{etld1}/accept',
      'POST /api/v1/ops/direct-candidates/{etld1}/reject',
      'POST /api/v1/ops/traffic-policy/draft-from-candidates',
      'GET /api/v1/ops/provider-accounts',
      'POST /api/v1/ops/provider-accounts',
      'GET /api/v1/ops/provider-accounts/{id}',
      'PATCH /api/v1/ops/provider-accounts/{id}',
      'DELETE /api/v1/ops/provider-accounts/{id}',
      'GET /api/v1/ops/home-lines',
      'POST /api/v1/ops/home-lines',
      'GET /api/v1/ops/home-lines/{id}',
      'PATCH /api/v1/ops/home-lines/{id}',
      'DELETE /api/v1/ops/home-lines/{id}',
      'GET /api/v1/ops/home-lines/{id}/usage',
      'GET /api/v1/ops/alert-rules',
      'POST /api/v1/ops/alert-rules',
      'GET /api/v1/ops/alert-rules/{id}',
      'PATCH /api/v1/ops/alert-rules/{id}',
      'DELETE /api/v1/ops/alert-rules/{id}',
      'POST /api/v1/ops/alert-rules/{id}/test',
      'GET /api/v1/ops/alert-deliveries',
      'GET /api/v1/ops/audit',
      'GET /api/v1/ops/system/health',
    ];
    expect([...OPS_V1_ROUTES].sort()).toEqual([...tested].sort());
  });
});
