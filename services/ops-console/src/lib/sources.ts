import type {
  BackfillHealthDto,
  Measured as ContractMeasured,
  SourceHealthDto,
  SourceId,
  SourceState,
  SystemHealthDto,
  Tone,
} from '@contract';
import type { Measured } from '@/components/ops/measured';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import { formatCount, formatDurationSince, formatWhenAgo } from './display';

export function sourceWord(id: SourceId): string {
  return copy.sourceWord[id];
}

/**
 * A contract `Measured<T>` in the form the ops primitives render.
 *
 * The one thing it does beyond renaming the source: a cell whose `asOfSec` is
 * null becomes `value: null`, so `Value` prints the em dash. Without that, a
 * customer whose client has never reported would render `连接: 否` — a
 * confident answer to a question nobody asked the client.
 */
export function shown<T>(measured: ContractMeasured<T>): Measured<T | null> {
  return {
    value: measured.asOfSec === null ? null : measured.value,
    asOfSec: measured.asOfSec,
    source: sourceWord(measured.source),
  };
}

/**
 * How ready a source is, worst first.
 *
 * A source nobody has connected outranks one that has merely fallen behind:
 * "stale" is a gap of hours in one answer, "missing" is the whole answer
 * absent, and the header exists to say which. `error` sits between them — the
 * source is wired and is failing, which needs the same look as behind.
 */
const READINESS: Record<SourceState, number> = {
  missing: 0,
  error: 1,
  stale: 2,
  ready: 3,
};

/** Never red: a source that was never wired up is a gap, not an alarm (R5). */
const SOURCE_TONE: Record<SourceState, Tone> = {
  missing: 'unk',
  error: 'warn',
  stale: 'warn',
  ready: 'ok',
};

export type SourceVerdict = {
  tone: Tone;
  /** The pill: the weakest source and what is wrong with it, in five words. */
  text: string;
  /** The hover: every source, so the pill never has to be believed on trust. */
  title: string;
};

function pillText(row: SourceHealthDto): string {
  const who = sourceWord(row.source);
  if (row.state === 'missing') return copy.sourceGone(who);
  if (row.state === 'error') return copy.sourceBroken(who);
  if (row.asOfSec === null) return copy.sourceGone(who);
  return copy.sourceLate(who, formatDurationSince(row.asOfSec));
}

function titleLine(row: SourceHealthDto): string {
  const who = sourceWord(row.source);
  const state = copy.sourceState[row.state];
  if (row.asOfSec === null) return copy.sourceLineNever(who, state);
  return copy.sourceLine(who, state, formatWhenAgo(row.asOfSec));
}

/**
 * The header capsule, computed from the one thing that knows: system health.
 *
 * The old pill read the fleet response's own `sources` map and could only say
 * 正常 or 未知, so a nineteen-hour-old mainland sweep and a fresh read looked
 * identical. Returns null when there is nothing to judge — the caller then says
 * 未知 rather than implying freshness nobody measured (R2).
 */
export function worstSource(health: SystemHealthDto): SourceVerdict | null {
  const rows = health.sources;
  if (rows.length === 0) return null;
  const title = rows.map(titleLine).join('\n');
  const worst = rows.reduce((low, row) => (
    READINESS[row.state] < READINESS[low.state] ? row : low
  ));
  if (worst.state === 'ready') {
    // The oldest of the ready sources: the pill is only as fresh as its
    // weakest link, and "刚刚" over an hour-old sweep is the lie this replaces.
    const oldest = rows.reduce((low, row) => (
      (row.asOfSec ?? 0) < (low.asOfSec ?? 0) ? row : low
    ));
    return {
      tone: 'ok',
      text: oldest.asOfSec === null
        ? copy.sourceOk
        : copy.sourceFresh(formatWhenAgo(oldest.asOfSec)),
      title,
    };
  }
  return { tone: SOURCE_TONE[worst.state], text: pillText(worst), title };
}

/**
 * Whether the console itself has stopped hearing back.
 *
 * The shell refetches every minute, so a page whose newest answer is three
 * minutes old is not a quiet fleet — it is a console talking to nobody, and
 * every number on it is a claim about a world that has moved on. Three minutes
 * is two missed beats plus slack, so one slow request is not an alarm.
 */
const BEHIND_SECONDS = 3 * 60;

export function consoleBehind(fetchedAt: number | null): boolean {
  if (fetchedAt === null) return false;
  return nowSec() - fetchedAt > BEHIND_SECONDS;
}

/**
 * How long the backfill has left, in the operator's terms.
 *
 * The cron drains a fixed number of windows every five minutes, so the estimate
 * is arithmetic rather than a promise; it is rounded up to whole runs because a
 * partial run finishes nothing. Null once nothing is behind — a banner that
 * never leaves is a banner nobody reads.
 */
const WINDOWS_PER_RUN = 200;
const RUN_MINUTES = 5;

export function backfillLine(backfill: BackfillHealthDto | null): string | null {
  if (backfill === null) return null;
  const { windowsTotal, windowsProjected } = backfill;
  if (windowsTotal <= 0 || windowsProjected >= windowsTotal) return null;
  const left = windowsTotal - windowsProjected;
  const minutes = Math.ceil(left / WINDOWS_PER_RUN) * RUN_MINUTES;
  return copy.backfilling(
    formatCount(windowsProjected),
    formatCount(windowsTotal),
    formatCount(minutes),
  );
}
