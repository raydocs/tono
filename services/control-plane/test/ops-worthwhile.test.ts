// 本周最值得做的三件事.
//
// Two halves. The week boundary is arithmetic and is tested as such: 本周 means
// Monday in Asia/Shanghai, so a Sunday evening in UTC is already next week's
// Monday. The picking is tested one generator at a time against seeded rows,
// and then as a whole: three at most, one per subject, the same ids on a second
// read, and never more than ten statements however much is in the database.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { assertDigest, assertWorthwhile } from '../src/ops/contract';
import { emptyWorthwhile, shanghaiWeekOf, weeklyWorthwhile, STATEMENT_CEILING } from '../src/ops/worthwhile';
import { FALLBACK_CNY_PER_GB_MINOR } from '../src/ops/worthwhile-picks';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const DAY = 86_400;
/** A Thursday, well past the 5th, so 月结 is in play unless a close is seeded. */
const NOW = at('2026-09-10T04:00:00Z');
const db = env.DB;

/** Every table these generators read, emptied so one case cannot seed another. */
async function wipe(): Promise<void> {
  for (const table of [
    'ops_node_profiles', 'customer_activity_hours', 'ops_customer_status',
    'node_traffic_cycles', 'user_home_bindings', 'home_exits', 'ops_incidents',
    'direct_candidates', 'ops_ledger_entries', 'ops_followups', 'ops_month_close',
    'ops_fx_rates', 'users',
  ]) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
  // Nothing is due to be closed unless a case says so.
  await db.prepare(
    `INSERT INTO ops_month_close(month, closed_at, revenue_cny_minor, cost_cny_minor,
       margin_cny_minor, unreconciled)
     VALUES('2026-08', ?, 0, 0, 0, 0)`,
  ).bind(NOW).run();
}

