// Residential (家宽) line assets: commercial fields, cycle metering, chores.
// Pure module — not imported from index.ts.

import { str } from '../env';
import { ApiError } from '../errors';

type Row = Record<string, any>;

export const BILLING_KINDS = ['monthly', 'per_gb', 'bundle'] as const;
export type BillingKind = (typeof BILLING_KINDS)[number];
export const METER_SOURCES = ['client_route', 'node_stats', 'provider_api', 'manual'] as const;
export type MeterSource = (typeof METER_SOURCES)[number];
export type HomeLineLevel = 'ok' | 'chore' | 'warn' | 'severe';

export type HomeLineFields = {
  providerAccountId: string | null;
  isp: string | null;
  region: string | null;
  price: number | null;
  currency: string | null;
  billingKind: BillingKind | null;
  bundleBytes: number | null;
  cycleStart: number | null;
  cycleEnd: number | null;
  expiresAt: number | null;
  meterSource: MeterSource | null;
};
export type HomeLinePatch = { [K in keyof HomeLineFields]?: HomeLineFields[K] };
export type HomeLineRecord = HomeLineFields & { id: string; updatedAt: number };
export type UsedThisCycle = Record<MeterSource, number>;
export type HomeLineSummary = {
  expiresAt: number | null;
  daysToExpiry: number | null;
  billingKind: BillingKind | null;
  bundleBytes: number | null;
  cycleStart: number | null;
  cycleEnd: number | null;
  usedThisCycle: UsedThisCycle;
  reconciliation: { clientRoute: number; nodeStats: number; deltaPct: number; mismatch: boolean };
  remainingPct: number | null;
  level: HomeLineLevel;
};
export type HomeLineChore = {
  homeExitId: string;
  kind: 'expiring' | 'bundle_low' | 'meter_mismatch' | 'probe_failing';
  detail: string;
};
export type HomeLineUsageInput = {
  homeExitId: string;
  dayAt: number;
  source: MeterSource;
  bytesUp: number;
  bytesDown: number;
  users: number;
};

const PATCH_KEYS = [
  'providerAccountId', 'isp', 'region', 'price', 'currency', 'billingKind',
  'bundleBytes', 'cycleStart', 'cycleEnd', 'expiresAt', 'meterSource',
] as const;
const CHORE_KIND_ORDER: HomeLineChore['kind'][] = [
  'expiring', 'bundle_low', 'meter_mismatch', 'probe_failing',
];
const DAY = 86400;
const LEVEL_RANK: Record<HomeLineLevel, number> = { ok: 0, chore: 1, warn: 2, severe: 3 };

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}
function isBillingKind(value: string): value is BillingKind {
  return (BILLING_KINDS as readonly string[]).includes(value);
}
function isMeterSource(value: string): value is MeterSource {
  return (METER_SOURCES as readonly string[]).includes(value);
}
function emptyUsed(): UsedThisCycle {
  return { client_route: 0, node_stats: 0, provider_api: 0, manual: 0 };
}
function worse(a: HomeLineLevel, b: HomeLineLevel): HomeLineLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}
function invalid(name: string): never {
  throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
}
function keep<T>(patch: unknown, existing: T | null, parse: (value: unknown) => T): T | null {
  if (patch === undefined) return existing;
  if (patch === null || patch === '') return null;
  return parse(patch);
}
function textField(value: unknown, name: string, max: number): string {
  return str(value, name, 1, max).trim();
}
function moneyField(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid('price');
  return value;
}
function currencyField(value: unknown): string {
  const currency = textField(value, 'currency', 8).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) invalid('currency');
  return currency;
}
function enumField<T extends string>(
  value: unknown, name: string, allowed: (v: string) => v is T,
): T {
  if (typeof value !== 'string' || !allowed(value)) invalid(name);
  return value;
}
function intField(value: unknown, name: string, min: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) invalid(name);
  return value as number;
}
function requireNonNegativeInt(value: unknown, name: string): number {
  return intField(value, name, 0);
}
function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}
function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}
function fromRow(row: Row): HomeLineRecord {
  const billing = row.billing_kind == null ? null : String(row.billing_kind);
  const meter = row.meter_source == null ? null : String(row.meter_source);
  return {
    id: String(row.id),
    providerAccountId: nullableString(row.provider_account_id),
    isp: nullableString(row.isp),
    region: nullableString(row.region),
    price: nullableNumber(row.price),
    currency: nullableString(row.currency),
    billingKind: billing && isBillingKind(billing) ? billing : null,
    bundleBytes: nullableNumber(row.bundle_bytes),
    cycleStart: nullableNumber(row.cycle_start),
    cycleEnd: nullableNumber(row.cycle_end),
    expiresAt: nullableNumber(row.expires_at),
    meterSource: meter && isMeterSource(meter) ? meter : null,
    updatedAt: Number(row.updated_at),
  };
}
function assertBundleCycle(line: HomeLineFields) {
  if (line.cycleStart != null && line.cycleEnd != null && line.cycleStart >= line.cycleEnd) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'cycleStart must be before cycleEnd');
  }
  if (line.billingKind === 'bundle') {
    if (line.bundleBytes == null || line.bundleBytes <= 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'bundle billing requires bundleBytes');
    }
    if (line.cycleStart == null || line.cycleEnd == null) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'bundle billing requires cycleStart and cycleEnd');
    }
  }
  if (line.billingKind === 'per_gb' && line.price == null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'per_gb billing requires price');
  }
}
function bundleLevel(usedPct: number): HomeLineLevel {
  if (usedPct >= 100) return 'severe';
  if (usedPct >= 90) return 'warn';
  if (usedPct >= 70) return 'chore';
  return 'ok';
}
function expiryLevel(days: number): HomeLineLevel {
  if (days <= 0) return 'severe';
  if (days <= 3) return 'warn';
  if (days <= 7) return 'chore';
  return 'ok';
}

