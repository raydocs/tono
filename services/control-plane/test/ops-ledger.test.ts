import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  assertFxRate,
  assertLedgerEntry,
  assertList,
  assertMonthSummary,
} from '../src/ops/contract';
import { runOpsCron } from '../src/ops/cron';

const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
const ACCESS_AUDIENCE = 'test-access-audience-0001';
const ACCESS_ADMIN_EMAIL = 'operator@example.com';
const OIDC_KEY_ID = 'test-oidc-key';
const NODE = 'Tokyo · Ledger';

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
const MONTH = () => new Date().toISOString().slice(0, 7);
const DAY = () => new Date().toISOString().slice(0, 10);

function shiftMonth(month: string, delta: number): string {
  const [year, monthNum] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNum - 1 + delta, 1)).toISOString().slice(0, 7);
}

function monthStart(month: string): number {
  const [year, monthNum] = month.split('-').map(Number);
  return Date.UTC(year, monthNum - 1, 1) / 1000;
}

async function seedUser(id = 'u-1', email = 'a@example.com') {
  const t = tnow();
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'y', 'active', 0, ?, ?)`,
  ).bind(id, email, t, t).run();
}

async function seedRate(day: string, base: string, rate: number) {
  await db().prepare(
    `INSERT INTO ops_fx_rates(day, base, quote, rate, fetched_at, source)
     VALUES(?, ?, 'CNY', ?, ?, 'frankfurter')`,
  ).bind(day, base, rate, tnow()).run();
}

async function seedCycle(node: string, month: string) {
  const start = monthStart(month);
  await db().prepare(
    `INSERT INTO node_traffic_cycles(
       id, node_name, cycle_start, cycle_end, used_bytes, resets_detected, status, updated_at
     ) VALUES(?, ?, ?, ?, 0, 0, 'open', ?)`,
  ).bind(`cyc-${node}`, node, start - 86400, start + 40 * 86400, tnow()).run();
}

async function seedBytes(userId: string, node: string, month: string, bytes: number) {
  await db().prepare(
    `INSERT INTO customer_activity_hours(
       user_id, device_id, hour_at, online_minutes, connected_minutes, bytes_up, bytes_down, node
     ) VALUES(?, 'd-1', ?, 60, 60, ?, 0, ?)`,
  ).bind(userId, monthStart(month) + 3600, bytes, node).run();
}

const accessFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  if (request.url === `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
    return Response.json({ keys: [oidcPublicKey] }, { headers: { 'cache-control': 'public, max-age=300' } });
  }
  if (request.url.includes('api.frankfurter.app')) {
    const base = new URL(request.url).searchParams.get('from') ?? 'USD';
    return Response.json({ amount: 1, base, date: DAY(), rates: { CNY: 7.2 } });
  }
  return new Response(null, { status: 404 });
};

