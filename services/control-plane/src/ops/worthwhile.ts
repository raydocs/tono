// 本周三件事的产生端。
//
// The contract is frozen (src/ops/contract/worthwhile.ts) and the digest
// carries the field. What lands here is the picking: eight generators in
// `worthwhile-picks.ts` produce candidates, this module puts a number on each
// of them, sorts, and refuses to say more than three.
//
// Nothing is written down. The week is recomputed on every read, which is why
// the ids are built from the week rather than from a row: two reads on the
// same Monday agree, and next Monday's read is allowed to disagree.

import type { WorthwhileDto, WorthwhilePickDto } from './contract';
import { monthBounds } from './fx';
import {
  DAY,
  type Candidate,
  cnyPerGbMinor,
  idleNodes,
  lineRenewals,
  MONTH_CLOSE_DAY,
  newestRates,
  nodeRenewals,
  overdueFollowups,
  quotaExhausting,
  repeatRepairs,
  routeDirect,
  unclosedMonth,
} from './worthwhile-picks';

const SHANGHAI_OFFSET = 8 * 3_600;
/** 1970-01-01 was a Thursday, i.e. 3 days into its week. */
const EPOCH_DAY_TO_MONDAY = 3;

/** Three is the whole point; the contract refuses a fourth. */
const MAX_PICKS = 3;

/**
 * The statements one `weeklyWorthwhile` call is allowed to spend, counted
 * rather than trusted (`test/ops-worthwhile.test.ts`). Eight generators, the
 * one shared FX read, and the one median-cost read behind 直连候选.
 */
export const STATEMENT_CEILING = 10;

/* --------------------------------------------------------------- 折成钱 */

/**
 * 估算 constants. They are guesses with a unit, written down once so that a
 * pick that beat another pick can be argued with instead of wondered about.
 *
 *  - 一小时 ≈ ¥200: what an hour of the owner's evening is worth, which is the
 *    only labour this fleet has.
 *  - 一位客户 ≈ ¥60/月: the plan price, so "this touches four customers" and
 *    "this saves ¥240 a month" are the same sentence.
 *
 * Neither is a measurement, and every payoff built on them carries
 * `isEstimate: true` into the console, which says 估算 beside the number.
 */
export const CNY_PER_HOUR = 200;
export const CNY_PER_CUSTOMER = 60;

/**
 * What a pick with nothing to weigh is worth anyway.
 *
 * An overdue follow-up and an unclosed month both pay nothing and both have to
 * be done: the month more so, because the books stop being reconcilable and
 * every later month inherits the mess.
 */
export const URGENCY: Partial<Record<string, number>> = {
  followup_overdue: 30,
  month_unclosed: 80,
};

/** How much of the number to believe. */
export const CONFIDENCE_FACTOR = { high: 1, medium: 0.7, low: 0.4 } as const;

/** Yuan-equivalents, before confidence. `cny` payoffs arrive in fen. */
function baseScore(candidate: Candidate): number {
  const payoff = candidate.payoff;
  if (payoff === null) return URGENCY[candidate.kind] ?? 0;
  if (payoff.kind === 'cny') return payoff.value / 100;
  if (payoff.kind === 'hours') return payoff.value * CNY_PER_HOUR;
  return payoff.value * CNY_PER_CUSTOMER;
}

export function scoreOf(candidate: Candidate): number {
  return baseScore(candidate) * CONFIDENCE_FACTOR[candidate.confidence];
}

/* ----------------------------------------------------------------- 本周 */

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

/** `YYYY-MM-DD` in Shanghai — the day whose date decides 月结 is late. */
function shanghaiDay(nowSec: number): string {
  return new Date((nowSec + SHANGHAI_OFFSET) * 1000).toISOString().slice(0, 10);
}

/** The month before `month` (`YYYY-MM`), without a Date round trip. */
function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  if (index > 1) return `${year}-${String(index - 1).padStart(2, '0')}`;
  return `${year - 1}-12`;
}

/* ---------------------------------------------------------------- 排序 */

function idOf(candidate: Candidate, weekOf: string): string {
  return `${candidate.kind}:${candidate.subjectType}:${candidate.subjectId}:${weekOf}`;
}

/**
 * Score first, then whichever runs out sooner, then the id.
 *
 * A candidate with no deadline sorts behind one that has it: "no date" is not
 * "the end of time", but it is certainly not more urgent than a date.
 */
function byUrgency(a: Candidate & { id: string }, b: Candidate & { id: string }): number {
  const score = scoreOf(b) - scoreOf(a);
  if (score !== 0) return score;
  const left = a.deadlineSec ?? Number.MAX_SAFE_INTEGER;
  const right = b.deadlineSec ?? Number.MAX_SAFE_INTEGER;
  if (left !== right) return left - right;
  return a.id.localeCompare(b.id);
}

/**
 * One line per thing, not per reason.
 *
 * A machine that is both idle and up for renewal is one decision — keep it or
 * drop it — and printing it twice would spend two of the three lines saying so.
 */
function pickBest(candidates: Candidate[], weekOf: string): WorthwhilePickDto[] {
  const withIds = candidates.map((candidate) => ({ ...candidate, id: idOf(candidate, weekOf) }));
  withIds.sort(byUrgency);
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

/* ---------------------------------------------------------------- 本体 */

/**
 * The week's ≤3 picks, recomputed from the database on every read.
 *
 * Ten statements at the very most, and a generator whose tables are not there
 * yet contributes nothing rather than throwing: the digest that carries this
 * block is the first thing an operator opens in the morning, and it has to
 * come back even when half the fleet's bookkeeping does not exist.
 */
export async function weeklyWorthwhile(db: D1Database, nowSec: number): Promise<WorthwhileDto> {
  const weekOf = shanghaiWeekOf(nowSec);
  const day = shanghaiDay(nowSec);
  const month = day.slice(0, 7);
  const rates = await newestRates(db, nowSec);
  const perGb = await cnyPerGbMinor(db, nowSec);
  const generated = await Promise.all([
    idleNodes(db, nowSec, rates),
    quotaExhausting(db, nowSec),
    nodeRenewals(db, nowSec),
    lineRenewals(db, nowSec),
    repeatRepairs(db, nowSec),
    routeDirect(db, perGb),
    overdueFollowups(db, nowSec),
    Number(day.slice(8, 10)) >= MONTH_CLOSE_DAY
      // The previous month stopped growing when this one started, and the
      // ledger's month bounds are the ones the close screen uses.
      ? unclosedMonth(db, nowSec, previousMonth(month), monthBounds(month).start)
      : Promise.resolve([] as Candidate[]),
  ]);
  const candidates = generated.flat();
  return {
    weekOf,
    computedAt: nowSec,
    picks: pickBest(candidates, weekOf),
    considered: candidates.length,
  };
}