async function node(
  name: string,
  fields: { price?: number; currency?: string; renewsAt?: number; expiresAt?: number } = {},
): Promise<void> {
  await db.prepare(
    `INSERT INTO ops_node_profiles(id, catalog_name, price, currency, renews_at, expires_at,
       status, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).bind(
    `np-${name}`, name, fields.price ?? null, fields.currency ?? null,
    fields.renewsAt ?? null, fields.expiresAt ?? null, NOW, NOW,
  ).run();
}

async function customerOn(userId: string, server: string): Promise<void> {
  await db.prepare(
    'INSERT INTO ops_customer_status(user_id, selected_server, updated_at) VALUES(?, ?, ?)',
  ).bind(userId, server, NOW).run();
}

async function bytesOn(node_: string, hourAt: number, bytes: number): Promise<void> {
  await db.prepare(
    `INSERT INTO customer_activity_hours(user_id, device_id, hour_at, bytes_up, bytes_down, node)
     VALUES(?, '', ?, 0, ?, ?)`,
  ).bind(`u-${node_}`, hourAt, bytes, node_).run();
}

async function incident(
  id: string,
  subjectType: string,
  subjectId: string,
  openedAt: number,
  extra: { closure?: string; parent?: string } = {},
): Promise<void> {
  await db.prepare(
    `INSERT INTO ops_incidents(id, dedupe_key, kind, subject_type, subject_id, severity, status,
       title, rules_version, opened_at, last_seen_at, updated_at, closure, parent_incident_id)
     VALUES(?, ?, 'node_down', ?, ?, 'warn', 'resolved', 'x', 1, ?, ?, ?, ?, ?)`,
  ).bind(
    id, id, subjectType, subjectId, openedAt, openedAt, openedAt,
    extra.closure ?? null, extra.parent ?? null,
  ).run();
}

async function followup(id: string, subjectId: string, dueAt: number): Promise<void> {
  await db.prepare(
    `INSERT INTO ops_followups(id, subject_type, subject_id, kind, body, due_at, done_at,
       created_at, updated_at)
     VALUES(?, 'user', ?, 'callback', 'x', ?, NULL, ?, ?)`,
  ).bind(id, subjectId, dueAt, dueAt, dueAt).run();
}

async function usdRate(rate: number): Promise<void> {
  await db.prepare(
    `INSERT INTO ops_fx_rates(day, base, quote, rate, fetched_at, source)
     VALUES('2026-09-01', 'USD', 'CNY', ?, ?, 'frankfurter')`,
  ).bind(rate, NOW).run();
}

async function picksOf(nowSec = NOW) {
  const week = await weeklyWorthwhile(db, nowSec);
  expect(assertWorthwhile(week)).toEqual(week);
  return week;
}

/** `weeklyWorthwhile` against a database that counts what it was asked to prepare. */
async function countingRun(nowSec = NOW): Promise<number> {
  let statements = 0;
  const counted = new Proxy(db, {
    get(target, key, receiver) {
      if (key === 'prepare') {
        return (sql: string) => {
          statements += 1;
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, key, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await weeklyWorthwhile(counted as D1Database, nowSec);
  return statements;
}

describe('shanghaiWeekOf', () => {
  it('gives the Monday of the week a Thursday falls in', () => {
    expect(shanghaiWeekOf(at('2026-09-10T00:00:00Z'))).toBe('2026-09-07');
  });

  // 04:00 Monday in Shanghai. Answering 2026-09-13 here would put a whole
  // Monday's work under last week's heading.
  it('treats Sunday 20:00 UTC as the next Monday', () => {
    expect(shanghaiWeekOf(at('2026-09-13T20:00:00Z'))).toBe('2026-09-14');
  });

  it('keeps Monday 15:00 UTC on that same Monday', () => {
    expect(shanghaiWeekOf(at('2026-09-14T15:00:00Z'))).toBe('2026-09-14');
  });

  // 23:59:59 Sunday in Shanghai — the last second that still belongs to the
  // week that started on the 7th.
  it('keeps the last Shanghai second of Sunday in the old week', () => {
    expect(shanghaiWeekOf(at('2026-09-13T15:59:59Z'))).toBe('2026-09-07');
  });

  it('is idempotent: the Monday it names is its own week', () => {
    const monday = shanghaiWeekOf(at('2026-09-10T00:00:00Z'));
    expect(shanghaiWeekOf(Math.floor(Date.parse(`${monday}T00:00:00+08:00`) / 1000))).toBe(monday);
  });
});

describe('emptyWorthwhile', () => {
  it('is a valid, empty week', () => {
    const week = emptyWorthwhile(at('2026-09-10T00:00:00Z'));
    expect(assertWorthwhile(week)).toEqual(week);
    expect(week.picks).toEqual([]);
    expect(week.considered).toBe(0);
    expect(week.weekOf).toBe('2026-09-07');
  });
});

describe('每个产生器', () => {
  it('闲置机器: a paid machine with no traffic this month, converted at the stored rate', async () => {
    await wipe();
    await usdRate(7);
    await node('Tokyo · Fuji', { price: 12, currency: 'USD', renewsAt: NOW + 20 * DAY });
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'idle_node');
    expect(pick).toBeDefined();
    expect(pick!.subjectId).toBe('Tokyo · Fuji');
    // $12 at 7 CNY/USD is ¥84, which is 8400 fen.
    expect(pick!.payoff).toEqual({ kind: 'cny', value: 8_400, isEstimate: false });
    expect(pick!.metric).toEqual({ kind: 'cnyMinor', value: 8_400 });
    expect(pick!.confidence).toBe('high');
    expect(pick!.deadlineSec).toBe(NOW + 20 * DAY);
    expect(pick!.action).toEqual({ page: 'nodes', section: null, subjectId: 'Tokyo · Fuji' });
  });

  it('闲置机器: a machine that carried bytes this month is not idle', async () => {
    await wipe();
    await usdRate(7);
    await node('Tokyo · Fuji', { price: 12, currency: 'USD' });
    await bytesOn('Tokyo · Fuji', at('2026-09-02T00:00:00Z'), 5_000_000);
    const week = await picksOf();
    expect(week.picks.filter((row) => row.kind === 'idle_node')).toEqual([]);
  });

  it('闲置机器: no stored rate makes the payoff an estimate at low confidence', async () => {
    await wipe();
    await node('Tokyo · Fuji', { price: 12, currency: 'USD' });
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'idle_node')!;
    // The raw price stands in as yuan and says so, rather than the line vanishing.
    expect(pick.payoff).toEqual({ kind: 'cny', value: 1_200, isEstimate: true });
    expect(pick.confidence).toBe('low');
  });

  it('闲置机器: a currency that is neither yuan nor dollars is an estimate too', async () => {
    await wipe();
    await db.prepare(
      `INSERT INTO ops_fx_rates(day, base, quote, rate, fetched_at, source)
       VALUES('2026-09-01', 'JPY', 'CNY', 0.05, ?, 'frankfurter')`,
    ).bind(NOW).run();
    await node('Tokyo · Fuji', { price: 1_500, currency: 'JPY' });
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'idle_node')!;
    expect(pick.payoff!.isEstimate).toBe(true);
    expect(pick.confidence).toBe('low');
  });

  it('流量将尽: an open cycle projected to run out before it ends', async () => {
    await wipe();
    await db.prepare(
      `INSERT INTO node_traffic_cycles(id, node_name, cycle_start, cycle_end, status,
         projected_exhaust_at, updated_at)
       VALUES('c1', 'Osaka · Kite', ?, ?, 'open', ?, ?)`,
    ).bind(NOW - 10 * DAY, NOW + 20 * DAY, NOW + 5 * DAY, NOW).run();
    await customerOn('u-1', 'Osaka · Kite');
    await customerOn('u-2', 'Osaka · Kite');
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'quota_exhausting')!;
    expect(pick.metric).toEqual({ kind: 'days', value: 5 });
    expect(pick.payoff).toEqual({ kind: 'customers', value: 2, isEstimate: true });
    expect(pick.confidence).toBe('medium');
    expect(pick.deadlineSec).toBe(NOW + 5 * DAY);
    expect(pick.action.page).toBe('nodes');
  });

  it('快到期: a renewal inside the fortnight, with who is on the machine', async () => {
    await wipe();
    await node('Osaka · Kite', { renewsAt: NOW + 6 * DAY });
    await customerOn('u-1', 'Osaka · Kite');
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'node_renewal')!;
    expect(pick.metric).toEqual({ kind: 'days', value: 6 });
    expect(pick.payoff).toEqual({ kind: 'customers', value: 1, isEstimate: true });
    expect(pick.confidence).toBe('high');
    expect(pick.deadlineSec).toBe(NOW + 6 * DAY);
  });

  it('快到期: a renewal a month out is not this week 的事', async () => {
    await wipe();
    await node('Osaka · Kite', { renewsAt: NOW + 30 * DAY });
    const week = await picksOf();
    expect(week.picks.filter((row) => row.kind === 'node_renewal')).toEqual([]);
  });

  it('家宽到期: a line still in service, with the users bound to it', async () => {
    await wipe();
    await db.prepare(
      `INSERT INTO home_exits(id, proxy_name, display_name, status, expires_at, created_at, updated_at)
       VALUES('he-1', 'home-sh', '上海家宽', 'active', ?, ?, ?)`,
    ).bind(NOW + 4 * DAY, NOW, NOW).run();
    await db.prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes,
         created_at, updated_at)
       VALUES('u-1', 'a@example.com', 'x', 'y', 'active', 0, ?, ?)`,
    ).bind(NOW, NOW).run();
    await db.prepare(
      'INSERT INTO user_home_bindings(user_id, home_exit_id, created_at, updated_at) VALUES(?, ?, ?, ?)',
    ).bind('u-1', 'he-1', NOW, NOW).run();
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'line_renewal')!;
    expect(pick.subjectType).toBe('home_exit');
    expect(pick.subjectLabel).toBe('上海家宽');
    expect(pick.metric).toEqual({ kind: 'days', value: 4 });
    expect(pick.payoff).toEqual({ kind: 'customers', value: 1, isEstimate: true });
    expect(pick.action).toEqual({ page: 'settings', section: 'homelines', subjectId: 'he-1' });
  });

  it('反复修: three real openings in a month, and half an hour each back', async () => {
    await wipe();
    await incident('i1', 'node', 'Osaka · Kite', NOW - 3 * DAY);
    await incident('i2', 'node', 'Osaka · Kite', NOW - 6 * DAY);
    await incident('i3', 'node', 'Osaka · Kite', NOW - 9 * DAY);
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'repeat_repair')!;
    expect(pick.metric).toEqual({ kind: 'incidents', value: 3 });
    expect(pick.payoff).toEqual({ kind: 'hours', value: 2, isEstimate: true });
    expect(pick.confidence).toBe('medium');
    expect(pick.action).toEqual({ page: 'nodes', section: null, subjectId: 'Osaka · Kite' });
  });

  it('反复修: 误报 and child incidents do not count towards the three', async () => {
    await wipe();
    await incident('i1', 'node', 'Osaka · Kite', NOW - 3 * DAY);
    await incident('i2', 'node', 'Osaka · Kite', NOW - 6 * DAY);
    await incident('i3', 'node', 'Osaka · Kite', NOW - 9 * DAY, { closure: 'false_positive' });
    await incident('i4', 'node', 'Osaka · Kite', NOW - 10 * DAY, { parent: 'i1' });
    expect((await picksOf()).picks.filter((row) => row.kind === 'repeat_repair')).toEqual([]);

    await incident('i5', 'node', 'Osaka · Kite', NOW - 11 * DAY);
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'repeat_repair')!;
    expect(pick.metric).toEqual({ kind: 'incidents', value: 3 });
  });

  it('反复修: a customer subject goes to the customer page', async () => {
    await wipe();
    for (const [index, id] of ['j1', 'j2', 'j3'].entries()) {
      await incident(id, 'user', 'u-04', NOW - (index + 1) * DAY);
    }
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'repeat_repair')!;
    expect(pick.subjectType).toBe('user');
    expect(pick.action).toEqual({ page: 'customers', section: null, subjectId: 'u-04' });
  });

  it('直连候选: an undecided destination, priced off the fallback when the month cannot say', async () => {
    await wipe();
    await db.prepare(
      `INSERT INTO direct_candidates(etld1, first_seen, last_seen, users, bytes_30d,
         connections_30d, country_hint, status)
       VALUES('example.com', ?, ?, 4, ?, 100, 'CN', 'new')`,
    ).bind(NOW - 30 * DAY, NOW - DAY, 200_000_000_000).run();
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'route_direct')!;
    expect(pick.subjectType).toBe('etld1');
    expect(pick.metric).toEqual({ kind: 'bytes', value: 200_000_000_000 });
    expect(pick.payoff).toEqual({
      kind: 'cny',
      value: 200 * FALLBACK_CNY_PER_GB_MINOR,
      isEstimate: true,
    });
    // No measured price means low, whatever the country hint says.
    expect(pick.confidence).toBe('low');
    expect(pick.action).toEqual({ page: 'settings', section: 'candidates', subjectId: 'example.com' });
  });

  it('直连候选: a month with a server bill and measured bytes prices it itself', async () => {
    await wipe();
    await db.prepare(
      `INSERT INTO direct_candidates(etld1, first_seen, last_seen, users, bytes_30d,
         connections_30d, country_hint, status)
       VALUES('example.com', ?, ?, 4, ?, 100, 'CN', 'new')`,
    ).bind(NOW - 30 * DAY, NOW - DAY, 100_000_000_000).run();
    await db.prepare(
      `INSERT INTO ops_ledger_entries(id, kind, category, subject_type, subject_id, amount_minor,
         currency, cny_minor, month, created_at, updated_at)
       VALUES('l1', 'cost', 'server', 'node', 'Osaka · Kite', 10000, 'CNY', 10000, '2026-09', ?, ?)`,
    ).bind(NOW, NOW).run();
    // 100 GB carried for ¥100 is one yuan a gigabyte, i.e. 100 fen.
    await bytesOn('Osaka · Kite', at('2026-09-03T00:00:00Z'), 100_000_000_000);
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'route_direct')!;
    expect(pick.payoff).toEqual({ kind: 'cny', value: 10_000, isEstimate: true });
    // A measured price and a country hint together are worth more than a guess.
    expect(pick.confidence).toBe('medium');
  });

  it('欠的跟进: three days past due, with no payoff to claim', async () => {
    await wipe();
    await followup('fu-1', 'u-04', NOW - 5 * DAY);
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'followup_overdue')!;
    expect(pick.subjectType).toBe('followup');
    expect(pick.subjectId).toBe('fu-1');
    expect(pick.subjectLabel).toBe('u-04');
    expect(pick.metric).toEqual({ kind: 'days', value: 5 });
    expect(pick.payoff).toBeNull();
    expect(pick.confidence).toBe('high');
    expect(pick.action).toEqual({ page: 'today', section: 'followups', subjectId: 'fu-1' });
  });

  it('欠的跟进: two days late is not late enough to spend a line on', async () => {
    await wipe();
    await followup('fu-1', 'u-04', NOW - 2 * DAY);
    expect((await picksOf()).picks.filter((row) => row.kind === 'followup_overdue')).toEqual([]);
  });

  it('月结未关: last month still open on the 10th', async () => {
    await wipe();
    await db.prepare('DELETE FROM ops_month_close').run();
    const week = await picksOf();
    const pick = week.picks.find((row) => row.kind === 'month_unclosed')!;
    expect(pick.subjectId).toBe('2026-08');
    // 2026-08 stopped being able to grow at midnight on the 1st; the read is
    // nine days and four hours later.
    expect(pick.metric).toEqual({ kind: 'days', value: 9 });
    expect(pick.payoff).toBeNull();
    expect(pick.action).toEqual({ page: 'settings', section: 'ledger', subjectId: '2026-08' });
  });

  it('月结未关: the 2nd of the month is too early to call it late', async () => {
    await wipe();
    await db.prepare('DELETE FROM ops_month_close').run();
    const week = await picksOf(at('2026-09-02T04:00:00Z'));
    expect(week.picks.filter((row) => row.kind === 'month_unclosed')).toEqual([]);
  });

  it('月结未关: a closed month is not a chore', async () => {
    await wipe();
    expect((await picksOf()).picks.filter((row) => row.kind === 'month_unclosed')).toEqual([]);
  });
});

