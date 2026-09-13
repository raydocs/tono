// 本周三件事候选生成与排序
import type {
  ConfidenceLevel, MetricDto, PayoffDto, WorthwhileActionDto, WorthwhileDto,
  WorthwhileKind, WorthwhilePickDto, WorthwhileSubjectType,
} from './contract';
import { cnyMinorFrom, monthBounds, utcDateString, utcMonthString } from './fx';

const DAY = 86_400;
const SHANGHAI_OFFSET = 8 * 3_600;
const EPOCH_DAY_TO_MONDAY = 3;
const MAX_PICKS = 3;
const GENERATOR_CAP = 50;
const FALLBACK_CNY_PER_GB_MINOR = 30;
const MONTH_CLOSE_DAY = 3;

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

type Row = Record<string, unknown>;

function missingTable(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return msg.includes('no such table') || msg.includes('no such column');
}

async function rows(db: D1Database, sql: string, binds: unknown[] = []): Promise<Row[]> {
  try {
    return (await db.prepare(sql).bind(...binds).all<Row>()).results ?? [];
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

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

export function shanghaiWeekOf(nowSec: number): string {
  const dayIndex = Math.floor((nowSec + SHANGHAI_OFFSET) / DAY);
  const sinceMonday = ((dayIndex + EPOCH_DAY_TO_MONDAY) % 7 + 7) % 7;
  return new Date((dayIndex - sinceMonday) * DAY * 1000).toISOString().slice(0, 10);
}

function shanghaiDay(nowSec: number): string {
  return new Date((nowSec + SHANGHAI_OFFSET) * 1000).toISOString().slice(0, 10);
}

function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  if (index > 1) return `${year}-${String(index - 1).padStart(2, '0')}`;
  return `${year - 1}-12`;
}

function priceToCny(rawPrice: unknown, rawCurrency: unknown, rates: Map<string, number>) {
  const currency = rawCurrency == null ? 'CNY' : String(rawCurrency).toUpperCase();
  const priceMinor = Math.round(num(rawPrice) * 100);
  const known = currency === 'CNY' || currency === 'USD';
  const rate = rates.get(currency) ?? null;
  const exact = known && rate !== null;
  const cnyMinor = exact ? cnyMinorFrom(priceMinor, rate as number) : priceMinor;
  return { cnyMinor, exact };
}

export async function newestRates(db: D1Database, nowSec: number): Promise<Map<string, number>> {
  const day = utcDateString(nowSec);
  const found = await rows(
    db,
    `SELECT r.base, r.rate FROM ops_fx_rates r WHERE r.quote = 'CNY' AND r.day <= ?
     AND r.day = (SELECT MAX(r2.day) FROM ops_fx_rates r2 WHERE r2.base = r.base AND r2.quote = 'CNY' AND r2.day <= ?)`,
    [day, day],
  );
  const out = new Map<string, number>([['CNY', 1]]);
  for (const row of found) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate) && rate > 0) out.set(String(row.base).toUpperCase(), rate);
  }
  return out;
}

