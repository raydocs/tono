import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  assertCustomerDetail,
  assertCustomerSummary,
  assertFunnel,
  assertFunnelRow,
  assertList,
} from '../src/ops/contract';
import { applyWindowToStatus } from '../src/ops/customers';
import { neverUsedOverride } from '../src/ops/verdict-customers';
import { classifyStage, funnelDays, stageSentence } from '../src/ops/funnel';

const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
const ACCESS_AUDIENCE = 'test-access-audience-0001';
const ACCESS_ADMIN_EMAIL = 'operator@example.com';
const OIDC_KEY_ID = 'test-oidc-key';

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
const tNow = () => Math.floor(Date.now() / 1000);

async function seedUser(id: string, email: string, createdAt: number) {
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'y', 'active', 0, ?, ?)`,
  ).bind(id, email, createdAt, createdAt).run();
}

async function seedDevice(id: string, userId: string, createdAt: number) {
  await db().prepare(
    `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
     VALUES(?, ?, ?, 'Mac', 'active', ?, ?)`,
  ).bind(id, userId, `inst-${id}`, createdAt, createdAt).run();
}

describe('ops onboarding funnel', () => {
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

  it('classifies stages and never_used reasons from the table', () => {
    const now = 1_800_000_000;
    const fiveDays = now - 5 * 86_400;
    const threeDays = now - 3 * 86_400;
    expect(classifyStage({
      hasUser: false, deviceCount: 0, firstDeviceAt: null, hasStatus: false, hasActivity: false,
      firstOnlineAt: null, statusUpdatedAt: null, firstConnectedAt: null, userCreatedAt: null,
      allowlistCreatedAt: fiveDays,
    })).toEqual({ stage: 'invited', stageSinceAt: fiveDays });
    expect(classifyStage({
      hasUser: true, deviceCount: 0, firstDeviceAt: null, hasStatus: false, hasActivity: false,
      firstOnlineAt: null, statusUpdatedAt: null, firstConnectedAt: null, userCreatedAt: fiveDays,
      allowlistCreatedAt: fiveDays,
    })).toEqual({ stage: 'registered', stageSinceAt: fiveDays });
    expect(classifyStage({
      hasUser: true, deviceCount: 1, firstDeviceAt: threeDays, hasStatus: false, hasActivity: false,
      firstOnlineAt: null, statusUpdatedAt: null, firstConnectedAt: null, userCreatedAt: fiveDays,
      allowlistCreatedAt: null,
    })).toEqual({ stage: 'device_added', stageSinceAt: threeDays });
    expect(classifyStage({
      hasUser: true, deviceCount: 1, firstDeviceAt: threeDays, hasStatus: true, hasActivity: false,
      firstOnlineAt: null, statusUpdatedAt: now - 100, firstConnectedAt: null, userCreatedAt: fiveDays,
      allowlistCreatedAt: null,
    })).toEqual({ stage: 'reported', stageSinceAt: now - 100 });
    expect(classifyStage({
      hasUser: true, deviceCount: 1, firstDeviceAt: threeDays, hasStatus: true, hasActivity: true,
      firstOnlineAt: now - 50, statusUpdatedAt: now, firstConnectedAt: now - 40, userCreatedAt: fiveDays,
      allowlistCreatedAt: null,
    })).toEqual({ stage: 'connected', stageSinceAt: now - 40 });

    expect(neverUsedOverride('unreported', 'registered', fiveDays, now)).toEqual({
      verdict: 'never_used', reason: '注册 5 天，还没装客户端',
    });
    expect(neverUsedOverride('offline', 'device_added', threeDays, now)).toEqual({
      verdict: 'never_used', reason: '装了客户端 3 天，还没上报',
    });
    expect(neverUsedOverride('unreported', 'reported', fiveDays, now)).toEqual({
      verdict: 'never_used', reason: '上报过，还没连上过',
    });
    expect(neverUsedOverride('unreachable', 'registered', fiveDays, now)).toBeNull();
    expect(neverUsedOverride('unstable', 'reported', fiveDays, now)).toBeNull();
    expect(neverUsedOverride('ok', 'connected', fiveDays, now)).toBeNull();
    expect(neverUsedOverride('unreported', 'connected', fiveDays, now)).toBeNull();
    expect(stageSentence('registered', funnelDays(now, fiveDays))).toBe('注册 5 天，还没装客户端');
  });

  it('GET customers/funnel shows invited through connected, with wechat on the stuck invite', async () => {
    const t = tNow();
    await db().prepare(
      `INSERT INTO signup_allowlist(email, created_at, wechat_id, contact, notes)
       VALUES('invitee@example.com', ?, 'wxid_invite', 'phone', 'opened')`,
    ).bind(t - 4 * 86_400).run();
    await seedUser('u-reg', 'reg@example.com', t - 5 * 86_400);
    await seedUser('u-dev', 'dev@example.com', t - 6 * 86_400);
    await seedDevice('d-dev', 'u-dev', t - 3 * 86_400);
    await seedUser('u-rep', 'rep@example.com', t - 7 * 86_400);
    await seedDevice('d-rep', 'u-rep', t - 4 * 86_400);
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, last_seen_at, updated_at)
       VALUES('u-rep', 0, NULL, ?)`,
    ).bind(t - 2 * 86_400).run();
    await seedUser('u-ok', 'ok@example.com', t - 10 * 86_400);
    await seedDevice('d-ok', 'u-ok', t - 9 * 86_400);
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, last_seen_at, updated_at, first_connected_at)
       VALUES('u-ok', 1, ?, ?, ?)`,
    ).bind(t, t, t - 8 * 86_400).run();

    const funnel = assertFunnel(await (await ops('customers/funnel')).json());
    const byKey = Object.fromEntries(funnel.items.map((row) => [row.key, row]));
    expect(byKey['invite:invitee@example.com']).toMatchObject({
      userId: null, email: 'invitee@example.com', wechatId: 'wxid_invite',
      stage: 'invited', contact: 'phone', notes: 'opened',
    });
    expect(byKey['u-reg']).toMatchObject({ stage: 'registered', email: 'reg@example.com' });
    expect(byKey['u-dev']).toMatchObject({ stage: 'device_added' });
    expect(byKey['u-rep']).toMatchObject({ stage: 'reported' });
    expect(funnel.items.some((row) => row.key === 'u-ok')).toBe(false);
    const counts = Object.fromEntries(funnel.stages.map((row) => [row.stage, row.count]));
    expect(counts).toMatchObject({
      invited: 1, registered: 1, device_added: 1, reported: 1, connected: 1,
    });
    expect(funnel.items[0]?.stageSinceAt).toBeGreaterThanOrEqual(funnel.items[funnel.items.length - 1]?.stageSinceAt ?? 0);
  });

  it('list/detail expose stage fields; reported never-connected is never_used / 还没用起来', async () => {
    const t = tNow();
    await seedUser('u-rep', 'rep@example.com', t - 4 * 86_400);
    await seedDevice('d-rep', 'u-rep', t - 4 * 86_400);
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, updated_at)
       VALUES('u-rep', 0, ?)`,
    ).bind(t - 86_400).run();
    const list = assertList(await (await ops('customers')).json(), assertCustomerSummary);
    const row = list.items.find((item) => item.userId === 'u-rep');
    expect(row?.stage).toBe('reported');
    expect(row?.verdict).toBe('never_used');
    expect(row?.health).toBe('还没用起来');
    expect(row?.reason).toBe('上报过，还没连上过');
    const detail = assertCustomerDetail(await (await ops('customers/u-rep')).json());
    expect(detail.stage).toBe('reported');
    expect(detail.verdict).toBe('never_used');
    expect(detail.health).toBe('还没用起来');
    expect(detail.firstConnectedAt).toBeNull();
  });

  it('user with no devices is registered; devices without telemetry are device_added', async () => {
    const t = tNow();
    await seedUser('u-reg', 'reg@example.com', t - 2 * 86_400);
    await seedUser('u-dev', 'dev@example.com', t - 2 * 86_400);
    await seedDevice('d-dev', 'u-dev', t - 86_400);
    const list = assertList(await (await ops('customers')).json(), assertCustomerSummary);
    expect(list.items.find((item) => item.userId === 'u-reg')?.stage).toBe('registered');
    expect(list.items.find((item) => item.userId === 'u-dev')?.stage).toBe('device_added');
  });

  it('connected firstConnectedAt prefers status, else activity hour', async () => {
    const t = tNow();
    const firstStatus = t - 20 * 86_400;
    await seedUser('u-st', 'st@example.com', t - 30 * 86_400);
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, last_seen_at, updated_at, first_connected_at)
       VALUES('u-st', 1, ?, ?, ?)`,
    ).bind(t, t, firstStatus).run();
    const fromStatus = assertCustomerDetail(await (await ops('customers/u-st')).json());
    expect(fromStatus.stage).toBe('connected');
    expect(fromStatus.firstConnectedAt).toBe(firstStatus);

    const hourAt = t - 40 * 86_400;
    await seedUser('u-hr', 'hr@example.com', t - 50 * 86_400);
    await db().prepare(
      `INSERT INTO customer_activity_hours(
         user_id, device_id, hour_at, online_minutes, connected_minutes, bytes_up, bytes_down
       ) VALUES('u-hr', 'd-1', ?, 10, 8, 1, 2)`,
    ).bind(hourAt).run();
    const fromHour = assertCustomerDetail(await (await ops('customers/u-hr')).json());
    expect(fromHour.stage).toBe('connected');
    expect(fromHour.firstConnectedAt).toBe(hourAt);
  });

  it('ingest sets first_connected_at once and never moves it', async () => {
    const t0 = tNow() - 120;
    await seedUser('u-ing', 'ing@example.com', t0);
    await applyWindowToStatus(db(), {
      id: 'w-a', user_id: 'u-ing', device_id: 'd-ing', received_at: t0,
      client_version: '0.0.19', os_version: 'macOS 15',
      payload: { uiState: 'connected', selectedServer: 'Tokyo · Kite', events: [] },
    }, null, t0 + 1);
    const first = await db().prepare(
      'SELECT first_connected_at, connected FROM ops_customer_status WHERE user_id = ?',
    ).bind('u-ing').first<{ first_connected_at: number; connected: number }>();
    expect(first?.connected).toBe(1);
    expect(first?.first_connected_at).toBe(t0 + 1);

    await applyWindowToStatus(db(), {
      id: 'w-b', user_id: 'u-ing', device_id: 'd-ing', received_at: t0 + 60,
      client_version: '0.0.19', os_version: 'macOS 15',
      payload: { uiState: 'connected', selectedServer: 'Tokyo · Kite', events: [] },
    }, null, t0 + 61);
    const again = await db().prepare(
      'SELECT first_connected_at FROM ops_customer_status WHERE user_id = ?',
    ).bind('u-ing').first<{ first_connected_at: number }>();
    expect(again?.first_connected_at).toBe(t0 + 1);
  });

  it('PATCH signup-allowlist round-trips wechat/contact/notes and 409s after registration', async () => {
    const t = tNow();
    const email = 'pending@example.com';
    await db().prepare(
      'INSERT INTO signup_allowlist(email, created_at) VALUES(?, ?)',
    ).bind(email, t).run();
    const patched = await ops(`signup-allowlist/${encodeURIComponent(email)}`, json({
      wechatId: '  wxid_pending  ', contact: 'wechat-phone', notes: 'vip drawer',
    }, 'PATCH'));
    expect(patched.status).toBe(200);
    const row = assertFunnelRow(await patched.json());
    expect(row).toMatchObject({
      key: `invite:${email}`, userId: null, email, wechatId: 'wxid_pending',
      contact: 'wechat-phone', notes: 'vip drawer', stage: 'invited',
    });
    const audit = await db().prepare(
      "SELECT action FROM ops_audit WHERE action = 'allowlist.profile' AND target_id = ?",
    ).bind(email).first<{ action: string }>();
    expect(audit?.action).toBe('allowlist.profile');

    const cleared = await ops(`signup-allowlist/${encodeURIComponent(email)}`, json({
      wechatId: '', contact: null, notes: null,
    }, 'PATCH'));
    expect(cleared.status).toBe(200);
    expect(assertFunnelRow(await cleared.json()).wechatId).toBeNull();

    const missing = await ops('signup-allowlist/nobody@example.com', json({ wechatId: 'x' }, 'PATCH'));
    expect(missing.status).toBe(404);

    await seedUser('u-pend', email, t);
    const conflict = await ops(`signup-allowlist/${encodeURIComponent(email)}`, json({ wechatId: 'x' }, 'PATCH'));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'ALREADY_REGISTERED' } });
  });

  it('onboarding chore appears after 3 days and not before', async () => {
    const t = tNow();
    await seedUser('u-late', 'late@example.com', t - 5 * 86_400);
    await seedUser('u-new', 'new@example.com', t - 2 * 86_400);
    const late = assertCustomerDetail(await (await ops('customers/u-late')).json());
    expect(late.chores.some((chore) => chore.id === 'onboarding:u-late')).toBe(true);
    const onboarding = late.chores.find((chore) => chore.kind === 'onboarding');
    expect(onboarding).toMatchObject({
      summary: '注册 5 天，还没装客户端', dueAt: null, createdAt: t - 5 * 86_400,
    });
    const fresh = assertCustomerDetail(await (await ops('customers/u-new')).json());
    expect(fresh.chores.some((chore) => chore.kind === 'onboarding')).toBe(false);
  });
});