describe('挑三件', () => {
  /** Money, then hours, then a chore worth nothing but still owed. */
  async function crowded(): Promise<void> {
    await wipe();
    await usdRate(7);
    // ¥8400 a month, high confidence: the biggest number on the board.
    await node('Tokyo · Fuji', { price: 12, currency: 'USD' });
    // Three openings on one machine: 2 hours × ¥200 × 0.7.
    await incident('i1', 'node', 'Osaka · Kite', NOW - 3 * DAY);
    await incident('i2', 'node', 'Osaka · Kite', NOW - 6 * DAY);
    await incident('i3', 'node', 'Osaka · Kite', NOW - 9 * DAY);
    // 80 flat, and nothing to weigh.
    await db.prepare('DELETE FROM ops_month_close').run();
    // 30 flat — the one that has to lose.
    await followup('fu-1', 'u-04', NOW - 5 * DAY);
  }

  it('never says more than three things, and says the biggest ones', async () => {
    await crowded();
    const week = await picksOf();
    expect(week.picks).toHaveLength(3);
    expect(week.considered).toBe(4);
    // 2 hours × ¥200 × 0.7 = 280, then ¥84 idle, then the flat 80 of an open
    // month. The overdue follow-up's 30 is the one that does not fit.
    expect(week.picks.map((row) => row.kind)).toEqual([
      'repeat_repair', 'idle_node', 'month_unclosed',
    ]);
  });

  it('breaks a tie on whichever runs out sooner', async () => {
    await wipe();
    await usdRate(7);
    // Same price, same confidence, same score: only the renewal date differs.
    await node('Node A', { price: 12, currency: 'USD', renewsAt: NOW + 40 * DAY });
    await node('Node B', { price: 12, currency: 'USD', renewsAt: NOW + 20 * DAY });
    const week = await picksOf();
    const idle = week.picks.filter((row) => row.kind === 'idle_node');
    expect(idle.map((row) => row.subjectId)).toEqual(['Node B', 'Node A']);
  });

  it('spends one line per thing, not one per reason', async () => {
    await wipe();
    await usdRate(7);
    // Idle and up for renewal at once — one machine, one decision, one line.
    await node('Tokyo · Fuji', { price: 12, currency: 'USD', renewsAt: NOW + 3 * DAY });
    await customerOn('u-1', 'Tokyo · Fuji');
    const week = await picksOf();
    expect(week.considered).toBe(2);
    expect(week.picks).toHaveLength(1);
    expect(week.picks[0].kind).toBe('idle_node');
  });

  it('gives a pick the same id on a second read in the same week', async () => {
    await crowded();
    const first = await picksOf();
    const second = await picksOf(NOW + 2 * DAY);
    expect(second.weekOf).toBe(first.weekOf);
    expect(second.picks.map((row) => row.id)).toEqual(first.picks.map((row) => row.id));
    expect(first.picks[0].id).toBe('repeat_repair:node:Osaka · Kite:2026-09-07');
  });

  it('stays inside its statement budget however much there is to look at', async () => {
    await crowded();
    await db.prepare(
      `INSERT INTO node_traffic_cycles(id, node_name, cycle_start, cycle_end, status,
         projected_exhaust_at, updated_at)
       VALUES('c1', 'Osaka · Kite', ?, ?, 'open', ?, ?)`,
    ).bind(NOW - 10 * DAY, NOW + 20 * DAY, NOW + 5 * DAY, NOW).run();
    await db.prepare(
      `INSERT INTO direct_candidates(etld1, first_seen, last_seen, users, bytes_30d,
         connections_30d, country_hint, status)
       VALUES('example.com', ?, ?, 4, 5, 100, 'CN', 'new')`,
    ).bind(NOW - 30 * DAY, NOW - DAY).run();
    expect(await countingRun()).toBeLessThanOrEqual(STATEMENT_CEILING);
  });
});