export async function cnyPerGbMinor(db: D1Database, nowSec: number): Promise<number | null> {
  const month = utcMonthString(nowSec);
  const { start, end } = monthBounds(month);
  const found = await rows(
    db,
    `SELECT e.subject_id AS node, SUM(e.cny_minor) AS cost,
            (SELECT COALESCE(SUM(a.bytes_up + a.bytes_down), 0) FROM customer_activity_hours a
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
    if (bytes > 0 && cost > 0) perGb.push(cost / (bytes / 1e9));
  }
  if (perGb.length === 0) return null;
  perGb.sort((a, b) => a - b);
  const mid = Math.floor(perGb.length / 2);
  return Math.round(perGb.length % 2 === 1 ? perGb[mid] : (perGb[mid - 1] + perGb[mid]) / 2);
}

// 1. 在售、7 天占用为 0、ops_node_profiles.price 非空 → 收益 = 月价
export async function idleNodes(db: D1Database, nowSec: number, rates: Map<string, number>): Promise<Candidate[]> {
  try {
    const found = await rows(
      db,
      `SELECT p.catalog_name AS name, p.price, p.currency, p.renews_at, p.updated_at
       FROM ops_node_profiles p
       WHERE p.status = 'active' AND p.price IS NOT NULL
         AND (SELECT COUNT(*) FROM ops_customer_status s WHERE s.selected_server = p.catalog_name AND s.connected = 1) = 0
         AND (SELECT COALESCE(SUM(a.connected_minutes), 0) + COALESCE(SUM(a.bytes_up + a.bytes_down), 0)
              FROM customer_activity_hours a WHERE a.node = p.catalog_name AND a.hour_at >= ?) = 0
       ORDER BY p.price DESC, p.catalog_name ASC LIMIT ?`,
      [nowSec - 7 * DAY, GENERATOR_CAP],
    );
    return found.map((row) => {
      const name = String(row.name);
      const { cnyMinor, exact } = priceToCny(row.price, row.currency, rates);
      return {
        kind: 'idle_node', subjectType: 'node', subjectId: name, subjectLabel: name,
        metric: { kind: 'cnyMinor', value: cnyMinor },
        payoff: { kind: 'cny', value: cnyMinor, isEstimate: !exact },
        confidence: exact ? 'high' : 'low',
        deadlineSec: optNum(row.renews_at), evidenceAsOfSec: optNum(row.updated_at),
        action: { page: 'nodes', section: null, subjectId: name },
      };
    });
  } catch {
    return [];
  }
}

// 2. node_traffic_cycles 预计耗尽日 ≤ 7 天 → 收益 = 受影响客户数
export async function quotaExhausting(db: D1Database, nowSec: number): Promise<Candidate[]> {
  try {
    const found = await rows(
      db,
      `SELECT c.node_name AS name, c.projected_exhaust_at AS at, c.updated_at,
              (SELECT COUNT(*) FROM ops_customer_status s WHERE s.selected_server = c.node_name) AS customers
       FROM node_traffic_cycles c
       WHERE c.status = 'open' AND c.projected_exhaust_at IS NOT NULL
         AND c.projected_exhaust_at >= ? AND c.projected_exhaust_at <= ?
       ORDER BY c.projected_exhaust_at ASC, c.node_name ASC LIMIT ?`,
      [nowSec, nowSec + 7 * DAY, GENERATOR_CAP],
    );
    return found.map((row) => {
      const name = String(row.name);
      const at = num(row.at);
      return {
        kind: 'quota_exhausting', subjectType: 'node', subjectId: name, subjectLabel: name,
        metric: { kind: 'days', value: daysBetween(nowSec, at) },
        payoff: { kind: 'customers', value: num(row.customers), isEstimate: true },
        confidence: 'medium', deadlineSec: optNum(row.at), evidenceAsOfSec: optNum(row.updated_at),
        action: { page: 'nodes', section: null, subjectId: name },
      };
    });
  } catch {
    return [];
  }
}

// 3. 7 天内续费且 30 天占用/流量为 0 → 收益 = 月价
export async function nodeRenewals(db: D1Database, nowSec: number, rates: Map<string, number>): Promise<Candidate[]> {
  try {
    const until = nowSec + 7 * DAY;
    const found = await rows(
      db,
      `SELECT p.catalog_name AS name, p.price, p.currency, p.renews_at, p.expires_at, p.updated_at
       FROM ops_node_profiles p
       WHERE p.status = 'active' AND p.price IS NOT NULL
         AND ((p.renews_at IS NOT NULL AND p.renews_at >= ? AND p.renews_at <= ?)
           OR (p.expires_at IS NOT NULL AND p.expires_at >= ? AND p.expires_at <= ?))
         AND (SELECT COUNT(*) FROM ops_customer_status s WHERE s.selected_server = p.catalog_name AND s.connected = 1) = 0
         AND (SELECT COALESCE(SUM(a.connected_minutes), 0) + COALESCE(SUM(a.bytes_up + a.bytes_down), 0)
              FROM customer_activity_hours a WHERE a.node = p.catalog_name AND a.hour_at >= ?) = 0
       ORDER BY p.renews_at ASC, p.catalog_name ASC LIMIT ?`,
      [nowSec, until, nowSec, until, nowSec - 30 * DAY, GENERATOR_CAP],
    );
    return found.map((row) => {
      const name = String(row.name);
      const { cnyMinor, exact } = priceToCny(row.price, row.currency, rates);
      const dates = [optNum(row.renews_at), optNum(row.expires_at)]
        .filter((v): v is number => v !== null && v >= nowSec && v <= until);
      const deadline = dates.length === 0 ? null : Math.min(...dates);
      return {
        kind: 'node_renewal', subjectType: 'node', subjectId: name, subjectLabel: name,
        metric: { kind: 'days', value: deadline === null ? 0 : daysBetween(nowSec, deadline) },
        payoff: { kind: 'cny', value: cnyMinor, isEstimate: !exact },
        confidence: exact ? 'high' : 'medium', deadlineSec: deadline, evidenceAsOfSec: optNum(row.updated_at),
        action: { page: 'nodes', section: null, subjectId: name },
      };
    });
  } catch {
    return [];
  }
}

export async function lineRenewals(db: D1Database, nowSec: number, rates: Map<string, number>): Promise<Candidate[]> {
  try {
    const until = nowSec + 7 * DAY;
    const found = await rows(
      db,
      `SELECT h.id, h.display_name AS name, h.price, h.currency, h.expires_at, h.updated_at
       FROM home_exits h
       WHERE h.status <> 'retired' AND h.price IS NOT NULL
         AND h.expires_at IS NOT NULL AND h.expires_at >= ? AND h.expires_at <= ?
         AND (SELECT COUNT(*) FROM user_home_bindings b WHERE b.home_exit_id = h.id) = 0
         AND (SELECT COALESCE(SUM(u.bytes_up + u.bytes_down), 0)
              FROM home_line_usage_daily u WHERE u.home_exit_id = h.id AND u.day_at >= ?) = 0
       ORDER BY h.expires_at ASC, h.id ASC LIMIT ?`,
      [nowSec, until, nowSec - 30 * DAY, GENERATOR_CAP],
    );
    return found.map((row) => {
      const id = String(row.id);
      const { cnyMinor, exact } = priceToCny(row.price, row.currency, rates);
      const expiresAt = num(row.expires_at);
      return {
        kind: 'line_renewal', subjectType: 'home_exit', subjectId: id, subjectLabel: String(row.name ?? id),
        metric: { kind: 'days', value: daysBetween(nowSec, expiresAt) },
        payoff: { kind: 'cny', value: cnyMinor, isEstimate: !exact },
        confidence: 'high', deadlineSec: optNum(row.expires_at), evidenceAsOfSec: optNum(row.updated_at),
        action: { page: 'settings', section: 'home-exits', subjectId: id },
      };
    });
  } catch {
    return [];
  }
}

// 4. 同一客户 7 天内 ≥2 条 customer-repeat-fail 事故 → 收益 = 小时（估 1 小时/次）
export async function repeatRepairs(db: D1Database, nowSec: number): Promise<Candidate[]> {
  try {
    const found = await rows(
      db,
      `SELECT i.subject_id AS user_id, COUNT(*) AS incidents, MAX(i.opened_at) AS last_at
       FROM ops_incidents i
       WHERE i.kind = 'customer-repeat-fail' AND i.subject_type = 'user' AND i.opened_at >= ?
         AND (i.closure IS NULL OR i.closure <> 'false_positive') AND i.subject_id IS NOT NULL AND i.subject_id <> ''
       GROUP BY i.subject_id HAVING COUNT(*) >= 2
       ORDER BY COUNT(*) DESC, i.subject_id ASC LIMIT ?`,
      [nowSec - 7 * DAY, GENERATOR_CAP],
    );
    return found.map((row) => {
      const userId = String(row.user_id);
      const count = num(row.incidents);
      return {
        kind: 'repeat_repair', subjectType: 'user', subjectId: userId, subjectLabel: userId,
        metric: { kind: 'incidents', value: count },
        payoff: { kind: 'hours', value: Math.ceil(count * 1), isEstimate: true },
        confidence: 'medium', deadlineSec: null, evidenceAsOfSec: optNum(row.last_at),
        action: { page: 'customers', section: null, subjectId: userId },
      };
    });
  } catch {
    return [];
  }
}

// 5. direct_candidates 里 status='new' 且 bytes_30d 最大 → 收益 = 字节换算成本（用该月每 GB 成本，估算）
export async function routeDirect(db: D1Database, perGbMeasured: number | null): Promise<Candidate[]> {
  try {
    const found = await rows(
      db,
      `SELECT d.etld1, d.bytes_30d AS bytes, d.country_hint, d.last_seen
       FROM direct_candidates d WHERE d.status = 'new' AND d.bytes_30d > 0
       ORDER BY d.bytes_30d DESC, d.etld1 ASC LIMIT 1`,
    );
    const perGb = perGbMeasured ?? FALLBACK_CNY_PER_GB_MINOR;
    return found.map((row) => {
      const etld1 = String(row.etld1);
      const bytes = num(row.bytes);
      const hinted = row.country_hint != null && String(row.country_hint) !== '';
      return {
        kind: 'route_direct', subjectType: 'etld1', subjectId: etld1, subjectLabel: etld1,
        metric: { kind: 'bytes', value: bytes },
        payoff: { kind: 'cny', value: Math.round((bytes / 1e9) * perGb), isEstimate: true },
        confidence: perGbMeasured !== null && hinted ? 'medium' : 'low',
        deadlineSec: null, evidenceAsOfSec: optNum(row.last_seen),
        action: { page: 'settings', section: 'candidates', subjectId: etld1 },
      };
    });
  } catch {
    return [];
  }
}

// 6. ops_followups.due_at < now → 收益 = 客户数
export async function overdueFollowups(db: D1Database, nowSec: number): Promise<Candidate[]> {
  try {
    const found = await rows(
      db,
      `SELECT f.id, f.subject_id, f.due_at, f.updated_at
       FROM ops_followups f
       WHERE f.done_at IS NULL AND f.due_at IS NOT NULL AND f.due_at < ?
       ORDER BY f.due_at ASC, f.id ASC LIMIT ?`,
      [nowSec, GENERATOR_CAP],
    );
    return found.map((row) => ({
      kind: 'followup_overdue', subjectType: 'followup', subjectId: String(row.id),
      subjectLabel: String(row.subject_id ?? ''),
      metric: { kind: 'days', value: Math.max(0, Math.floor((nowSec - num(row.due_at)) / DAY)) },
      payoff: { kind: 'customers', value: 1, isEstimate: false },
      confidence: 'high', deadlineSec: optNum(row.due_at), evidenceAsOfSec: optNum(row.updated_at),
      action: { page: 'today', section: 'followups', subjectId: String(row.id) },
    }));
  } catch {
    return [];
  }
}

// 7. 上月未关账且已过 3 号 → 收益 = 0 小时（confidence high）
export async function unclosedMonth(
  db: D1Database, nowSec: number, prevMonth: string, prevMonthEndSec: number,
): Promise<Candidate[]> {
  try {
    const closed = await db.prepare('SELECT c.month FROM ops_month_close c WHERE c.month = ?')
      .bind(prevMonth).first<Row>();
    if (closed) return [];
    return [{
      kind: 'month_unclosed', subjectType: 'month', subjectId: prevMonth, subjectLabel: prevMonth,
      metric: { kind: 'days', value: Math.max(0, Math.floor((nowSec - prevMonthEndSec) / DAY)) },
      payoff: { kind: 'hours', value: 0, isEstimate: false },
      confidence: 'high', deadlineSec: null, evidenceAsOfSec: null,
      action: { page: 'settings', section: 'ledger', subjectId: prevMonth },
    }];
  } catch {
    return [];
  }
}

// 排序：收益折算（cny 分 ÷ 100 ÷ 10 = 小时；customers × 2 = 小时）降序取 3
function toEquivalentHours(payoff: PayoffDto | null): number {
  if (payoff === null) return 0;
  if (payoff.kind === 'cny') return (payoff.value / 100) / 10;
  if (payoff.kind === 'customers') return payoff.value * 2;
  return payoff.value;
}

function compareCandidates(a: Candidate & { id: string }, b: Candidate & { id: string }): number {
  const scoreA = toEquivalentHours(a.payoff);
  const scoreB = toEquivalentHours(b.payoff);
  if (scoreB !== scoreA) return scoreB - scoreA;
  const deadlineA = a.deadlineSec ?? Number.MAX_SAFE_INTEGER;
  const deadlineB = b.deadlineSec ?? Number.MAX_SAFE_INTEGER;
  if (deadlineA !== deadlineB) return deadlineA - deadlineB;
  return a.id.localeCompare(b.id);
}

function pickBest(candidates: Candidate[], weekOf: string): WorthwhilePickDto[] {
  const withIds = candidates.map((candidate) => ({
    ...candidate,
    id: `${candidate.kind}:${candidate.subjectType}:${candidate.subjectId}:${weekOf}`,
  }));
  withIds.sort(compareCandidates);
  const seen = new Set<string>();
  const picks: WorthwhilePickDto[] = [];
  for (const candidate of withIds) {
    const subject = `${candidate.subjectType}:${candidate.subjectId}`;
    if (seen.has(subject)) continue;
    seen.add(subject);
    picks.push(candidate);
    if (picks.length === MAX_PICKS) break;
  }
  return picks;
}

export function emptyWorthwhile(nowSec: number): WorthwhileDto {
  return {
    weekOf: shanghaiWeekOf(nowSec),
    computedAt: nowSec,
    picks: [],
    considered: 0,
  };
}

export async function weeklyPicks(
  dbOrEnv: { DB: D1Database } | D1Database,
  nowSec: number,
): Promise<WorthwhileDto> {
  const db = 'DB' in dbOrEnv ? dbOrEnv.DB : dbOrEnv;
  const weekOf = shanghaiWeekOf(nowSec);
  const day = shanghaiDay(nowSec);
  const dayOfMonth = Number(day.slice(8, 10));
  const month = day.slice(0, 7);

  const rates = await newestRates(db, nowSec);
  const perGb = await cnyPerGbMinor(db, nowSec);

  const prevMonth = previousMonth(month);
  const prevMonthEndSec = monthBounds(month).start;

  const results = await Promise.all([
    idleNodes(db, nowSec, rates),
    quotaExhausting(db, nowSec),
    nodeRenewals(db, nowSec, rates),
    lineRenewals(db, nowSec, rates),
    repeatRepairs(db, nowSec),
    routeDirect(db, perGb),
    overdueFollowups(db, nowSec),
    dayOfMonth > MONTH_CLOSE_DAY
      ? unclosedMonth(db, nowSec, prevMonth, prevMonthEndSec)
      : Promise.resolve([] as Candidate[]),
  ]);

  const candidates = results.flat();
  return {
    weekOf,
    computedAt: nowSec,
    picks: pickBest(candidates, weekOf),
    considered: candidates.length,
  };
}
