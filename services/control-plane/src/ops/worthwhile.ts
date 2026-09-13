// 本周三件事的产生端。
//
// The contract is frozen (src/ops/contract/worthwhile.ts) and the digest
// already carries the field; the picking itself lands in D5. Until then this
// returns an empty week, which is an honest answer: nothing has been
// considered yet, so `considered: 0` and no picks.

import type { WorthwhileDto } from './contract';

const DAY = 86_400;
const SHANGHAI_OFFSET = 8 * 3_600;
/** 1970-01-01 was a Thursday, i.e. 3 days into its week. */
const EPOCH_DAY_TO_MONDAY = 3;

/**
 * The Monday that starts the Asia/Shanghai week `nowSec` falls in, `YYYY-MM-DD`.
 *
 * The offset arithmetic is local rather than borrowed from
 * `handlers/followups.ts`: that module imports this one, and a week boundary
 * is not worth a cycle.
 */
export function shanghaiWeekOf(nowSec: number): string {
  const dayIndex = Math.floor((nowSec + SHANGHAI_OFFSET) / DAY);
  const sinceMonday = ((dayIndex + EPOCH_DAY_TO_MONDAY) % 7 + 7) % 7;
  const monday = dayIndex - sinceMonday;
  return new Date(monday * DAY * 1000).toISOString().slice(0, 10);
}

export function emptyWorthwhile(nowSec: number): WorthwhileDto {
  return {
    weekOf: shanghaiWeekOf(nowSec),
    computedAt: nowSec,
    picks: [],
    considered: 0,
  };
}

import { weeklyPicks } from './weekly-picks';

export { weeklyPicks };

/**
 * The week's ≤3 picks.
 */
export async function weeklyWorthwhile(db: D1Database, nowSec: number): Promise<WorthwhileDto> {
  return weeklyPicks(db, nowSec);
}