describe('ops ledger, month close, live FX', () => {
  beforeAll(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify'],
    ) as CryptoKeyPair;
    oidcPrivateKey = keyPair.privateKey;
    oidcPublicKey = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), kid: OIDC_KEY_ID, use: 'sig', alg: 'RS256' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(accessFetch);
  });

  beforeEach(() => {
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    (env as unknown as Env).ACCESS_AUD = ACCESS_AUDIENCE;
    (env as unknown as Env).ACCESS_ADMIN_EMAILS = ACCESS_ADMIN_EMAIL;
    (env as unknown as Env & { OPS_CONTRACT_STRICT?: string }).OPS_CONTRACT_STRICT = '1';
  });

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockImplementation(accessFetch);
  });

  it('posts a USD entry using the stored rate and computes cnyMinor', async () => {
    await seedRate(DAY(), 'USD', 7.2);
    const res = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 1000, currency: 'usd', month: MONTH(),
    }));
    expect(res.status).toBe(201);
    const row = assertLedgerEntry(await res.json());
    expect(row.currency).toBe('USD');
    expect(row.fxRateToCny).toBe(7.2);
    expect(row.cnyMinor).toBe(7200);
    expect(row.fxDate).toBe(DAY());
    const listed = assertList(await (await ops(`ledger?month=${MONTH()}`)).json(), assertLedgerEntry);
    expect(listed.items[0].id).toBe(row.id);
    const audit = await db().prepare(
      "SELECT action FROM ops_audit WHERE target_id = ? AND action = 'ledger.create'",
    ).bind(row.id).first<{ action: string }>();
    expect(audit?.action).toBe('ledger.create');
  });

  it('returns 409 FX_RATE_MISSING when no rate exists for a non-CNY currency', async () => {
    const res = await ops('ledger', json({
      kind: 'cost', category: 'server', subjectType: 'node', subjectId: NODE,
      amountMinor: 500, currency: 'EUR', month: MONTH(),
    }));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('FX_RATE_MISSING');
  });

  it('rejects PATCH after close and allows reverse into the current month', async () => {
    const prev = shiftMonth(MONTH(), -1);
    const created = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 800, currency: 'CNY', month: prev,
    }));
    expect(created.status).toBe(201);
    const entry = assertLedgerEntry(await created.json());
    const closed = await ops(`months/${prev}/close`, json({ notes: 'lock' }));
    expect(closed.status).toBe(200);
    const patch = await ops(`ledger/${entry.id}`, json({ note: 'too late' }, 'PATCH'));
    expect(patch.status).toBe(409);
    expect((await patch.json() as { error: { code: string } }).error.code).toBe('MONTH_CLOSED');
    const reversed = await ops(`ledger/${entry.id}/reverse`, json({ note: 'undo' }));
    expect(reversed.status).toBe(201);
    const reverse = assertLedgerEntry(await reversed.json());
    expect(reverse.reverses).toBe(entry.id);
    expect(reverse.cnyMinor).toBe(-entry.cnyMinor);
    expect(reverse.month).toBe(MONTH());
    const current = assertList(await (await ops(`ledger?month=${MONTH()}`)).json(), assertLedgerEntry);
    expect(current.items.some((row) => row.id === reverse.id)).toBe(true);
    const original = assertList(await (await ops(`ledger?month=${prev}`)).json(), assertLedgerEntry);
    expect(original.items[0].reversedBy).toBe(reverse.id);
  });

  it('summarises two customers on one node at a 3:1 byte split plus one Claude account', async () => {
    const month = MONTH();
    await seedUser('u-a', 'a@example.com');
    await seedUser('u-b', 'b@example.com');
    await seedCycle(NODE, month);
    await seedBytes('u-a', NODE, month, 3_000_000_000);
    await seedBytes('u-b', NODE, month, 1_000_000_000);
    await db().prepare(
      `INSERT INTO product_accounts(id, user_id, product, account_ref, status, created_at, updated_at)
       VALUES('acct-claude', 'u-a', 'claude_20x', 'claude-a@x.com', 'assigned', ?, ?)`,
    ).bind(tnow(), tnow()).run();
    const post = (body: object) => ops('ledger', json(body));
    expect((await post({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-a',
      amountMinor: 20000, currency: 'CNY', month,
    })).status).toBe(201);
    expect((await post({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-b',
      amountMinor: 10000, currency: 'CNY', month,
    })).status).toBe(201);
    expect((await post({
      kind: 'cost', category: 'server', subjectType: 'node', subjectId: NODE,
      amountMinor: 10000, currency: 'CNY', month,
    })).status).toBe(201);
    expect((await post({
      kind: 'cost', category: 'claude_account', subjectType: 'account', subjectId: 'acct-claude',
      amountMinor: 3000, currency: 'CNY', month,
    })).status).toBe(201);

    const summary = assertMonthSummary(await (await ops(`months/${month}`)).json());
    expect(summary.revenueCnyMinor).toBe(30000);
    expect(summary.costCnyMinor).toBe(13000);
    expect(summary.marginCnyMinor).toBe(17000);
    expect(summary.byCategory.plan).toBe(30000);
    expect(summary.byCategory.server).toBe(10000);
    expect(summary.byCategory.claude_account).toBe(3000);
    const a = summary.customers.find((row) => row.userId === 'u-a');
    const b = summary.customers.find((row) => row.userId === 'u-b');
    expect(a).toMatchObject({ revenueCnyMinor: 20000, costCnyMinor: 10500, marginCnyMinor: 9500, pending: false });
    expect(b).toMatchObject({ revenueCnyMinor: 10000, costCnyMinor: 2500, marginCnyMinor: 7500, pending: false });
    expect(summary.nodes[0]).toMatchObject({
      name: NODE, costCnyMinor: 10000, bytes: 4_000_000_000, cnyPerGbMinor: 2500, pending: false,
    });
    expect(summary.unreconciled).toBe(0);
  });

  it('marks customers and nodes pending when metering is missing', async () => {
    const month = MONTH();
    await seedUser('u-a', 'a@example.com');
    await seedBytes('u-a', NODE, month, 1_000_000_000);
    expect((await ops('ledger', json({
      kind: 'cost', category: 'server', subjectType: 'node', subjectId: NODE,
      amountMinor: 1000, currency: 'CNY', month,
    }))).status).toBe(201);
    const summary = assertMonthSummary(await (await ops(`months/${month}`)).json());
    expect(summary.customers[0].pending).toBe(true);
    expect(summary.customers[0].marginCnyMinor).toBeNull();
    expect(summary.nodes[0].pending).toBe(true);
    expect(summary.nodes[0].cnyPerGbMinor).toBeNull();
    expect(summary.unreconciled).toBe(2);
  });

  it('exports CSV with a UTF-8 BOM and a totals row', async () => {
    const month = MONTH();
    expect((await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 100, currency: 'CNY', month,
    }))).status).toBe(201);
    expect((await ops('ledger', json({
      kind: 'cost', category: 'other', subjectType: 'fleet',
      amountMinor: 40, currency: 'CNY', month,
    }))).status).toBe(201);
    const res = await ops(`months/${month}/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.subarray(3));
    const lines = text.trim().split(/\r\n/);
    expect(lines[0]).toContain('amountMinor');
    expect(lines[lines.length - 1]).toContain('total');
    expect(lines[lines.length - 1]).toContain(',140,');
    expect(lines.length).toBe(4);
  });

  it('GET fx returns a stored rate, an older fallback day, and CNY identity', async () => {
    await seedRate('2026-09-01', 'USD', 7.1);
    const exact = assertFxRate(await (await ops('fx?day=2026-09-01&base=USD')).json());
    expect(exact.rate).toBe(7.1);
    expect(exact.day).toBe('2026-09-01');
    const older = assertFxRate(await (await ops('fx?day=2026-09-10&base=USD')).json());
    expect(older.day).toBe('2026-09-01');
    expect(older.rate).toBe(7.1);
    const cny = assertFxRate(await (await ops('fx?day=2026-09-10&base=CNY')).json());
    expect(cny.rate).toBe(1);
    expect(cny.day).toBe('2026-09-10');
  });

  it('fx cron step stores frankfurter rates and reports ok:false on failure', async () => {
    const nowSec = tnow();
    const ok = await runOpsCron(env as unknown as Env, nowSec);
    expect(ok.fx.ok).toBe(true);
    expect(ok.fx.fetched).toBe(5);
    const usd = await db().prepare(
      "SELECT rate, source FROM ops_fx_rates WHERE day = ? AND base = 'USD' AND quote = 'CNY'",
    ).bind(DAY()).first<{ rate: number; source: string }>();
    expect(Number(usd?.rate)).toBe(7.2);
    expect(usd?.source).toBe('frankfurter');

    await db().prepare('DELETE FROM ops_cron_state WHERE key = ?').bind('fx').run();
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url.includes('api.frankfurter.app')) {
        return new Response('nope', { status: 503 });
      }
      return accessFetch(input, init);
    });
    const failed = await runOpsCron(env as unknown as Env, nowSec + 10);
    expect(failed.fx.ok).toBe(false);
    const still = await db().prepare(
      "SELECT rate FROM ops_fx_rates WHERE day = ? AND base = 'USD'",
    ).bind(DAY()).first<{ rate: number }>();
    expect(Number(still?.rate)).toBe(7.2);
  });
});
