import type { HomeLineDto } from '@contract';
import type { HomeExit } from './settings-legacy';

/**
 * The residential pages' folds: what state an inventory line is in, which
 * billed lines are close to their date, and what the month's rent adds up to.
 * Pure, so the tiles, the filter counts and the table rows cannot disagree.
 */

export type ExitState = 'bound' | 'idle' | 'dead' | 'off';
export const EXIT_STATES: readonly ExitState[] = ['bound', 'idle', 'dead', 'off'];

/**
 * One inventory line's state, in the order an operator acts on it.
 *
 * A line that is switched off is off whatever the prober says. A line whose
 * every probe failed is dead even when customers are bound to it — that is
 * the worst case, not a busy line — and only a line that answers is split
 * into carrying customers or idle. A line nobody has probed yet is not dead.
 */
export function exitState(row: HomeExit, bound: number): ExitState {
  if (row.status !== 'active') return 'off';
  if (row.probeTotal !== null && row.probeTotal > 0 && row.probeAlive === 0) return 'dead';
  return bound > 0 ? 'bound' : 'idle';
}

/** Probes that answered over probes sent, across lines; null when none were sent. */
export function probeShare(rows: ReadonlyArray<{ alive: number | null; total: number | null }>): number | null {
  let alive = 0;
  let total = 0;
  for (const row of rows) {
    if (row.alive === null || row.total === null) continue;
    alive += row.alive;
    total += row.total;
  }
  return total > 0 ? alive / total : null;
}

const DAY_SEC = 86_400;
export const SOON_DAYS = 30;

/** An active line whose paid period ends inside the window, or already has. */
export function renewsSoon(row: HomeLineDto, now: number, days = SOON_DAYS): boolean {
  return row.status === 'active' && row.expiresAt !== null && row.expiresAt - now <= days * DAY_SEC;
}

/**
 * The period's rent per currency, over active lines billed a fixed amount.
 *
 * A per-GB price is a rate, not a bill, and adding it to rents would invent
 * a number; currencies are never converted here, because the ledger owns the
 * rate of the day and this page would be a second, disagreeing one.
 */
export function rentByCurrency(rows: readonly HomeLineDto[]): Array<{ currency: string | null; amount: number }> {
  const sums = new Map<string | null, number>();
  for (const row of rows) {
    if (row.status !== 'active' || row.price === null) continue;
    if (row.billingKind !== 'monthly' && row.billingKind !== 'bundle') continue;
    sums.set(row.currency, (sums.get(row.currency) ?? 0) + row.price);
  }
  return [...sums].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
}

/** Bytes both ways this period, or null for a line nobody meters. */
export function usedBytes(row: HomeLineDto): number | null {
  const usage = row.usage.value;
  return usage === null ? null : usage.bytesUp + usage.bytesDown;
}
