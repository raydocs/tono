// Daily FX rates from frankfurter (ECB). The alert webhook host allowlist
// does not apply: that list exists to stop operator-configured webhook URLs
// from becoming an SSRF oracle. This step is a Worker-initiated GET to a
// hardcoded host with an empty body — it sends no customer or ledger data.

import { ApiError } from '../errors';
import type { FxRateDto } from './contract';

export const FX_BASES = ['USD', 'EUR', 'GBP', 'JPY', 'HKD'] as const;
export const FX_QUOTE = 'CNY';
export const FX_SOURCE = 'frankfurter' as const;
export const FRANKFURTER_HOST = 'api.frankfurter.app';
const FETCH_TIMEOUT_MS = 5_000;

export type StoredFxRate = {
  day: string;
  base: string;
  quote: string;
  rate: number;
  fetchedAt: number;
  source: string;
};

export type FxFetchResult = { fetched: number; failed: number; error?: string };

export function utcDateString(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

export function utcMonthString(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 7);
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function parseMonth(raw: string | null | undefined, fallback?: string): string {
  const value = raw == null || raw === '' ? fallback : raw;
  if (value == null || !MONTH_RE.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid month');
  }
  const cap = new Date();
  cap.setUTCDate(1);
  cap.setUTCMonth(cap.getUTCMonth() + 24);
  const maxMonth = cap.toISOString().slice(0, 7);
  if (value < '2024-01' || value > maxMonth) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid month');
  }
  return value;
}

export function parseDay(raw: string | null | undefined, fallback?: string): string {
  const value = raw == null || raw === '' ? fallback : raw;
  if (value == null || !DAY_RE.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid day');
  }
  return value;
}

export function parseBase(raw: string | null | undefined, fallback = 'USD'): string {
  const value = (raw == null || raw === '' ? fallback : raw).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid base');
  }
  return value;
}

export function monthBounds(month: string): { start: number; end: number } {
  const match = MONTH_RE.exec(month);
  if (!match) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid month');
  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  const start = Date.UTC(year, monthNum - 1, 1) / 1000;
  const end = Date.UTC(year, monthNum, 1) / 1000;
  return { start, end };
}

export function cnyMinorFrom(amountMinor: number, rate: number): number {
  return Math.round(amountMinor * rate);
}

export function fxDto(row: StoredFxRate): FxRateDto {
  return {
    day: row.day,
    base: row.base,
    quote: 'CNY',
    rate: row.rate,
    fetchedAt: row.fetchedAt,
    source: 'frankfurter',
  };
}

export function cnyIdentityRate(day: string, fetchedAt: number): StoredFxRate {
  return {
    day, base: 'CNY', quote: FX_QUOTE, rate: 1, fetchedAt, source: FX_SOURCE,
  };
}

export async function lookupRate(
  db: D1Database,
  base: string,
  day: string,
): Promise<StoredFxRate | null> {
  if (base === 'CNY') return cnyIdentityRate(day, 0);
  const row = await db.prepare(
    `SELECT day, base, quote, rate, fetched_at AS fetchedAt, source
     FROM ops_fx_rates
     WHERE base = ? AND quote = ? AND day <= ?
     ORDER BY day DESC LIMIT 1`,
  ).bind(base, FX_QUOTE, day).first<StoredFxRate>();
  if (!row) return null;
  return {
    day: String(row.day),
    base: String(row.base),
    quote: String(row.quote),
    rate: Number(row.rate),
    fetchedAt: Number(row.fetchedAt),
    source: String(row.source),
  };
}

async function fetchOne(base: string): Promise<number> {
  const url = `https://${FRANKFURTER_HOST}/latest?from=${encodeURIComponent(base)}&to=${FX_QUOTE}`;
  const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`frankfurter ${base} ${response.status}`);
  const payload = await response.json() as { rates?: { CNY?: unknown } };
  const rate = payload?.rates?.CNY;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`frankfurter ${base} bad rate`);
  }
  return rate;
}

export async function fetchAndStoreFxRates(db: D1Database, nowSec: number): Promise<FxFetchResult> {
  const day = utcDateString(nowSec);
  let fetched = 0;
  let failed = 0;
  const errors: string[] = [];
  const results = await Promise.all(FX_BASES.map(async (base) => {
    try {
      const rate = await fetchOne(base);
      return { base, rate, error: null as string | null };
    } catch (error) {
      return { base, rate: null as number | null, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  for (const result of results) {
    if (result.rate == null) {
      failed += 1;
      errors.push(result.error ?? result.base);
      continue;
    }
    await db.prepare(
      `INSERT INTO ops_fx_rates(day, base, quote, rate, fetched_at, source)
       VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, base, quote) DO UPDATE SET
         rate = excluded.rate, fetched_at = excluded.fetched_at, source = excluded.source`,
    ).bind(day, result.base, FX_QUOTE, result.rate, nowSec, FX_SOURCE).run();
    fetched += 1;
  }
  const out: FxFetchResult = { fetched, failed };
  if (failed > 0) out.error = errors.join('; ').slice(0, 300);
  return out;
}
