// Traffic-quota cycles on cumulative interface counters. Production callers
// inject them; the rollup columns are net_in_last / net_out_last (300s, 3600s).

type Row = Record<string, any>;

const DAY = 86400;
const ROLLING_PERIOD = 30 * DAY;
const SLOPE_WINDOW = 7 * DAY;
const SAMPLE_RETENTION = 60 * DAY;
const NAME_LIMIT = 120;

export type CycleKind = 'calendar_day' | 'anniversary' | 'rolling_30d' | 'manual';
export type QuotaCounts = 'in' | 'out' | 'in_out';
export type QuotaLevel = 'ok' | 'chore' | 'warn' | 'severe';
export type ErrorCategory = 'dial_timeout' | 'handshake_fail' | 'auth_reject' | 'upstream_reject' | 'other';

export type CycleBounds = { start: number; end: number };
export type NetCounters = { in: number; out: number; at: number };
export type UsedSample = { at: number; used: number };

export type QuotaProfile = {
  traffic_quota_bytes?: number | null;
  trafficQuotaBytes?: number | null;
  quota_counts?: QuotaCounts | string | null;
  quotaCounts?: QuotaCounts | string | null;
  cycle_kind?: CycleKind | string | null;
  cycleKind?: CycleKind | string | null;
  cycle_anchor_day?: number | null;
  cycleAnchorDay?: number | null;
  traffic_cycle_start?: number | null;
  trafficCycleStart?: number | null;
  traffic_cycle_end?: number | null;
  trafficCycleEnd?: number | null;
  auto_unlist_at_pct?: number | null;
  autoUnlistAtPct?: number | null;
};

const ERROR_CATEGORIES: ErrorCategory[] = [
  'dial_timeout', 'handshake_fail', 'auth_reject', 'upstream_reject', 'other',
];

