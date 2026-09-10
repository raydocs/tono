import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  assertFxRate,
  assertLedgerEntry,
  assertList,
  assertMonthSummary,
  type LedgerEntryDto,
} from '../src/ops/contract';
import { runOpsCron } from '../src/ops/cron';
import { ledgerCsv } from '../src/ops/ledger';

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

  it('posts a USD cost using the stored rate and computes cnyMinor', async () => {
    await seedRate(DAY(), 'USD', 7.2);
    const res = await ops('ledger', json({
      kind: 'cost', category: 'server', subjectType: 'node', subjectId: NODE,
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

  it('rejects USD revenue with 收款只收人民币', async () => {
    await seedRate(DAY(), 'USD', 7.2);
    const res = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 1000, currency: 'USD', month: MONTH(),
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('收款只收人民币');
  });

  it('defaults omitted currency to CNY for revenue and USD for cost', async () => {
    await seedRate(DAY(), 'USD', 7.2);
    const revenue = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 500, month: MONTH(),
    }));
    expect(revenue.status).toBe(201);
    expect(assertLedgerEntry(await revenue.json()).currency).toBe('CNY');
    const cost = await ops('ledger', json({
      kind: 'cost', category: 'server', subjectType: 'node', subjectId: NODE,
      amountMinor: 400, month: MONTH(),
    }));
    expect(cost.status).toBe(201);
    expect(assertLedgerEntry(await cost.json()).currency).toBe('USD');
  });

  it('rejects PATCH that tries to change currency', async () => {
    const created = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 100, currency: 'CNY', month: MONTH(),
    }));
    expect(created.status).toBe(201);
    const entry = assertLedgerEntry(await created.json());
    const patch = await ops(`ledger/${entry.id}`, json({ currency: 'USD' }, 'PATCH'));
    expect(patch.status).toBe(400);
    expect((await patch.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    const listed = assertList(await (await ops(`ledger?month=${MONTH()}`)).json(), assertLedgerEntry);
    expect(listed.items.find((row) => row.id === entry.id)?.currency).toBe('CNY');
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
    const total = lines[lines.length - 1].split(',');
    expect(total[1]).toBe('total');
    // 100 in, 40 out: 60, in yuan and in the original currency alike.
    expect(Number(total[5])).toBe(60);
    expect(Number(total[9])).toBe(60);
    expect(lines.length).toBe(4);
  });

  it('signs a refund down in both totals of the exported month', async () => {
    const month = MONTH();
    expect((await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 10000, currency: 'CNY', month,
    }))).status).toBe(201);
    expect((await ops('ledger', json({
      kind: 'refund', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 3000, currency: 'CNY', month,
    }))).status).toBe(201);
    const res = await ops(`months/${month}/export.csv`);
    expect(res.status).toBe(200);
    const text = (await res.text()).replace(/^\uFEFF/, '');
    const total = text.trim().split(/\r\n/).pop()!.split(',');
    expect(total[1]).toBe('total');
    expect(Number(total[5])).toBe(7000);
    expect(Number(total[9])).toBe(7000);
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

  it('rejects reverse when the current month is closed', async () => {
    const prev = shiftMonth(MONTH(), -1);
    const created = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 800, currency: 'CNY', month: prev,
    }));
    expect(created.status).toBe(201);
    const entry = assertLedgerEntry(await created.json());
    expect((await ops(`months/${prev}/close`, json({ notes: 'lock prev' }))).status).toBe(200);
    expect((await ops(`months/${MONTH()}/close`, json({ notes: 'lock now' }))).status).toBe(200);
    const reversed = await ops(`ledger/${entry.id}/reverse`, json({ note: 'undo' }));
    expect(reversed.status).toBe(409);
    expect((await reversed.json() as { error: { code: string } }).error.code).toBe('MONTH_CLOSED');
  });

  it('rejects a concurrent second reverse', async () => {
    const created = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 800, currency: 'CNY', month: MONTH(),
    }));
    expect(created.status).toBe(201);
    const entry = assertLedgerEntry(await created.json());
    const [a, b] = await Promise.all([
      ops(`ledger/${entry.id}/reverse`, json({ note: 'one' })),
      ops(`ledger/${entry.id}/reverse`, json({ note: 'two' })),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const summary = assertMonthSummary(await (await ops(`months/${MONTH()}`)).json());
    expect(summary.revenueCnyMinor).toBe(0);
  });

  it('returns 409 MONTH_CLOSED instead of 500 when two closes race', async () => {
    const month = MONTH();
    expect((await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 100, currency: 'CNY', month,
    }))).status).toBe(201);
    const [a, b] = await Promise.all([
      ops(`months/${month}/close`, json({ notes: 'a' })),
      ops(`months/${month}/close`, json({ notes: 'b' })),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json() as { error: { code: string } }).error.code).toBe('MONTH_CLOSED');
  });

  it('serves frozen totals, customers and nodes for a closed month after later metering arrives', async () => {
    const month = MONTH();
    await seedUser('u-a', 'a@example.com');
    await seedCycle(NODE, month);
    await seedBytes('u-a', NODE, month, 1_000_000_000);
    expect((await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-a',
      amountMinor: 20000, currency: 'CNY', month,
    }))).status).toBe(201);
    expect((await ops('ledger', json({
      kind: 'cost', category: 'server', subjectType: 'node', subjectId: NODE,
      amountMinor: 4000, currency: 'CNY', month,
    }))).status).toBe(201);
    const closed = await ops(`months/${month}/close`, json({ notes: 'lock' }));
    expect(closed.status).toBe(200);
    const before = assertMonthSummary(await closed.json());
    expect(before.unreconciled).toBe(0);
    expect(before.frozenPartial).toBeUndefined();
    await db().prepare(
      `INSERT INTO customer_activity_hours(
         user_id, device_id, hour_at, online_minutes, connected_minutes, bytes_up, bytes_down, node
       ) VALUES('u-a', 'd-2', ?, 60, 60, ?, 0, 'un-costed-node')`,
    ).bind(monthStart(month) + 7200, 2_000_000_000).run();
    const after = assertMonthSummary(await (await ops(`months/${month}`)).json());
    expect(after.frozen).toBe(true);
    expect(typeof after.frozenAt).toBe('number');
    expect(after.unreconciled).toBe(before.unreconciled);
    expect(after.revenueCnyMinor).toBe(before.revenueCnyMinor);
    expect(after.costCnyMinor).toBe(before.costCnyMinor);
    expect(after.marginCnyMinor).toBe(before.marginCnyMinor);
    // The allocation and the ¥/GB are the numbers the operator signed off on,
    // not a recomputation over rows that landed afterwards.
    expect(after.customers).toEqual(before.customers);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.customers.find((row) => row.userId === 'u-a')?.pending).toBe(false);
    expect(after.frozenPartial).toBeUndefined();
  });

  it('answers a closed month with no snapshot from live rows and says frozenPartial', async () => {
    const month = MONTH();
    await seedUser('u-a', 'a@example.com');
    await seedCycle(NODE, month);
    await seedBytes('u-a', NODE, month, 1_000_000_000);
    expect((await ops('ledger', json({
      kind: 'cost', category: 'server', subjectType: 'node', subjectId: NODE,
      amountMinor: 4000, currency: 'CNY', month,
    }))).status).toBe(201);
    expect((await ops(`months/${month}/close`, json({ notes: 'lock' }))).status).toBe(200);
    // What a month closed before the snapshot column looks like on disk.
    await db().prepare('UPDATE ops_month_close SET summary_json = NULL WHERE month = ?')
      .bind(month).run();
    await db().prepare(
      `INSERT INTO customer_activity_hours(
         user_id, device_id, hour_at, online_minutes, connected_minutes, bytes_up, bytes_down, node
       ) VALUES('u-a', 'd-2', ?, 60, 60, ?, 0, 'un-costed-node')`,
    ).bind(monthStart(month) + 7200, 2_000_000_000).run();
    const after = assertMonthSummary(await (await ops(`months/${month}`)).json());
    expect(after.frozen).toBe(true);
    expect(after.frozenPartial).toBe(true);
    expect(after.customers.find((row) => row.userId === 'u-a')?.pending).toBe(true);
    expect(after.nodes.some((row) => row.name === 'un-costed-node')).toBe(true);
    // The count stays the one that was signed off; only the rows went live.
    expect(after.unreconciled).toBe(0);
  });

  it('paginates GET ledger in SQL and reports COUNT(*) as total', async () => {
    const month = MONTH();
    const t = tnow();
    const day = DAY();
    for (let i = 0; i < 501; i += 50) {
      const chunk = Math.min(50, 501 - i);
      const stmts = [];
      for (let j = 0; j < chunk; j++) {
        const k = i + j;
        stmts.push(db().prepare(
          `INSERT INTO ops_ledger_entries(
             id, kind, category, subject_type, subject_id, amount_minor, currency,
             fx_rate_to_cny, fx_date, cny_minor, month, paid_at, note,
             reverses, reversed_by, created_by, created_at, updated_at
           ) VALUES(?, 'revenue', 'plan', 'user', 'u-1', 1, 'CNY', 1, ?, 1, ?, NULL, NULL, NULL, NULL, 'op', ?, ?)`,
        ).bind(`page-${k}`, day, month, t - k, t - k));
      }
      await db().batch(stmts);
    }
    const first = assertList(await (await ops(`ledger?month=${month}&limit=50`)).json(), assertLedgerEntry);
    expect(first.total).toBe(501);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const ids = new Set(first.items.map((row) => row.id));
    let cursor = first.nextCursor;
    while (cursor) {
      const page = assertList(
        await (await ops(`ledger?month=${month}&limit=50&cursor=${encodeURIComponent(cursor)}`)).json(),
        assertLedgerEntry,
      );
      expect(page.total).toBe(501);
      for (const row of page.items) ids.add(row.id);
      cursor = page.nextCursor;
    }
    expect(ids.size).toBe(501);
  });

  it('walks past two entries written in the same second', async () => {
    const month = MONTH();
    const t = tnow();
    const day = DAY();
    await db().batch(['tie-a', 'tie-b'].map((entryId) => db().prepare(
      `INSERT INTO ops_ledger_entries(
         id, kind, category, subject_type, subject_id, amount_minor, currency,
         fx_rate_to_cny, fx_date, cny_minor, month, paid_at, note,
         reverses, reversed_by, created_by, created_at, updated_at
       ) VALUES(?, 'revenue', 'plan', 'user', 'u-1', 1, 'CNY', 1, ?, 1, ?, NULL, NULL, NULL, NULL, 'op', ?, ?)`,
    ).bind(entryId, day, month, t, t)));
    const first = assertList(await (await ops(`ledger?month=${month}&limit=1`)).json(), assertLedgerEntry);
    expect(first.items.map((row) => row.id)).toEqual(['tie-b']);
    expect(first.nextCursor).toBeTruthy();
    const second = assertList(
      await (await ops(`ledger?month=${month}&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).json(),
      assertLedgerEntry,
    );
    expect(second.items.map((row) => row.id)).toEqual(['tie-a']);
  });

  it('rejects an oversized amountMinor and a month too far in the future', async () => {
    const tooMuch = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 1e12 + 1, currency: 'CNY', month: MONTH(),
    }));
    expect(tooMuch.status).toBe(400);
    const tooLate = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 100, currency: 'CNY', month: '2099-12',
    }));
    expect(tooLate.status).toBe(400);
    const tooEarly = await ops('ledger', json({
      kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
      amountMinor: 100, currency: 'CNY', month: '2023-12',
    }));
    expect(tooEarly.status).toBe(400);
  });
});

function csvEntry(over: Partial<LedgerEntryDto>): LedgerEntryDto {
  return {
    id: 'e1', kind: 'revenue', category: 'plan', subjectType: 'user', subjectId: 'u-1',
    amountMinor: 100, currency: 'CNY', fxRateToCny: 1, fxDate: '2026-09-01',
    cnyMinor: 100, month: '2026-09', paidAt: null, note: null, reverses: null,
    reversedBy: null, createdBy: 'op', createdAt: 1_800_000_000, ...over,
  };
}

describe('ledger csv', () => {
  it('totals signed CNY and blanks mixed-currency amount', () => {
    const csv = ledgerCsv([
      csvEntry({ id: 'r', kind: 'revenue', amountMinor: 20000, currency: 'CNY', cnyMinor: 20000 }),
      csvEntry({
        id: 'c', kind: 'cost', category: 'server', subjectType: 'node', subjectId: 'n1',
        amountMinor: 1000, currency: 'USD', fxRateToCny: 7.2, cnyMinor: 7200,
      }),
    ]);
    const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r\n/);
    const total = lines[lines.length - 1].split(',');
    expect(total[1]).toBe('total');
    expect(total[5]).toBe('');
    expect(Number(total[9])).toBe(20000 - 7200);
  });

  it('leaves a negative amount as a number and still guards a formula in a note', () => {
    const csv = ledgerCsv([
      csvEntry({ id: 'rev', kind: 'revenue', amountMinor: 80000, cnyMinor: -80000, note: '=1+1' }),
    ]);
    const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r\n/);
    const row = lines[1].split(',');
    expect(row[9]).toBe('-80000');
    expect(lines[lines.length - 1].split(',')[9]).toBe('-80000');
    expect(csv).toContain("'=1+1");
  });

  it('prefixes formula-like cells with a quote', () => {
    const csv = ledgerCsv([csvEntry({ id: 'inj', note: '=1+1', subjectId: '+cmd' })]);
    expect(csv).not.toMatch(/(?:^|,)=/m);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'+cmd");
  });
});
