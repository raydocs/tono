import type { CustomerSummaryDto } from '@contract';

/**
 * The customers dashboard's folds over the list the shell already holds.
 * Pure, so the tiles, the expiry chart and the usage ranking count the same
 * people the same way, and nothing here costs a request of its own.
 */

const DAY_SEC = 86_400;
const WEEK_SEC = 7 * DAY_SEC;
/** A share of the quota past which a customer is about to run dry. */
export const NEAR_QUOTA = 0.8;

export type ListStats = {
  /** Paying customers: suspended and expired accounts are not the fleet's load. */
  active: number;
  /** Connected right now, over customers whose client reported either way. */
  online: number;
  reporting: number;
  seenWeek: number;
  failedDay: number;
  /** Bytes this period over customers somebody metered; `null` when nobody was. */
  usage: number | null;
  unmetered: number;
  nearQuota: number;
  expiringWeek: number;
  expired: number;
};

export function listStats(rows: readonly CustomerSummaryDto[], now: number): ListStats {
  const out: ListStats = {
    active: 0, online: 0, reporting: 0, seenWeek: 0, failedDay: 0,
    usage: null, unmetered: 0, nearQuota: 0, expiringWeek: 0, expired: 0,
  };
  for (const row of rows) {
    if (row.lifecycle !== 'active') continue;
    out.active += 1;
    if (row.connected.asOfSec !== null) {
      out.reporting += 1;
      if (row.connected.value) out.online += 1;
    }
    if (row.lastSeenAt !== null && row.lastSeenAt >= now - WEEK_SEC) out.seenWeek += 1;
    if (row.lastFailure !== null && row.lastFailure.at >= now - DAY_SEC) out.failedDay += 1;
    const used = meteredBytes(row);
    if (used === null) out.unmetered += 1;
    else {
      out.usage = (out.usage ?? 0) + used;
      if (row.quotaBytes !== null && row.quotaBytes > 0 && used / row.quotaBytes >= NEAR_QUOTA) out.nearQuota += 1;
    }
    if (row.expiresAt !== null) {
      if (row.expiresAt < now) out.expired += 1;
      else if (row.expiresAt < now + WEEK_SEC) out.expiringWeek += 1;
    }
  }
  return out;
}

/** Bytes this period, or null for a customer nobody metered. */
export function meteredBytes(row: CustomerSummaryDto): number | null {
  return row.usageBytes.asOfSec === null ? null : row.usageBytes.value;
}

/**
 * Active customers by the week their paid time runs out: one column for the
 * lapsed ones still marked active, then `weeks` columns from today. Anyone
 * further out, or with no date, is outside the question this chart answers.
 */
export function expiryWeeks(rows: readonly CustomerSummaryDto[], now: number, weeks: number): number[] {
  const out = new Array<number>(weeks + 1).fill(0);
  for (const row of rows) {
    if (row.lifecycle !== 'active' || row.expiresAt === null) continue;
    if (row.expiresAt < now) {
      out[0] += 1;
      continue;
    }
    const week = Math.floor((row.expiresAt - now) / WEEK_SEC);
    if (week < weeks) out[week + 1] += 1;
  }
  return out;
}

/** The heaviest metered customers this period, heaviest first. */
export function topUsage(rows: readonly CustomerSummaryDto[], count: number): CustomerSummaryDto[] {
  return rows
    .filter((row) => row.lifecycle === 'active' && (meteredBytes(row) ?? 0) > 0)
    .sort((a, b) => (meteredBytes(b) ?? 0) - (meteredBytes(a) ?? 0))
    .slice(0, count);
}
