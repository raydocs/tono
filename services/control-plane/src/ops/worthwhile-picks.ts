// 三件事的候选：八个产生器，每个一条 SQL。
//
// Every generator here is one set-based statement and a `map` over its rows.
// No per-item loop reaches back into the database: the whole point of the
// block is that it costs the digest a fixed, countable number of statements
// (see `STATEMENT_CEILING` in `worthwhile.ts`), not one per node.
//
// A missing table is not an error here. The digest ships ahead of some of
// these migrations on a preview database, and a morning read that 500s because
// `direct_candidates` does not exist yet is worse than a morning read with
// seven generators instead of eight. Each generator swallows exactly that and
// yields nothing.

import type { Row } from '../env';
import type {
  ConfidenceLevel,
  MetricDto,
  PayoffDto,
  WorthwhileActionDto,
  WorthwhileKind,
  WorthwhileSubjectType,
} from './contract';
import { cnyMinorFrom, monthBounds, utcDateString, utcMonthString } from './fx';

/**
 * A pick before it is scored, sorted and cut. `score` is not here: it is the
 * picking module's opinion about the candidate, not a fact the generator knows.
 */
export type Candidate = {
  kind: WorthwhileKind;
  subjectType: WorthwhileSubjectType;
  subjectId: string;
  subjectLabel: string;
  metric: MetricDto | null;
  payoff: PayoffDto | null;
  confidence: ConfidenceLevel;
  deadlineSec: number | null;
  evidenceAsOfSec: number | null;
  action: WorthwhileActionDto;
};

export const DAY = 86_400;
/** No generator may flood the sort; three are taken from all of them together. */
export const GENERATOR_CAP = 50;
/** Renewal and expiry are worth saying a fortnight out, and not before. */
export const RENEWAL_WINDOW = 14 * DAY;

function missingTable(error: unknown): boolean {
  const text = String(error);
  return text.includes('no such table') || text.includes('no such column');
}

async function rows(db: D1Database, sql: string, binds: unknown[]): Promise<Row[]> {
  try {
    return (await db.prepare(sql).bind(...binds).all<Row>()).results ?? [];
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

/** Whole days from `from` to `to`, rounded up, never negative. */
function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.ceil((to - from) / DAY));
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------ 汇率 */

/**
 * The newest stored rate for every base, at or before `day`.
 *
 * `fx.lookupRate` answers this for one base and costs one statement each time;
 * a fleet paid for in three currencies would then cost three, and the whole
 * call has ten to spend. This asks the same question — newest row not after
 * the day — for every base at once, so the cost is one statement whatever the
 * fleet is billed in. CNY is not stored and does not need to be: it is 1.
 */
export async function newestRates(db: D1Database, nowSec: number): Promise<Map<string, number>> {
  const day = utcDateString(nowSec);
  const found = await rows(
    db,
    `SELECT r.base AS base, r.rate AS rate
     FROM ops_fx_rates r
     WHERE r.quote = 'CNY' AND r.day <= ?
       AND r.day = (
         SELECT MAX(r2.day) FROM ops_fx_rates r2
         WHERE r2.base = r.base AND r2.quote = 'CNY' AND r2.day <= ?
       )`,
    [day, day],
  );
  const out = new Map<string, number>([['CNY', 1]]);
  for (const row of found) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate) && rate > 0) out.set(String(row.base).toUpperCase(), rate);
  }
  return out;
}

/* ------------------------------------------------------------- 闲置机器 */

/**
 * A machine that is paid for and carried nobody this month.
 *
 * The month is the calendar month the read falls in, and "carried nobody" is
 * zero bytes in `customer_activity_hours` — a node with a profile price and no
 * traffic is money leaving every month for nothing.
 */
export async function idleNodes(
  db: D1Database,
  nowSec: number,
  rates: Map<string, number>,
): Promise<Candidate[]> {
  const { start, end } = monthBounds(utcMonthString(nowSec));
  const found = await rows(
    db,
    `SELECT p.catalog_name AS name, p.price AS price, p.currency AS currency,
            p.renews_at AS renews_at, p.updated_at AS updated_at,
            COALESCE(SUM(a.bytes_up + a.bytes_down), 0) AS bytes
     FROM ops_node_profiles p
     LEFT JOIN customer_activity_hours a
       ON a.node = p.catalog_name AND a.hour_at >= ? AND a.hour_at < ?
     WHERE p.status = 'active' AND p.price IS NOT NULL
     GROUP BY p.catalog_name
     HAVING COALESCE(SUM(a.bytes_up + a.bytes_down), 0) = 0
     ORDER BY p.price DESC, p.catalog_name ASC
     LIMIT ?`,
    [start, end, GENERATOR_CAP],
  );
  return found.map((row) => {
    const name = String(row.name);
    const currency = row.currency == null ? 'CNY' : String(row.currency).toUpperCase();
    const priceMinor = Math.round(num(row.price) * 100);
    const known = currency === 'CNY' || currency === 'USD';
    const rate = rates.get(currency) ?? null;
    const exact = known && rate !== null;
    const cnyMinor = exact ? cnyMinorFrom(priceMinor, rate as number) : priceMinor;
    return {
      kind: 'idle_node',
      subjectType: 'node',
      subjectId: name,
      subjectLabel: name,
      metric: { kind: 'cnyMinor', value: cnyMinor },
      payoff: { kind: 'cny', value: cnyMinor, isEstimate: !exact },
      confidence: exact ? 'high' : 'low',
      deadlineSec: optNum(row.renews_at),
      evidenceAsOfSec: optNum(row.updated_at),
      action: { page: 'nodes', section: null, subjectId: name },
    } satisfies Candidate;
  });
}

