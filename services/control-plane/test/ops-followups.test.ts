import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  assertDigest,
  assertFollowup,
  assertIncident,
  assertList,
} from '../src/ops/contract';
import { retainFollowups, shanghaiDateString } from '../src/ops/handlers/followups';

const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
const ACCESS_AUDIENCE = 'test-access-audience-0001';
const ACCESS_ADMIN_EMAIL = 'operator@example.com';
const OIDC_KEY_ID = 'test-oidc-key';
const NODE = 'Tokyo · Kite';

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
const tnow = () => Math.floor(Date.now() / 1000);

async function seedUser(id = 'u-1', email = 'a@example.com') {
  const t = tnow();
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'y', 'active', 0, ?, ?)`,
  ).bind(id, email, t, t).run();
}

async function seedIncident(id: string, status: 'open' | 'resolved' = 'open', extra: {
  resolvedAt?: number;
  closure?: string | null;
  nextCheckAt?: number | null;
  openedAt?: number;
} = {}) {
  const t = extra.openedAt ?? tnow();
  await db().prepare(
    `INSERT INTO ops_incidents(
       id, dedupe_key, kind, subject_type, subject_id, severity, status, title,
       rules_version, opened_at, last_seen_at, impact_count, updated_at,
       resolved_at, closure, next_check_at
     ) VALUES(?, ?, 'node_down', 'node', ?, 'warn', ?, '节点失联', 1, ?, ?, 1, ?, ?, ?, ?)`,
  ).bind(
    id, `node:x:${id}`, NODE, status, t, t, t,
    extra.resolvedAt ?? null, extra.closure ?? null, extra.nextCheckAt ?? null,
  ).run();
}

describe('ops followups, incident closure, digest', () => {
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

  it('creates, lists, patches and filters follow-ups, writing audit rows', async () => {
    await seedUser();
    const dueToday = tnow();
    const dueYesterday = tnow() - 86_400;
    const created = await ops('customers/u-1/followups', json({
      kind: 'reply', body: '已回复：请再连一次', dueAt: dueToday,
    }));
    expect(created.status).toBe(201);
    const row = assertFollowup(await created.json());
    expect(row.kind).toBe('reply');
    expect(row.subjectType).toBe('user');
    expect(row.subjectId).toBe('u-1');
    expect(row.dueAt).toBe(dueToday);
    expect(row.doneAt).toBeNull();

    const listed = assertList(await (await ops('customers/u-1/followups')).json(), assertFollowup);
    expect(listed.items[0]?.id).toBe(row.id);

    await seedIncident('inc-fu');
    const onIncident = await ops('incidents/inc-fu/followups', json({
      kind: 'await_customer', body: '等客户确认', dueAt: dueYesterday,
    }));
    expect(onIncident.status).toBe(201);
    const incidentFu = assertFollowup(await onIncident.json());
    expect(incidentFu.subjectType).toBe('incident');

    const today = assertList(await (await ops('followups?due=today')).json(), assertFollowup);
    expect(today.items.map((item) => item.id)).toContain(row.id);
    expect(today.items.map((item) => item.id)).not.toContain(incidentFu.id);

    const overdue = assertList(await (await ops('followups?due=overdue')).json(), assertFollowup);
    expect(overdue.items.map((item) => item.id)).toContain(incidentFu.id);

    const open = assertList(await (await ops('followups?due=open')).json(), assertFollowup);
    expect(open.items.length).toBeGreaterThanOrEqual(2);

    const patched = assertFollowup(await (await ops(`followups/${row.id}`, json({
      done: true, body: '已确认恢复',
    }, 'PATCH'))).json());
    expect(patched.doneAt).not.toBeNull();
    expect(patched.body).toBe('已确认恢复');

    const afterDone = assertList(await (await ops('followups?due=today')).json(), assertFollowup);
    expect(afterDone.items.map((item) => item.id)).not.toContain(row.id);

    const audit = await db().prepare(
      "SELECT action FROM ops_audit WHERE target_id = ?",
    ).bind(row.id).all<{ action: string }>();
    expect((audit.results ?? []).map((entry) => entry.action).sort()).toEqual([
      'followup.create', 'followup.update',
    ]);

    expect((await ops('followups?due=nope')).status).toBe(400);
    expect((await ops('customers/u-1/followups', json({ kind: 'nope', body: 'x' }))).status).toBe(400);
  });

  it('resolves with each closure and keeps false_positive on the resolved list', async () => {
    await seedIncident('inc-v');
    await seedIncident('inc-fp');
    await seedIncident('inc-m');
    const verified = assertIncident(await (await ops('incidents/inc-v/resolve', json({
      closure: 'verified', note: '复测通过',
    }))).json());
    expect(verified.closure).toBe('verified');
    expect(verified.status).toBe('resolved');

    const falsePositive = assertIncident(await (await ops('incidents/inc-fp/resolve', json({
      closure: 'false_positive', note: '联通回程抖动',
    }))).json());
    expect(falsePositive.closure).toBe('false_positive');
    const events = await db().prepare(
      'SELECT type, detail FROM ops_incident_events WHERE incident_id = ? ORDER BY at ASC',
    ).bind('inc-fp').all<{ type: string; detail: string }>();
    expect((events.results ?? []).some((event) => event.type === 'note' && event.detail.startsWith('误报：'))).toBe(true);

    const manual = assertIncident(await (await ops('incidents/inc-m/resolve', json({
      closure: 'manual',
    }))).json());
    expect(manual.closure).toBe('manual');

    expect((await ops('incidents/inc-v/resolve', json({ note: 'nope' }))).status).toBe(400);

    const resolved = assertList(await (await ops('incidents?status=resolved')).json(), assertIncident);
    const ids = resolved.items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(['inc-v', 'inc-fp', 'inc-m']));
  });

  it('patches nextCheckAt and rejects any other field', async () => {
    await seedIncident('inc-check');
    const next = tnow() + 7200;
    const patched = assertIncident(await (await ops('incidents/inc-check', json({
      nextCheckAt: next,
    }, 'PATCH'))).json());
    expect(patched.nextCheckAt).toBe(next);
    const note = await db().prepare(
      "SELECT detail FROM ops_incident_events WHERE incident_id = ? AND type = 'note'",
    ).bind('inc-check').first<{ detail: string }>();
    expect(note?.detail).toMatch(/^下次检查 /);
    expect((await ops('incidents/inc-check', json({ nextCheckAt: next, extra: 1 }, 'PATCH'))).status).toBe(400);
    expect((await ops('incidents/inc-check', json({ snoozedUntil: next }, 'PATCH'))).status).toBe(400);
  });

  it('digest shape excludes false_positive from overnight.resolved', async () => {
    const t = tnow();
    await seedIncident('inc-open', 'open', { nextCheckAt: t });
    await seedIncident('inc-ok', 'resolved', { resolvedAt: t - 600, closure: 'verified', openedAt: t - 7200 });
    await seedIncident('inc-bogus', 'resolved', { resolvedAt: t - 300, closure: 'false_positive', openedAt: t - 5400 });
    await seedUser();
    await db().prepare(
      `INSERT INTO ops_followups(
         id, subject_type, subject_id, kind, body, due_at, done_at, created_by, created_at, updated_at
       ) VALUES('fu-due', 'user', 'u-1', 'callback', '今晚回访', ?, NULL, ?, ?, ?)`,
    ).bind(t, ACCESS_ADMIN_EMAIL, t, t).run();

    const response = await ops('digest');
    expect(response.status).toBe(200);
    const digest = assertDigest(await response.json());
    expect(digest.day).toBe(shanghaiDateString(t));
    expect(digest.overnight.resolved.map((item) => item.id)).toContain('inc-ok');
    expect(digest.overnight.resolved.map((item) => item.id)).not.toContain('inc-bogus');
    expect(digest.overnight.opened.map((item) => item.id)).toEqual(expect.arrayContaining(['inc-open', 'inc-ok', 'inc-bogus']));
    expect(digest.open.map((item) => item.id)).toContain('inc-open');
    expect(digest.due.followups.map((item) => item.id)).toContain('fu-due');
    expect(digest.due.checks.map((item) => item.id)).toContain('inc-open');
  });

  it('drops follow-ups done more than 400 days ago', async () => {
    const t = tnow();
    await db().prepare(
      `INSERT INTO ops_followups(
         id, subject_type, subject_id, kind, body, due_at, done_at, created_by, created_at, updated_at
       ) VALUES('fu-old', 'user', 'u-1', 'note', 'old', NULL, ?, NULL, ?, ?)`,
    ).bind(t - 401 * 86_400, t - 401 * 86_400, t - 401 * 86_400).run();
    await db().prepare(
      `INSERT INTO ops_followups(
         id, subject_type, subject_id, kind, body, due_at, done_at, created_by, created_at, updated_at
       ) VALUES('fu-keep', 'user', 'u-1', 'note', 'keep', NULL, ?, NULL, ?, ?)`,
    ).bind(t - 10 * 86_400, t - 10 * 86_400, t - 10 * 86_400).run();
    await retainFollowups(db(), t);
    const left = await db().prepare(
      "SELECT id FROM ops_followups WHERE id IN ('fu-old', 'fu-keep') ORDER BY id",
    ).all<{ id: string }>();
    expect((left.results ?? []).map((row) => row.id)).toEqual(['fu-keep']);
  });

  it('reports idle node in weekly worthwhile digest', async () => {
    const t = tnow();
    await db().prepare(
      `INSERT INTO ops_node_profiles(
         id, catalog_name, status, price, currency, created_at, updated_at
       ) VALUES('np-idle', 'idle-node-1', 'active', 100, 'CNY', ?, ?)`,
    ).bind(t, t).run();

    const response = await ops('digest');
    expect(response.status).toBe(200);
    const digest = assertDigest(await response.json());
    expect(digest.worthwhile).toBeDefined();
    const picks = digest.worthwhile!.picks;
    expect(picks.length).toBeGreaterThanOrEqual(1);
    expect(picks[0].kind).toBe('idle_node');
    expect(picks[0].payoff?.kind).toBe('cny');
  });
});