function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function field(profile: QuotaProfile, snake: keyof QuotaProfile, camel: keyof QuotaProfile): unknown {
  return profile[snake] ?? profile[camel];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymdInZone(nowSec: number, tz: string): { y: number; m: number; d: number } {
  const date = new Date(nowSec * 1000);
  if (tz === 'UTC') {
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const num = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { y: num('year'), m: num('month'), d: num('day') };
}

function unixMidnight(y: number, m: number, d: number, tz: string): number {
  const utc = Date.UTC(y, m - 1, d);
  if (tz === 'UTC') return utc / 1000;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  let guess = utc;
  for (let i = 0; i < 4; i++) {
    const parts = fmt.formatToParts(new Date(guess));
    const num = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(num('year'), num('month') - 1, num('day'), num('hour'), num('minute'), num('second'));
    guess += Date.UTC(y, m - 1, d, 0, 0, 0) - asUtc;
  }
  return Math.floor(guess / 1000);
}

function calendarBounds(anchorDay: number, nowSec: number, tz: string): CycleBounds {
  const n = Math.min(31, Math.max(1, Math.floor(anchorDay)));
  const { y, m, d } = ymdInZone(nowSec, tz);
  const thisAnchor = Math.min(n, daysInMonth(y, m));
  if (d >= thisAnchor) {
    let ny = y;
    let nm = m + 1;
    if (nm > 12) {
      ny += 1;
      nm = 1;
    }
    return {
      start: unixMidnight(y, m, thisAnchor, tz),
      end: unixMidnight(ny, nm, Math.min(n, daysInMonth(ny, nm)), tz),
    };
  }
  let py = y;
  let pm = m - 1;
  if (pm < 1) {
    py -= 1;
    pm = 12;
  }
  return {
    start: unixMidnight(py, pm, Math.min(n, daysInMonth(py, pm)), tz),
    end: unixMidnight(y, m, thisAnchor, tz),
  };
}

function addMonthsUnix(unix: number, months: number): number {
  const date = new Date(unix * 1000);
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  let month = date.getUTCMonth() + months;
  let year = date.getUTCFullYear();
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;
  const clamped = Math.min(day, daysInMonth(year, month + 1));
  return Date.UTC(year, month, clamped, hour, minute, second) / 1000;
}

function anniversaryBounds(origin: number, nowSec: number): CycleBounds {
  if (nowSec < origin) return { start: origin, end: addMonthsUnix(origin, 1) };
  let months = Math.max(0, Math.floor((nowSec - origin) / (30.4375 * DAY)));
  while (addMonthsUnix(origin, months + 1) <= nowSec) months += 1;
  while (months > 0 && addMonthsUnix(origin, months) > nowSec) months -= 1;
  return { start: addMonthsUnix(origin, months), end: addMonthsUnix(origin, months + 1) };
}

export function cycleBounds(
  kind: CycleKind,
  anchorDay: number | null,
  nowSec: number,
  tz = 'UTC',
): CycleBounds | null {
  if (kind === 'manual') return null;
  if (kind === 'rolling_30d') {
    const origin = anchorDay != null && anchorDay > 31 ? anchorDay : 0;
    const n = Math.floor((nowSec - origin) / ROLLING_PERIOD);
    const start = origin + n * ROLLING_PERIOD;
    return { start, end: start + ROLLING_PERIOD };
  }
  if (kind === 'anniversary') {
    if (anchorDay == null || anchorDay <= 0) return null;
    if (anchorDay <= 31) return calendarBounds(anchorDay, nowSec, tz);
    return anniversaryBounds(anchorDay, nowSec);
  }
  return calendarBounds(anchorDay ?? 1, nowSec, tz);
}

export function usedBytes(counts: QuotaCounts | null | undefined, deltaIn: number, deltaOut: number): number {
  const inbound = Math.max(0, deltaIn);
  const outbound = Math.max(0, deltaOut);
  if (counts === 'in') return inbound;
  if (counts === 'out') return outbound;
  return inbound + outbound;
}

export function projectExhaustion(
  samples: UsedSample[],
  quota: number,
  cycleEnd: number,
): number | null {
  if (!Number.isFinite(quota) || quota <= 0 || samples.length < 3) return null;
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const latest = sorted[sorted.length - 1];
  const window = sorted.filter((sample) => sample.at >= latest.at - SLOPE_WINDOW);
  if (window.length < 3) return null;
  const n = window.length;
  const x0 = window[0].at;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const sample of window) {
    const x = sample.at - x0;
    sumX += x; sumY += sample.used; sumXY += x * sample.used; sumX2 += x * x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  if (slope <= 0) return null;
  if (latest.used >= quota) return latest.at;
  const projected = Math.floor(latest.at + (quota - latest.used) / slope);
  return projected > 0 ? projected : null;
}

export function quotaLevel(
  usedPct: number,
  thresholds: { warn?: number; alert?: number; exhausted?: number } = {},
): QuotaLevel {
  const warn = thresholds.warn ?? 70;
  const alert = thresholds.alert ?? 90;
  const exhausted = thresholds.exhausted ?? 100;
  if (usedPct >= exhausted) return 'severe';
  if (usedPct >= alert) return 'warn';
  if (usedPct >= warn) return 'chore';
  return 'ok';
}

export function detectCounterReset(prevLast: number | null | undefined, current: number): {
  reset: boolean;
  delta: number;
  baseline: number;
} {
  if (prevLast == null || !Number.isFinite(prevLast)) {
    return { reset: false, delta: 0, baseline: current };
  }
  if (current < prevLast) return { reset: true, delta: current, baseline: current };
  return { reset: false, delta: current - prevLast, baseline: prevLast };
}

function utcDay(unix: number): number {
  return Math.floor(unix / DAY) * DAY;
}

function newId(): string {
  return crypto.randomUUID();
}

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function asKind(value: unknown): CycleKind {
  if (value === 'anniversary' || value === 'rolling_30d' || value === 'manual' || value === 'calendar_day') {
    return value;
  }
  return 'calendar_day';
}

function asCounts(value: unknown): QuotaCounts {
  if (value === 'in' || value === 'out' || value === 'in_out') return value;
  return 'in_out';
}

async function openCycleRow(db: D1Database, nodeName: string): Promise<Row | null> {
  return db.prepare(
    "SELECT * FROM node_traffic_cycles WHERE node_name = ? AND status = 'open'",
  ).bind(nodeName).first<Row>();
}

export async function closeOpenCycle(db: D1Database, nodeName: string, nowSec: number): Promise<void> {
  const open = await openCycleRow(db, nodeName);
  if (!open) return;
  await db.prepare("UPDATE node_traffic_cycles SET status = 'closed', updated_at = ? WHERE id = ?")
    .bind(nowSec, open.id).run();
}

async function insertOpenCycle(
  db: D1Database,
  nodeName: string,
  bounds: CycleBounds,
  quota: number | null,
  counters: NetCounters,
  nowSec: number,
): Promise<Row> {
  const cycleId = newId();
  await db.prepare(
    `INSERT INTO node_traffic_cycles(
       id, node_name, cycle_start, cycle_end, quota_bytes, used_bytes,
       counter_in_start, counter_out_start, counter_in_last, counter_out_last,
       resets_detected, status, updated_at
     ) VALUES(?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 'open', ?)`,
  ).bind(
    cycleId, nodeName, bounds.start, bounds.end, quota,
    counters.in, counters.out, counters.in, counters.out, nowSec,
  ).run();
  return (await db.prepare('SELECT * FROM node_traffic_cycles WHERE id = ?').bind(cycleId).first<Row>())!;
}

function boundsFor(profile: QuotaProfile, nowSec: number): CycleBounds | null {
  const kind = asKind(field(profile, 'cycle_kind', 'cycleKind'));
  const anchor = finite(field(profile, 'cycle_anchor_day', 'cycleAnchorDay'));
  if (kind === 'anniversary') {
    const origin = finite(field(profile, 'traffic_cycle_start', 'trafficCycleStart')) ?? anchor;
    return cycleBounds(kind, origin, nowSec);
  }
  if (kind === 'manual') {
    const start = finite(field(profile, 'traffic_cycle_start', 'trafficCycleStart'));
    const end = finite(field(profile, 'traffic_cycle_end', 'trafficCycleEnd'));
    if (start != null && end != null && end > start) return { start, end };
    return null;
  }
  return cycleBounds(kind, anchor, nowSec);
}

export async function rollNodeCycle(
  db: D1Database,
  nodeName: string,
  profile: QuotaProfile,
  counters: NetCounters,
  nowSec: number,
): Promise<Row | null> {
  const name = nodeName.slice(0, NAME_LIMIT);
  if (!name) return null;
  const quota = finite(field(profile, 'traffic_quota_bytes', 'trafficQuotaBytes'));
  const counts = asCounts(field(profile, 'quota_counts', 'quotaCounts'));
  const kind = asKind(field(profile, 'cycle_kind', 'cycleKind'));
  let open = await openCycleRow(db, name);
  const expected = boundsFor(profile, nowSec);

  if (open && Number(open.cycle_end) <= nowSec && kind !== 'manual') {
    await db.prepare(
      "UPDATE node_traffic_cycles SET status = 'closed', updated_at = ? WHERE id = ?",
    ).bind(nowSec, open.id).run();
    open = null;
  }
  if (!open) {
    if (!expected) return null;
    open = await insertOpenCycle(db, name, expected, quota, counters, nowSec);
  }

  const inReset = detectCounterReset(finite(open.counter_in_last), counters.in);
  const outReset = detectCounterReset(finite(open.counter_out_last), counters.out);
  const delta = usedBytes(counts, inReset.delta, outReset.delta);
  const used = Number(open.used_bytes ?? 0) + delta;
  const resets = Number(open.resets_detected ?? 0) + (inReset.reset ? 1 : 0) + (outReset.reset ? 1 : 0);
  const dayAt = utcDay(nowSec);
  const prior = await db.prepare(
    'SELECT used_bytes FROM node_traffic_cycle_samples WHERE cycle_id = ? AND at < ? ORDER BY at DESC LIMIT 1',
  ).bind(open.id, dayAt).first<Row>();
  const todayBytes = used - Number(prior?.used_bytes ?? 0);
  let peakAt = open.peak_day_at == null ? null : Number(open.peak_day_at);
  let peakBytes = open.peak_day_bytes == null ? null : Number(open.peak_day_bytes);
  if (peakBytes == null || todayBytes >= peakBytes) {
    peakAt = dayAt;
    peakBytes = todayBytes;
  }

  await db.prepare(
    `INSERT INTO node_traffic_cycle_samples(cycle_id, at, used_bytes)
     VALUES(?, ?, ?)
     ON CONFLICT(cycle_id, at) DO UPDATE SET used_bytes = excluded.used_bytes`,
  ).bind(open.id, counters.at || nowSec, used).run();

  const sampleRows = await db.prepare(
    'SELECT at, used_bytes FROM node_traffic_cycle_samples WHERE cycle_id = ? AND at >= ? ORDER BY at ASC',
  ).bind(open.id, nowSec - SLOPE_WINDOW).all<Row>();
  const projected = quota == null
    ? null
    : projectExhaustion(
      sampleRows.results.map((row) => ({ at: Number(row.at), used: Number(row.used_bytes) })),
      quota,
      Number(open.cycle_end),
    );

  await db.prepare(
    `UPDATE node_traffic_cycles SET
       used_bytes = ?, counter_in_last = ?, counter_out_last = ?,
       resets_detected = ?, peak_day_at = ?, peak_day_bytes = ?,
       projected_exhaust_at = ?, quota_bytes = COALESCE(?, quota_bytes), updated_at = ?
     WHERE id = ?`,
  ).bind(
    used, counters.in, counters.out, resets, peakAt, peakBytes, projected, quota, nowSec, open.id,
  ).run();
  await db.prepare('DELETE FROM node_traffic_cycle_samples WHERE at < ?')
    .bind(nowSec - SAMPLE_RETENTION).run();

  return db.prepare('SELECT * FROM node_traffic_cycles WHERE id = ?').bind(open.id).first<Row>();
}

export async function quotaSummary(db: D1Database, nodeName: string) {
  const profile = await db.prepare(
    'SELECT * FROM ops_node_profiles WHERE catalog_name = ?',
  ).bind(nodeName).first<Row>();
  const open = await openCycleRow(db, nodeName);
  const quota = finite(open?.quota_bytes) ?? finite(profile?.traffic_quota_bytes);
  const used = Number(open?.used_bytes ?? 0);
  const pct = quota && quota > 0 ? (used / quota) * 100 : 0;
  return {
    quota,
    used,
    pct,
    remainingPct: quota && quota > 0 ? Math.max(0, 100 - pct) : null,
    cycleStart: open ? Number(open.cycle_start) : (profile?.traffic_cycle_start == null ? null : Number(profile.traffic_cycle_start)),
    cycleEnd: open ? Number(open.cycle_end) : (profile?.traffic_cycle_end == null ? null : Number(profile.traffic_cycle_end)),
    projectedExhaustAt: open?.projected_exhaust_at == null ? null : Number(open.projected_exhaust_at),
    level: quotaLevel(pct),
    autoUnlistAtPct: profile?.auto_unlist_at_pct == null ? null : Number(profile.auto_unlist_at_pct),
  };
}

export async function upsertErrorDaily(
  db: D1Database,
  node: string,
  dayAt: number,
  counts: Partial<Record<ErrorCategory, number>>,
  samples: Partial<Record<ErrorCategory, string | null>> = {},
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const category of ERROR_CATEGORIES) {
    const count = Number(counts[category] ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    const sample = samples[category];
    const clipped = sample == null || sample === '' ? null : String(sample).slice(0, 300);
    statements.push(db.prepare(
      `INSERT INTO node_error_daily(node, day_at, category, count, sample)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(node, day_at, category) DO UPDATE SET
         count = node_error_daily.count + excluded.count,
         sample = COALESCE(excluded.sample, node_error_daily.sample)`,
    ).bind(node.slice(0, NAME_LIMIT), utcDay(dayAt), category, Math.floor(count), clipped));
  }
  if (statements.length === 0) return;
  await db.batch(statements);
}

export async function readErrorTrend(db: D1Database, node: string, days = 7, nowSec = Math.floor(Date.now() / 1000)) {
  const span = Math.max(1, Math.min(90, Math.floor(days)));
  const to = utcDay(nowSec);
  const from = to - (span - 1) * DAY;
  const rows = await db.prepare(
    `SELECT day_at, category, count, sample
     FROM node_error_daily
     WHERE node = ? AND day_at >= ? AND day_at <= ?
     ORDER BY day_at ASC, category ASC`,
  ).bind(node.slice(0, NAME_LIMIT), from, to).all<Row>();
  const byDay = new Map<number, Record<ErrorCategory, number>>();
  const samples: Record<number, Partial<Record<ErrorCategory, string | null>>> = {};
  const totals = Object.fromEntries(ERROR_CATEGORIES.map((c) => [c, 0])) as Record<ErrorCategory, number>;
  for (const row of rows.results) {
    const day = Number(row.day_at);
    const category = String(row.category) as ErrorCategory;
    if (!ERROR_CATEGORIES.includes(category)) continue;
    const bucket = byDay.get(day) ?? Object.fromEntries(ERROR_CATEGORIES.map((c) => [c, 0])) as Record<ErrorCategory, number>;
    bucket[category] = Number(row.count);
    byDay.set(day, bucket);
    totals[category] += Number(row.count);
    (samples[day] ??= {})[category] = row.sample == null ? null : String(row.sample);
  }
  return {
    from,
    to,
    days: span,
    totals,
    byDay: [...byDay.entries()].map(([dayAt, counts]) => ({
      dayAt,
      counts,
      samples: samples[dayAt] ?? {},
    })),
  };
}

export async function readAgentNetCounters(
  db: D1Database,
  nodeName: string,
): Promise<NetCounters | null> {
  try {
    const sample = await db.prepare(
      `SELECT net_in, net_out, observed_at
       FROM operations_agent_samples
       WHERE node_name = ? AND net_in IS NOT NULL AND net_out IS NOT NULL
       ORDER BY observed_at DESC LIMIT 1`,
    ).bind(nodeName).first<Row>();
    const netIn = finite(sample?.net_in);
    const netOut = finite(sample?.net_out);
    if (netIn != null && netOut != null) {
      return { in: netIn, out: netOut, at: Number(sample!.observed_at) };
    }
    const rollup = await db.prepare(
      `SELECT net_in_last, net_out_last, bucket_at
       FROM operations_agent_rollups
       WHERE node_name = ? AND net_in_last IS NOT NULL AND net_out_last IS NOT NULL
       ORDER BY bucket_at DESC, resolution_seconds ASC LIMIT 1`,
    ).bind(nodeName).first<Row>();
    const lastIn = finite(rollup?.net_in_last);
    const lastOut = finite(rollup?.net_out_last);
    if (lastIn == null || lastOut == null) return null;
    return { in: lastIn, out: lastOut, at: Number(rollup!.bucket_at) };
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export async function rollAllNodeCycles(
  db: D1Database,
  nowSec: number,
  readCounters: (node: string) => Promise<NetCounters | null>,
): Promise<{ rolled: number; skipped: number }> {
  const profiles = await db.prepare(
    "SELECT * FROM ops_node_profiles WHERE status = 'active'",
  ).all<Row>();
  let rolled = 0;
  let skipped = 0;
  for (const profile of profiles.results) {
    const node = String(profile.catalog_name);
    const counters = await readCounters(node);
    if (!counters) { skipped += 1; continue; }
    await rollNodeCycle(db, node, profile, counters, nowSec);
    rolled += 1;
  }
  return { rolled, skipped };
}
