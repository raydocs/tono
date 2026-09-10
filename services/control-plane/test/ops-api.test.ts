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

  it('PATCH nodes/{name}/profile upserts and returns node detail', async () => {
    await seedNode();
    const account = assertProviderAccount(await (await ops('provider-accounts', json({
      provider: 'bandwagon', label: 'main', cloudKind: 'vps',
    }))).json());
    const enc = encodeURIComponent(NODE);
    const res = await ops(`nodes/${enc}/profile`, json({
      provider: 'Bandwagon',
      providerAccountId: account.id,
      region: 'tyo',
      lineTags: ['cmi', 'gia'],
      port: 443,
      price: 12.5,
      currency: 'usd',
      billingCycle: 30,
      renewsAt: NOW + 86_400,
      expiresAt: NOW + 30 * 86_400,
      notes: 'primary tokyo',
      quota: { quotaBytes: 1_000_000_000, cycleKind: 'calendar_day', cycleAnchorDay: 1, counts: 'in_out' },
    }, 'PATCH'));
    expect(res.status).toBe(200);
    const detail = assertNodeDetail(await res.json());
    expect(detail.name).toBe(NODE);
    expect(detail.facts.provider).toBe('Bandwagon');
    expect(detail.facts.providerAccountId).toBe(account.id);
    expect(detail.facts.region).toBe('tyo');
    expect(detail.facts.lineTags).toEqual(['cmi', 'gia']);
    expect(detail.facts.price).toBe(12.5);
    expect(detail.facts.currency).toBe('USD');
    expect(detail.facts.billingCycle).toBe(30);
    expect(detail.facts.notes).toBe('primary tokyo');
    expect(detail.quota.value.quota).toBe(1_000_000_000);
    const cycle = await db().prepare(
      "SELECT quota_bytes, status FROM node_traffic_cycles WHERE node_name = ? AND status = 'open'",
    ).bind(NODE).first<{ quota_bytes: number; status: string }>();
    expect(Number(cycle?.quota_bytes)).toBe(1_000_000_000);
    const audit = await db().prepare(
      "SELECT action FROM ops_audit WHERE action = 'node.profile.update' AND target_id = ?",
    ).bind(NODE).first<{ action: string }>();
    expect(audit?.action).toBe('node.profile.update');

    const onlyStatus = 'Osaka · Wave';
    await db().prepare(
      `INSERT INTO ops_node_status(
         node_name, verdict, label, reason, candidate_streak, catalog_listed,
         rules_version, evaluated_at, changed_at
       ) VALUES(?, 'ok', '大陆正常', '大陆正常', 0, 1, 1, ?, ?)`,
    ).bind(onlyStatus, NOW, NOW).run();
    const created = await ops(`nodes/${encodeURIComponent(onlyStatus)}/profile`, json({
      region: 'osa', provider: 'dmit',
    }, 'PATCH'));
    expect(created.status).toBe(200);
    expect(assertNodeDetail(await created.json()).facts.region).toBe('osa');
    const row = await db().prepare(
      'SELECT catalog_name FROM ops_node_profiles WHERE catalog_name = ?',
    ).bind(onlyStatus).first<{ catalog_name: string }>();
    expect(row?.catalog_name).toBe(onlyStatus);
  });

  it('PATCH nodes/{name}/profile rejects an unknown key', async () => {
    await seedNode();
    const res = await ops(`nodes/${encodeURIComponent(NODE)}/profile`, json({ extra: true }, 'PATCH'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('PATCH nodes/{name}/profile rejects an unknown provider account', async () => {
    await seedNode();
    const res = await ops(`nodes/${encodeURIComponent(NODE)}/profile`, json({
      providerAccountId: 'no-such-account',
    }, 'PATCH'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('PATCH nodes/{name}/profile quota null clears the open cycle', async () => {
    await seedNode();
    const enc = encodeURIComponent(NODE);
    const set = await ops(`nodes/${enc}/profile`, json({
      quota: { quotaBytes: 500, cycleKind: 'rolling_30d', cycleAnchorDay: 15, counts: 'out' },
    }, 'PATCH'));
    expect(set.status).toBe(200);
    const openBefore = await db().prepare(
      "SELECT COUNT(*) AS c FROM node_traffic_cycles WHERE node_name = ? AND status = 'open'",
    ).bind(NODE).first<{ c: number }>();
    expect(Number(openBefore?.c)).toBe(1);
    const cleared = await ops(`nodes/${enc}/profile`, json({ quota: null }, 'PATCH'));
    expect(cleared.status).toBe(200);
    const detail = assertNodeDetail(await cleared.json());
    expect(detail.quota.value.quota).toBeNull();
    const openAfter = await db().prepare(
      "SELECT COUNT(*) AS c FROM node_traffic_cycles WHERE node_name = ? AND status = 'open'",
    ).bind(NODE).first<{ c: number }>();
    expect(Number(openAfter?.c)).toBe(0);
    const profile = await db().prepare(
      'SELECT traffic_quota_bytes, cycle_kind, quota_counts FROM ops_node_profiles WHERE catalog_name = ?',
    ).bind(NODE).first<{ traffic_quota_bytes: number | null; cycle_kind: string | null; quota_counts: string | null }>();
    expect(profile?.traffic_quota_bytes).toBeNull();
    expect(profile?.cycle_kind).toBeNull();
    expect(profile?.quota_counts).toBeNull();
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

  it('GET customers/{id} exposes per-device live status and connections filter by deviceId', async () => {
    await seedUser();
    await db().prepare(
      `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
       VALUES('d-mac', 'u-1', 'inst-mac', 'MacBook', 'active', ?, ?),
             ('d-win', 'u-1', 'inst-win', 'DESKTOP', 'active', ?, ?)`,
    ).bind(NOW, NOW, NOW, NOW).run();
    await db().prepare(
      `INSERT INTO ops_device_status(
         user_id, device_id, platform, app_version, os_version, selected_server,
         connected, last_seen_at, last_fail_at, last_fail_code, last_fail_node, fails_30m, updated_at
       ) VALUES
         ('u-1', 'd-mac', 'macos', '0.0.20', 'macOS 15', 'Tokyo · Fuji', 1, ?, NULL, NULL, NULL, 0, ?),
         ('u-1', 'd-win', 'windows', '0.0.18', 'Windows 11', 'Los Angeles · Mesa', 0, ?, ?, 'ETIMEDOUT', 'Los Angeles · Mesa', 1, ?)`,
    ).bind(NOW, NOW, NOW - 10, NOW - 10, NOW).run();
    await db().prepare(
      `INSERT INTO connection_events(
         id, at_ms, received_at, source, user_id, device_id, kind, node
       ) VALUES
         ('e-mac', ?, ?, 'window', 'u-1', 'd-mac', 'connectOk', 'Tokyo · Fuji'),
         ('e-win', ?, ?, 'failure', 'u-1', 'd-win', 'connectFail', 'Los Angeles · Mesa')`,
    ).bind(NOW * 1000, NOW, (NOW - 10) * 1000, NOW - 10).run();

    const detail = assertCustomerDetail(await (await ops('customers/u-1')).json());
    const byId = Object.fromEntries(detail.devices.map((row) => [row.id, row]));
    expect(byId['d-mac']).toMatchObject({
      name: 'MacBook', connected: true, selectedServer: 'Tokyo · Fuji',
      lastFailAt: null, lastFailCode: null, lastFailNode: null, appVersion: '0.0.20',
    });
    expect(byId['d-win']).toMatchObject({
      name: 'DESKTOP', connected: false, selectedServer: 'Los Angeles · Mesa',
      lastFailCode: 'ETIMEDOUT', lastFailNode: 'Los Angeles · Mesa', appVersion: '0.0.18',
    });

    const filtered = assertList(
      await (await ops('customers/u-1/connections?deviceId=d-win')).json(),
      assertConnectionEvent,
    );
    expect(filtered.items.map((row) => row.id)).toEqual(['e-win']);
    const all = assertList(
      await (await ops('customers/u-1/connections')).json(),
      assertConnectionEvent,
    );
    expect(all.items.map((row) => row.id).sort()).toEqual(['e-mac', 'e-win']);
  });

  it('customer list and detail take an open customer-repeat-fail as 连不上', async () => {
    await seedUser('u-fail', 'fail@example.com');
    const t = Math.floor(Date.now() / 1000);
    await db().prepare(
      `INSERT INTO ops_incidents(
         id, dedupe_key, kind, subject_type, subject_id, severity, status, title,
         rules_version, opened_at, last_seen_at, impact_count, updated_at
       ) VALUES('inc-fail', 'customer-repeat-fail:u-fail', 'customer-repeat-fail', 'user', 'u-fail',
                'warn', 'open', '连续失败', 1, ?, ?, 1, ?)`,
    ).bind(t, t, t).run();
    const list = assertList(await (await ops('customers')).json(), assertCustomerSummary);
    const row = list.items.find((item) => item.userId === 'u-fail');
    expect(row?.verdict).toBe('unreachable');
    expect(row?.health).toBe('连不上');
    const detail = assertCustomerDetail(await (await ops('customers/u-fail')).json());
    expect(detail.verdict).toBe('unreachable');
    expect(detail.health).toBe('连不上');
  });

  it('customer list and detail treat a 50-minute-old heartbeat as 未上报', async () => {
    await seedUser('u-stale', 'stale@example.com');
    const seen = Math.floor(Date.now() / 1000) - 50 * 60;
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, selected_server, last_seen_at, updated_at)
       VALUES('u-stale', 1, ?, ?, ?)`,
    ).bind(NODE, seen, seen).run();
    const list = assertList(await (await ops('customers')).json(), assertCustomerSummary);
    const row = list.items.find((item) => item.userId === 'u-stale');
    expect(row?.verdict).toBe('unreported');
    expect(row?.health).toBe('未上报');
    const detail = assertCustomerDetail(await (await ops('customers/u-stale')).json());
    expect(detail.verdict).toBe('unreported');
    expect(detail.health).toBe('未上报');
  });

  it('PATCH wechatId round-trips into GET customers/{id} and list', async () => {
    await seedUser();
    const patched = await ops('users/u-1', json({ wechatId: '  wxid_alice  ' }, 'PATCH'));
    expect(patched.status).toBe(200);
    const detail = assertCustomerDetail(await (await ops('customers/u-1')).json());
    expect(detail.wechatId).toBe('wxid_alice');
    const list = assertList(await (await ops('customers')).json(), assertCustomerSummary);
    expect(list.items.find((item) => item.userId === 'u-1')?.wechatId).toBe('wxid_alice');
    const audit = await db().prepare(
      "SELECT action FROM ops_audit WHERE action = 'user.wechat.update' AND target_id = 'u-1'",
    ).first<{ action: string }>();
    expect(audit?.action).toBe('user.wechat.update');
    const cleared = await ops('users/u-1', json({ wechatId: '' }, 'PATCH'));
    expect(cleared.status).toBe(200);
    expect(assertCustomerDetail(await (await ops('customers/u-1')).json()).wechatId).toBeNull();
  });

  it('POST users/onboard stores wechatId', async () => {
    await seedUser('u-1', 'a@example.com');
    const onboarded = await ops('users/onboard', json({
      email: 'a@example.com', wechatId: 'wxid_onboard',
    }));
    expect([200, 202]).toContain(onboarded.status);
    expect(assertCustomerDetail(await (await ops('customers/u-1')).json()).wechatId).toBe('wxid_onboard');
  });

  it('GET customers?q= matches email or wechat id, and default list is unchanged', async () => {
    await seedUser('u-1', 'a@example.com');
    await seedUser('u-2', 'b@example.com');
    expect((await ops('users/u-1', json({ wechatId: 'wxid_unique_zzz' }, 'PATCH'))).status).toBe(200);
    const byWechat = assertList(await (await ops('customers?q=UNIQUE_zzz')).json(), assertCustomerSummary);
    expect(byWechat.items.map((item) => item.userId)).toEqual(['u-1']);
    const byEmail = assertList(await (await ops('customers?q=B@EXAMPLE')).json(), assertCustomerSummary);
    expect(byEmail.items.map((item) => item.userId)).toEqual(['u-2']);
    const all = assertList(await (await ops('customers')).json(), assertCustomerSummary);
    expect(all.items.map((item) => item.userId).sort()).toEqual(['u-1', 'u-2']);
  });

  it('contact and notes are readable on GET customers/{id} after PATCH', async () => {
    await seedUser();
    const patched = await ops('users/u-1', json({ contact: 'wechat-phone', notes: 'vip' }, 'PATCH'));
    expect(patched.status).toBe(200);
    const detail = assertCustomerDetail(await (await ops('customers/u-1')).json());
    expect(detail.contact).toBe('wechat-phone');
    expect(detail.notes).toBe('vip');
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
    const secondsAt = Math.floor(Date.now() / 1000);
    const snoozedBySeconds = await ops('incidents/inc-1/snooze', json({ seconds: 14400 }));
    expect(snoozedBySeconds.status).toBe(200);
    const snoozedBody = assertIncident(await snoozedBySeconds.json());
    expect(snoozedBody.snoozedUntil).toBeGreaterThanOrEqual(secondsAt + 14400);
    expect(snoozedBody.snoozedUntil).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 14400);
    assertIncident(await (await ops('incidents/inc-1/notes', json({ note: 'watching' }))).json());
    assertIncident(await (await ops('incidents/inc-1/resolve', json({ closure: 'verified', note: 'recovered' }))).json());
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

  it('rejects alert-rule secretRef values that are not ALERT_ secrets', async () => {
    const denied = await ops('alert-rules', json({
      name: 'exfil', channel: 'webhook', target: 'https://api.telegram.org/bot',
      template: 'telegram', secretRef: 'JWT_SECRET',
    }));
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const allowed = await ops('alert-rules', json({
      name: 'telegram', channel: 'webhook', target: '-100123',
      template: 'telegram', secretRef: 'ALERT_TELEGRAM_BOT_TOKEN',
    }));
    expect(allowed.status).toBe(201);
    const patched = await ops(
      `alert-rules/${assertAlertRule(await allowed.json()).id}`,
      json({ secretRef: 'JWT_SECRET' }, 'PATCH'),
    );
    expect(patched.status).toBe(400);
    expect(await patched.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('alert-rule test drains only the synthetic delivery', async () => {
    const created = await ops('alert-rules', json({
      name: 'down', channel: 'webhook', target: 'https://hooks.example.com/in',
      template: 'generic',
    }));
    expect(created.status).toBe(201);
    const rule = assertAlertRule(await created.json());
    const due = Math.floor(Date.now() / 1000) - 10;
    await db().prepare(
      `INSERT INTO ops_alert_deliveries(
         id, rule_id, incident_id, dedupe_key, transition, status, attempts, created_at, next_attempt_at
       ) VALUES('real-pending', ?, 'inc-real', 'real-key', 'open', 'pending', 0, ?, ?)`,
    ).bind(rule.id, due, due).run();
    const tested = await ops(`alert-rules/${rule.id}/test`, json({}));
    expect(tested.status).toBe(200);
    const real = await db().prepare(
      "SELECT status, attempts FROM ops_alert_deliveries WHERE id = 'real-pending'",
    ).first<{ status: string; attempts: number }>();
    expect(real?.status).toBe('pending');
    expect(Number(real?.attempts)).toBe(0);
  });

  it('GET /api/v1/system/pulse is public, unauthenticated, and exact-shaped', async () => {
    const context = createExecutionContext();
    const res = await worker.fetch(
      new Request('https://test/api/v1/system/pulse'),
      env as unknown as Env,
      context,
    );
    await waitOnExecutionContext(context);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: false, cronAgeSec: null, buildSha: 'development' });

    const ranAt = Math.floor(Date.now() / 1000) - 60;
    await db().prepare(
      `INSERT INTO ops_cron_state(key, ran_at) VALUES('last_report', ?)`,
    ).bind(ranAt).run();
    const live = createExecutionContext();
    const again = await worker.fetch(
      new Request('https://test/api/v1/system/pulse'),
      env as unknown as Env,
      live,
    );
    await waitOnExecutionContext(live);
    const body = await again.json() as { ok: boolean; cronAgeSec: number | null; buildSha: string };
    expect(Object.keys(body).sort()).toEqual(['buildSha', 'cronAgeSec', 'ok']);
    expect(again.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.buildSha).toBe('development');
    expect(body.cronAgeSec).toBeGreaterThanOrEqual(60);
    expect(body.cronAgeSec).toBeLessThan(15 * 60);
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
    expect(health.backfill).toBeNull();
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
      fx: { ok: true, ms: 7, error: null },
      retention: { ok: true, ms: 6, error: null },
    };
    await db().prepare(
      `INSERT INTO ops_cron_state(key, ran_at, payload) VALUES('last_report', ?, ?)`,
    ).bind(NOW, JSON.stringify(steps)).run();
    const health = assertSystemHealth(await (await ops('system/health')).json());
    expect(health.cronLastRunAt).toBe(NOW);
    expect(health.cronLastDurationMs).toBe(58);
    expect(health.cronLastError).toBe('verdict boom');
    expect(health.cronSteps).toEqual(steps);
  });

  it('system/health reports backfill until both cursors catch up', async () => {
    await seedUser();
    for (const [index, id] of ['w-a', 'w-b', 'w-c'].entries()) {
      await db().prepare(
        `INSERT INTO telemetry_windows(
           id, user_id, device_id, received_at, window_start_ms, window_end_ms,
           client_version, os_version, payload_json
         ) VALUES(?, 'u-1', NULL, ?, ?, ?, '0.0.72', 'macOS 14.4', '{}')`,
      ).bind(id, NOW + index, NOW * 1000, NOW * 1000 + 60_000).run();
    }
    await db().prepare(
      `INSERT INTO ops_flatten_cursor(singleton_id, last_received_at, last_window_id, updated_at)
       VALUES(1, ?, 'w-a', ?)`,
    ).bind(NOW, NOW).run();
    await db().prepare(
      `INSERT INTO ops_customer_projection_cursor(singleton_id, last_received_at, last_window_id, updated_at)
       VALUES(1, ?, 'w-b', ?)`,
    ).bind(NOW + 1, NOW).run();
    const behind = assertSystemHealth(await (await ops('system/health')).json());
    expect(behind.backfill).toEqual({
      windowsTotal: 3,
      windowsFlattened: 1,
      windowsProjected: 2,
    });
    await db().prepare(
      'UPDATE ops_flatten_cursor SET last_received_at = ?, last_window_id = ? WHERE singleton_id = 1',
    ).bind(NOW + 2, 'w-c').run();
    await db().prepare(
      'UPDATE ops_customer_projection_cursor SET last_received_at = ?, last_window_id = ? WHERE singleton_id = 1',
    ).bind(NOW + 2, 'w-c').run();
    const caught = assertSystemHealth(await (await ops('system/health')).json());
    expect(caught.backfill).toBeNull();
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
      'PATCH /api/v1/ops/nodes/{name}/profile',
      'GET /api/v1/ops/customers',
      'GET /api/v1/ops/customers/funnel',
      'GET /api/v1/ops/customers/{id}',
      'GET /api/v1/ops/customers/{id}/connections',
      'GET /api/v1/ops/customers/{id}/activity',
      'GET /api/v1/ops/customers/{id}/destinations',
      'GET /api/v1/ops/customers/{id}/services',
      'GET /api/v1/ops/customers/{id}/followups',
      'POST /api/v1/ops/customers/{id}/followups',
      'GET /api/v1/ops/incidents',
      'GET /api/v1/ops/incidents/{id}',
      'POST /api/v1/ops/incidents/{id}/ack',
      'POST /api/v1/ops/incidents/{id}/snooze',
      'POST /api/v1/ops/incidents/{id}/resolve',
      'POST /api/v1/ops/incidents/{id}/notes',
      'POST /api/v1/ops/incidents/{id}/followups',
      'PATCH /api/v1/ops/incidents/{id}',
      'GET /api/v1/ops/followups',
      'PATCH /api/v1/ops/followups/{id}',
      'GET /api/v1/ops/digest',
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
      'GET /api/v1/ops/ledger',
      'POST /api/v1/ops/ledger',
      'PATCH /api/v1/ops/ledger/{id}',
      'POST /api/v1/ops/ledger/{id}/reverse',
      'GET /api/v1/ops/months/{month}',
      'POST /api/v1/ops/months/{month}/close',
      'GET /api/v1/ops/months/{month}/export.csv',
      'GET /api/v1/ops/fx',
    ];
    expect([...OPS_V1_ROUTES].sort()).toEqual([...tested].sort());
  });
});