/* ------------------------------------------------------------- 流量将尽 */

/** An open cycle whose projection runs out before the cycle does. */
export async function quotaExhausting(db: D1Database, nowSec: number): Promise<Candidate[]> {
  const found = await rows(
    db,
    `SELECT c.node_name AS name, c.projected_exhaust_at AS at, c.updated_at AS updated_at,
            (SELECT COUNT(*) FROM ops_customer_status s WHERE s.selected_server = c.node_name)
              AS customers
     FROM node_traffic_cycles c
     WHERE c.status = 'open'
       AND c.projected_exhaust_at IS NOT NULL
       AND c.projected_exhaust_at < c.cycle_end
     ORDER BY c.projected_exhaust_at ASC, c.node_name ASC
     LIMIT ?`,
    [GENERATOR_CAP],
  );
  return found.map((row) => {
    const name = String(row.name);
    const at = num(row.at);
    return {
      kind: 'quota_exhausting',
      subjectType: 'node',
      subjectId: name,
      subjectLabel: name,
      metric: { kind: 'days', value: daysBetween(nowSec, at) },
      // The projection is a straight line through seven days of samples, so
      // the customers behind it are who would be moved, not who will be.
      payoff: { kind: 'customers', value: num(row.customers), isEstimate: true },
      confidence: 'medium',
      deadlineSec: optNum(row.at),
      evidenceAsOfSec: optNum(row.updated_at),
      action: { page: 'nodes', section: null, subjectId: name },
    } satisfies Candidate;
  });
}

/* --------------------------------------------------------------- 快到期 */

/** An active machine whose renewal or expiry falls inside the fortnight. */
export async function nodeRenewals(db: D1Database, nowSec: number): Promise<Candidate[]> {
  const until = nowSec + RENEWAL_WINDOW;
  const found = await rows(
    db,
    `SELECT p.catalog_name AS name, p.renews_at AS renews_at, p.expires_at AS expires_at,
            p.updated_at AS updated_at,
            (SELECT COUNT(*) FROM ops_customer_status s WHERE s.selected_server = p.catalog_name)
              AS customers
     FROM ops_node_profiles p
     WHERE p.status = 'active'
       AND ((p.renews_at IS NOT NULL AND p.renews_at >= ? AND p.renews_at <= ?)
         OR (p.expires_at IS NOT NULL AND p.expires_at >= ? AND p.expires_at <= ?))
     ORDER BY p.catalog_name ASC
     LIMIT ?`,
    [nowSec, until, nowSec, until, GENERATOR_CAP],
  );
  return found.map((row) => {
    const name = String(row.name);
    const dates = [optNum(row.renews_at), optNum(row.expires_at)]
      .filter((value): value is number => value !== null && value >= nowSec && value <= until);
    const deadline = dates.length === 0 ? null : Math.min(...dates);
    return {
      kind: 'node_renewal',
      subjectType: 'node',
      subjectId: name,
      subjectLabel: name,
      metric: { kind: 'days', value: deadline === null ? 0 : daysBetween(nowSec, deadline) },
      payoff: { kind: 'customers', value: num(row.customers), isEstimate: true },
      confidence: 'high',
      deadlineSec: deadline,
      evidenceAsOfSec: optNum(row.updated_at),
      action: { page: 'nodes', section: null, subjectId: name },
    } satisfies Candidate;
  });
}