async function loadLine(db: D1Database, id: string): Promise<HomeLineRecord> {
  const row = await db.prepare('SELECT * FROM home_exits WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
  return fromRow(row);
}

async function usedInCycle(
  db: D1Database, homeExitId: string, cycleStart: number | null, cycleEnd: number | null,
): Promise<UsedThisCycle> {
  const used = emptyUsed();
  if (cycleStart == null || cycleEnd == null) return used;
  try {
    const rows = await db.prepare(
      `SELECT source, SUM(bytes_up) AS bytes_up, SUM(bytes_down) AS bytes_down
       FROM home_line_usage_daily
       WHERE home_exit_id = ? AND day_at >= ? AND day_at <= ?
       GROUP BY source`,
    ).bind(homeExitId, cycleStart, cycleEnd).all<Row>();
    for (const row of rows.results ?? []) {
      const source = String(row.source);
      if (isMeterSource(source)) used[source] = Number(row.bytes_up ?? 0) + Number(row.bytes_down ?? 0);
    }
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  return used;
}

export async function patchHomeLine(
  db: D1Database, id: string, patch: HomeLinePatch, nowSec: number,
): Promise<HomeLineRecord> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Expected an object');
  }
  if (Object.keys(patch).some((key) => !PATCH_KEYS.includes(key as typeof PATCH_KEYS[number]))) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unexpected field');
  }
  const existing = await loadLine(db, id);
  const next: HomeLineFields = {
    providerAccountId: keep(patch.providerAccountId, existing.providerAccountId, (v) => textField(v, 'providerAccountId', 200)),
    isp: keep(patch.isp, existing.isp, (v) => textField(v, 'isp', 80)),
    region: keep(patch.region, existing.region, (v) => textField(v, 'region', 80)),
    price: keep(patch.price, existing.price, moneyField),
    currency: keep(patch.currency, existing.currency, currencyField),
    billingKind: keep(patch.billingKind, existing.billingKind, (v) => enumField(v, 'billingKind', isBillingKind)),
    bundleBytes: keep(patch.bundleBytes, existing.bundleBytes, (v) => intField(v, 'bundleBytes', 0)),
    cycleStart: keep(patch.cycleStart, existing.cycleStart, (v) => intField(v, 'cycleStart', 1)),
    cycleEnd: keep(patch.cycleEnd, existing.cycleEnd, (v) => intField(v, 'cycleEnd', 1)),
    expiresAt: keep(patch.expiresAt, existing.expiresAt, (v) => intField(v, 'expiresAt', 1)),
    meterSource: keep(patch.meterSource, existing.meterSource, (v) => enumField(v, 'meterSource', isMeterSource)),
  };
  assertBundleCycle(next);
  await db.prepare(
    `UPDATE home_exits
     SET provider_account_id = ?, isp = ?, region = ?, price = ?, currency = ?,
         billing_kind = ?, bundle_bytes = ?, cycle_start = ?, cycle_end = ?,
         expires_at = ?, meter_source = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    next.providerAccountId, next.isp, next.region, next.price, next.currency,
    next.billingKind, next.bundleBytes, next.cycleStart, next.cycleEnd,
    next.expiresAt, next.meterSource, nowSec, id,
  ).run();
  return { id, ...next, updatedAt: nowSec };
}

export async function recordHomeLineUsage(
  db: D1Database, input: HomeLineUsageInput, nowSec = Math.floor(Date.now() / 1000),
): Promise<void> {
  const homeExitId = str(input.homeExitId, 'homeExitId', 1, 100);
  if (!Number.isSafeInteger(input.dayAt) || input.dayAt <= 0) invalid('dayAt');
  if (typeof input.source !== 'string' || !isMeterSource(input.source)) invalid('source');
  const bytesUp = requireNonNegativeInt(input.bytesUp, 'bytesUp');
  const bytesDown = requireNonNegativeInt(input.bytesDown, 'bytesDown');
  const users = requireNonNegativeInt(input.users, 'users');
  const dayAt = Math.floor(input.dayAt / DAY) * DAY;
  // client_route / node_stats are incremental telemetry: each report is a
  // partial window and must add to the day's total. manual / provider_api are
  // authoritative day totals from an operator or the ISP, so a later write
  // replaces the earlier figure instead of stacking it.
  const accumulate = input.source === 'client_route' || input.source === 'node_stats' ? 1 : 0;
  try {
    await db.prepare(
      `INSERT INTO home_line_usage_daily(
         home_exit_id, day_at, source, bytes_up, bytes_down, users, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(home_exit_id, day_at, source) DO UPDATE SET
         bytes_up = CASE WHEN ? THEN home_line_usage_daily.bytes_up + excluded.bytes_up
                         ELSE excluded.bytes_up END,
         bytes_down = CASE WHEN ? THEN home_line_usage_daily.bytes_down + excluded.bytes_down
                           ELSE excluded.bytes_down END,
         users = CASE WHEN ? THEN home_line_usage_daily.users + excluded.users
                      ELSE excluded.users END,
         updated_at = excluded.updated_at`,
    ).bind(homeExitId, dayAt, input.source, bytesUp, bytesDown, users, nowSec, accumulate, accumulate, accumulate).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

export async function attributeClientRouteBytes(
  db: D1Database,
  input: { userId: string; dayAt: number; residentialBytesUp: number; residentialBytesDown: number },
  nowSec: number,
): Promise<{ homeExitId: string } | null> {
  const userId = str(input.userId, 'userId', 1, 100);
  const bytesUp = requireNonNegativeInt(input.residentialBytesUp, 'residentialBytesUp');
  const bytesDown = requireNonNegativeInt(input.residentialBytesDown, 'residentialBytesDown');
  try {
    const binding = await db.prepare(
      'SELECT home_exit_id FROM user_home_bindings WHERE user_id = ?',
    ).bind(userId).first<Row>();
    if (!binding) return null;
    const homeExitId = String(binding.home_exit_id);
    await recordHomeLineUsage(db, {
      homeExitId, dayAt: input.dayAt, source: 'client_route', bytesUp, bytesDown, users: 1,
    }, nowSec);
    return { homeExitId };
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export async function homeLineSummary(
  db: D1Database, id: string, nowSec: number,
): Promise<HomeLineSummary> {
  const line = await loadLine(db, id);
  const usedThisCycle = await usedInCycle(db, id, line.cycleStart, line.cycleEnd);
  const clientRoute = usedThisCycle.client_route;
  const nodeStats = usedThisCycle.node_stats;
  const mag = Math.max(clientRoute, nodeStats);
  const delta = mag === 0 ? 0 : (Math.abs(clientRoute - nodeStats) / mag) * 100;
  // A missing counterpart cannot be reconciled; mismatch only when both
  // meters reported something this cycle and they disagree by more than 20%.
  const mismatch = clientRoute > 0 && nodeStats > 0 && delta > 20;
  const used = line.meterSource
    ? usedThisCycle[line.meterSource]
    : Math.max(usedThisCycle.client_route, usedThisCycle.node_stats, usedThisCycle.provider_api, usedThisCycle.manual);
  const remainingPct = line.billingKind === 'bundle' && line.bundleBytes && line.bundleBytes > 0
    ? ((line.bundleBytes - used) / line.bundleBytes) * 100
    : null;
  let level: HomeLineLevel = remainingPct == null ? 'ok' : bundleLevel(100 - remainingPct);
  const days = line.expiresAt == null ? null : Math.ceil((line.expiresAt - nowSec) / DAY) || 0;
  if (days != null) level = worse(level, expiryLevel(days));
  return {
    expiresAt: line.expiresAt,
    daysToExpiry: days,
    billingKind: line.billingKind,
    bundleBytes: line.bundleBytes,
    cycleStart: line.cycleStart,
    cycleEnd: line.cycleEnd,
    usedThisCycle,
    reconciliation: { clientRoute, nodeStats, deltaPct: delta, mismatch },
    remainingPct,
    level,
  };
}

export async function homeLineChores(db: D1Database, nowSec: number): Promise<HomeLineChore[]> {
  const chores: HomeLineChore[] = [];
  try {
    const homes = await db.prepare(
      `SELECT id FROM home_exits WHERE status != 'retired' ORDER BY id`,
    ).all<Row>();
    for (const home of homes.results ?? []) {
      const homeExitId = String(home.id);
      const summary = await homeLineSummary(db, homeExitId, nowSec);
      if (summary.daysToExpiry != null && summary.daysToExpiry <= 7) {
        chores.push({
          homeExitId,
          kind: 'expiring',
          detail: summary.daysToExpiry <= 0
            ? `expired ${Math.abs(summary.daysToExpiry)}d ago`
            : `expires in ${summary.daysToExpiry}d`,
        });
      }
      if (summary.remainingPct != null && 100 - summary.remainingPct >= 70) {
        chores.push({
          homeExitId, kind: 'bundle_low',
          detail: `bundle ${Math.floor(100 - summary.remainingPct)}% used`,
        });
      }
      if (summary.reconciliation.mismatch) {
        chores.push({
          homeExitId, kind: 'meter_mismatch',
          detail: `client_route vs node_stats delta ${Math.round(summary.reconciliation.deltaPct)}%`,
        });
      }
    }
    const probes = await db.prepare(
      `SELECT samples.home_exit_id AS home_exit_id
       FROM (
         SELECT home_exit_id, status,
                ROW_NUMBER() OVER (PARTITION BY home_exit_id ORDER BY probed_at DESC) AS rn
         FROM operations_home_probe_samples
       ) samples
       JOIN home_exits ON home_exits.id = samples.home_exit_id
       WHERE samples.rn <= 3 AND home_exits.status != 'retired'
       GROUP BY samples.home_exit_id
       HAVING COUNT(*) = 3 AND SUM(CASE WHEN samples.status = 'dead' THEN 1 ELSE 0 END) = 3`,
    ).all<Row>();
    for (const row of probes.results ?? []) {
      chores.push({ homeExitId: String(row.home_exit_id), kind: 'probe_failing', detail: 'last 3 probes dead' });
    }
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return chores.sort((a, b) => {
    const byId = a.homeExitId.localeCompare(b.homeExitId);
    return byId !== 0 ? byId : CHORE_KIND_ORDER.indexOf(a.kind) - CHORE_KIND_ORDER.indexOf(b.kind);
  });
}

export async function retainHomeLineUsage(
  db: D1Database, nowSec: number, days = 400, limit = 500,
): Promise<number> {
  try {
    const result = await db.prepare(
      `DELETE FROM home_line_usage_daily
       WHERE rowid IN (
         SELECT rowid FROM home_line_usage_daily
         WHERE day_at < ?
         ORDER BY day_at ASC, home_exit_id ASC, source ASC
         LIMIT ?
       )`,
    ).bind(nowSec - days * DAY, limit).run();
    return Number(result.meta.changes ?? 0);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}