describe('少了几张表', () => {
  it('answers an empty week instead of throwing', async () => {
    const gone = {
      prepare() {
        throw new Error('D1_ERROR: no such table: ops_node_profiles');
      },
    } as unknown as D1Database;
    const week = await weeklyWorthwhile(gone, NOW);
    expect(assertWorthwhile(week)).toEqual(week);
    expect(week.picks).toEqual([]);
    expect(week.considered).toBe(0);
    expect(week.weekOf).toBe('2026-09-07');
  });
});

/**
 * The block through the route it actually ships on.
 *
 * `weeklyWorthwhile` returning something the checker rejects would not be a
 * quiet mistake: under `OPS_CONTRACT_STRICT` the whole morning read 500s. So
 * the digest is fetched for real, with the tables empty — the state a preview
 * database is in — and the answer is checked rather than trusted.
 */
describe('早报里的三件事', () => {
  const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
  const ACCESS_AUDIENCE = 'test-access-audience-0001';
  const ACCESS_ADMIN_EMAIL = 'operator@example.com';
  const OIDC_KEY_ID = 'test-oidc-key';
  let oidcPrivateKey: CryptoKey;
  let oidcPublicKey: JsonWebKey & { kid: string };

  const base64URL = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function assertion(): Promise<string> {
    const encode = (value: object) => base64URL(new TextEncoder().encode(JSON.stringify(value)));
    const issuedAt = Math.floor(Date.now() / 1_000);
    const header = encode({ alg: 'RS256', typ: 'JWT', kid: OIDC_KEY_ID });
    const payload = encode({
      iss: `https://${ACCESS_TEAM_DOMAIN}`,
      aud: ACCESS_AUDIENCE,
      sub: `access-user-${ACCESS_ADMIN_EMAIL}`,
      email: ACCESS_ADMIN_EMAIL,
      iat: issuedAt,
      exp: issuedAt + 300,
    });
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', oidcPrivateKey, new TextEncoder().encode(`${header}.${payload}`),
    );
    return `${header}.${payload}.${base64URL(new Uint8Array(signature))}`;
  }

  beforeAll(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify'],
    ) as CryptoKeyPair;
    oidcPrivateKey = keyPair.privateKey;
    oidcPublicKey = {
      ...await crypto.subtle.exportKey('jwk', keyPair.publicKey),
      kid: OIDC_KEY_ID, use: 'sig', alg: 'RS256',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url === `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return Response.json({ keys: [oidcPublicKey] }, { headers: { 'cache-control': 'public, max-age=300' } });
      }
      return new Response(null, { status: 404 });
    });
  });

  beforeEach(async () => {
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    (env as unknown as Env).ACCESS_AUD = ACCESS_AUDIENCE;
    (env as unknown as Env).ACCESS_ADMIN_EMAILS = ACCESS_ADMIN_EMAIL;
    (env as unknown as Env & { OPS_CONTRACT_STRICT?: string }).OPS_CONTRACT_STRICT = '1';
    await wipe();
    await db.prepare('DELETE FROM ops_month_close').run();
  });

  it('comes back 200 with a checkable empty week when nothing has been recorded', async () => {
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://test/api/v1/ops/digest', {
        headers: { 'cf-access-jwt-assertion': await assertion() },
      }),
      env as unknown as Env,
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(200);
    const digest = assertDigest(await response.json());
    const week = digest.worthwhile;
    expect(week).toBeDefined();
    // Nothing is recorded except the month nobody has closed, which is exactly
    // the kind of thing the block exists to say out loud.
    expect(week!.picks.map((row) => row.kind)).toEqual(['month_unclosed']);
    expect(week!.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