/** A residential line still in service whose contract runs out inside the fortnight. */
export async function lineRenewals(db: D1Database, nowSec: number): Promise<Candidate[]> {
  const found = await rows(
    db,
    `SELECT h.id AS id, h.display_name AS name, h.expires_at AS expires_at,
            h.updated_at AS updated_at,
            (SELECT COUNT(*) FROM user_home_bindings b WHERE b.home_exit_id = h.id) AS customers
     FROM home_exits h
     WHERE h.status <> 'retired'
       AND h.expires_at IS NOT NULL AND h.expires_at >= ? AND h.expires_at <= ?
     ORDER BY h.expires_at ASC, h.id ASC
     LIMIT ?`,
    [nowSec, nowSec + RENEWAL_WINDOW, GENERATOR_CAP],
  );
  return found.map((row) => ({
    kind: 'line_renewal',
    subjectType: 'home_exit',
    subjectId: String(row.id),
    subjectLabel: String(row.name ?? row.id),
    metric: { kind: 'days', value: daysBetween(nowSec, num(row.expires_at)) },
    payoff: { kind: 'customers', value: num(row.customers), isEstimate: true },
    confidence: 'high',
    deadlineSec: optNum(row.expires_at),
    evidenceAsOfSec: optNum(row.updated_at),
    action: { page: 'settings', section: 'homelines', subjectId: String(row.id) },
  } satisfies Candidate));
}

/* --------------------------------------------------------------- 反复修 */

export const REPEAT_WINDOW = 30 * DAY;
export const REPEAT_THRESHOLD = 3;
/** Half an hour per opening, 估算: the read, the check and the message back. */
export const HOURS_PER_INCIDENT = 0.5;

/**
 * Something that has broken three times in a month.
 *
 * False alarms are excluded because a rule firing on noise is a fault in the
 * rule, not in the machine, and child incidents are excluded because a node
 * outage that opened twenty customer incidents under it is one thing that
 * broke, not twenty-one.
 */
export async function repeatRepairs(db: D1Database, nowSec: number): Promise<Candidate[]> {
  const found = await rows(
    db,
    `SELECT i.subject_type AS subject_type, i.subject_id AS subject_id,
            COUNT(*) AS incidents, MAX(i.opened_at) AS last_at
     FROM ops_incidents i
     WHERE i.opened_at >= ?
       AND i.parent_incident_id IS NULL
       AND (i.closure IS NULL OR i.closure <> 'false_positive')
       AND i.subject_type IN ('node', 'user')
       AND i.subject_id <> ''
     GROUP BY i.subject_type, i.subject_id
     HAVING COUNT(*) >= ?
     ORDER BY COUNT(*) DESC, i.subject_id ASC
     LIMIT ?`,
    [nowSec - REPEAT_WINDOW, REPEAT_THRESHOLD, GENERATOR_CAP],
  );
  return found.map((row) => {
    const subjectType = String(row.subject_type) === 'user' ? 'user' : 'node';
    const subjectId = String(row.subject_id);
    const count = num(row.incidents);
    return {
      kind: 'repeat_repair',
      subjectType,
      subjectId,
      subjectLabel: subjectId,
      metric: { kind: 'incidents', value: count },
      payoff: { kind: 'hours', value: Math.ceil(count * HOURS_PER_INCIDENT), isEstimate: true },
      confidence: 'medium',
      deadlineSec: null,
      evidenceAsOfSec: optNum(row.last_at),
      action: subjectType === 'user'
        ? { page: 'customers', section: null, subjectId }
        : { page: 'nodes', section: null, subjectId },
    } satisfies Candidate;
  });
}

/* ------------------------------------------------------------- 直连候选 */

const GB = 1e9;
/**
 * What a gigabyte through the fleet costs when the month cannot say.
 *
 * 估算: three mao a gigabyte, the order of magnitude a small VPS fleet lands
 * on once the monthly bill is spread over the traffic it carried. It is only
 * ever used when this month has no closed server cost or no measured bytes to
 * divide it by, and every payoff computed from it says 估算 out loud.
 */
export const FALLBACK_CNY_PER_GB_MINOR = 30;

/**
 * The median yuan-per-gigabyte across the machines this month, in fen.
 *
 * One statement: server costs grouped by node, with the month's bytes for that
 * node read back in a correlated subquery. Nodes with cost but no measured
 * bytes are left out rather than counted as infinitely expensive, and the
 * median rather than the mean because one machine bought and never used would
 * otherwise set the price of the whole fleet.
 */
export async function cnyPerGbMinor(db: D1Database, nowSec: number): Promise<number | null> {
  const month = utcMonthString(nowSec);
  const { start, end } = monthBounds(month);
  const found = await rows(
    db,
    `SELECT e.subject_id AS node, SUM(e.cny_minor) AS cost,
            (SELECT COALESCE(SUM(a.bytes_up + a.bytes_down), 0)
             FROM customer_activity_hours a
             WHERE a.node = e.subject_id AND a.hour_at >= ? AND a.hour_at < ?) AS bytes
     FROM ops_ledger_entries e
     WHERE e.kind = 'cost' AND e.category = 'server' AND e.subject_type = 'node'
       AND e.subject_id IS NOT NULL AND e.subject_id <> '' AND e.month = ?
     GROUP BY e.subject_id`,
    [start, end, month],
  );
  const perGb: number[] = [];
  for (const row of found) {
    const bytes = num(row.bytes);
    const cost = num(row.cost);
    if (bytes <= 0 || cost <= 0) continue;
    perGb.push(cost / (bytes / GB));
  }
  if (perGb.length === 0) return null;
  perGb.sort((a, b) => a - b);
  const middle = Math.floor(perGb.length / 2);
  const median = perGb.length % 2 === 1
    ? perGb[middle]
    : (perGb[middle - 1] + perGb[middle]) / 2;
  return Math.round(median);
}

/** An undecided destination big enough that routing it direct is worth the click. */
export async function routeDirect(
  db: D1Database,
  measured: number | null,
): Promise<Candidate[]> {
  const found = await rows(
    db,
    `SELECT d.etld1 AS etld1, d.bytes_30d AS bytes, d.country_hint AS country_hint,
            d.last_seen AS last_seen
     FROM direct_candidates d
     WHERE d.status = 'new' AND d.bytes_30d > 0
     ORDER BY d.bytes_30d DESC, d.etld1 ASC
     LIMIT ?`,
    [GENERATOR_CAP],
  );
  const perGb = measured ?? FALLBACK_CNY_PER_GB_MINOR;
  return found.map((row) => {
    const etld1 = String(row.etld1);
    const bytes = num(row.bytes);
    const hinted = row.country_hint != null && String(row.country_hint) !== '';
    return {
      kind: 'route_direct',
      subjectType: 'etld1',
      subjectId: etld1,
      subjectLabel: etld1,
      metric: { kind: 'bytes', value: bytes },
      // Always 估算: the bytes are last month's and the saving is next
      // month's, whichever price they are multiplied by.
      payoff: { kind: 'cny', value: Math.round((bytes / GB) * perGb), isEstimate: true },
      confidence: measured !== null && hinted ? 'medium' : 'low',
      deadlineSec: null,
      evidenceAsOfSec: optNum(row.last_seen),
      action: { page: 'settings', section: 'candidates', subjectId: etld1 },
    } satisfies Candidate;
  });
}

/* --------------------------------------------------------------- 欠的账 */

export const OVERDUE_GRACE = 3 * DAY;

/** A follow-up somebody promised three days ago and has not come back to. */
export async function overdueFollowups(db: D1Database, nowSec: number): Promise<Candidate[]> {
  const found = await rows(
    db,
    `SELECT f.id AS id, f.subject_id AS subject_id, f.due_at AS due_at,
            f.updated_at AS updated_at
     FROM ops_followups f
     WHERE f.done_at IS NULL AND f.due_at IS NOT NULL AND f.due_at < ?
     ORDER BY f.due_at ASC, f.id ASC
     LIMIT ?`,
    [nowSec - OVERDUE_GRACE, GENERATOR_CAP],
  );
  return found.map((row) => ({
    kind: 'followup_overdue',
    subjectType: 'followup',
    subjectId: String(row.id),
    // The console renders the person or the machine this was about; the
    // follow-up's own id would say nothing to anybody reading the line.
    subjectLabel: String(row.subject_id ?? ''),
    metric: { kind: 'days', value: Math.floor((nowSec - num(row.due_at)) / DAY) },
    payoff: null,
    confidence: 'high',
    deadlineSec: optNum(row.due_at),
    evidenceAsOfSec: optNum(row.updated_at),
    action: { page: 'today', section: 'followups', subjectId: String(row.id) },
  } satisfies Candidate));
}

/** The 5th of the month, Shanghai: after that, last month being open is a chore. */
export const MONTH_CLOSE_DAY = 5;

/**
 * Last month, still open, once the month is old enough that it should not be.
 *
 * `monthEnd` is the start of the current month, which is the moment the
 * previous one stopped being able to grow.
 */
export async function unclosedMonth(
  db: D1Database,
  nowSec: number,
  previousMonth: string,
  monthEndSec: number,
): Promise<Candidate[]> {
  // Read directly rather than through `rows`: this is the one generator whose
  // answer is "no row was found", and a missing table returns no rows too. A
  // table that is not there yet must not be reported as an unclosed month.
  try {
    const closed = await db.prepare(
      'SELECT c.month AS month FROM ops_month_close c WHERE c.month = ?',
    ).bind(previousMonth).first<Row>();
    if (closed) return [];
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return [{
    kind: 'month_unclosed',
    subjectType: 'month',
    subjectId: previousMonth,
    subjectLabel: previousMonth,
    metric: { kind: 'days', value: Math.max(0, Math.floor((nowSec - monthEndSec) / DAY)) },
    payoff: null,
    confidence: 'high',
    deadlineSec: null,
    evidenceAsOfSec: null,
    action: { page: 'settings', section: 'ledger', subjectId: previousMonth },
  }];
}
