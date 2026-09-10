import { describe, expect, it } from 'vitest';
import type { SourceHealthDto, SourceState, SystemHealthDto } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import { backfillLine, consoleBehind, worstSource } from './sources';

function health(rows: Array<[SourceHealthDto['source'], SourceState, number | null]>): SystemHealthDto {
  return {
    ok: rows.every(([, state]) => state === 'ready'),
    buildSha: null,
    contractVersion: 1,
    sources: rows.map(([source, state, asOfSec]) => ({ source, state, asOfSec, message: null })),
    cronLastRunAt: null,
    cronLastDurationMs: null,
    cronLastError: null,
    cronSteps: null,
    backfill: null,
    updatedAt: nowSec(),
  };
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

describe('the header pill names the weakest source', () => {
  /**
   * The bug: the old pill said 正常 as soon as any one source was ready, so a
   * console reading a nineteen-hour-old mainland sweep looked exactly like one
   * reading a fresh fleet.
   */
  it('never says 正常 while any source is behind', () => {
    const verdict = worstSource(health([
      ['collector', 'ready', nowSec() - MINUTE],
      ['komari', 'stale', nowSec() - 19 * HOUR],
      ['telemetry', 'ready', nowSec() - MINUTE],
    ]));
    expect(verdict?.text).not.toContain(copy.sourceOk);
    expect(verdict?.text).toBe(copy.sourceLate(copy.sourceWord.komari, copy.lasting.hours(19)));
    expect(verdict?.tone).toBe('warn');
  });

  it('says 正常 only when every source is ready, dated by the oldest of them', () => {
    const verdict = worstSource(health([
      ['collector', 'ready', nowSec() - 3 * MINUTE],
      ['komari', 'ready', nowSec() - 40 * MINUTE],
    ]));
    expect(verdict?.text).toBe(copy.sourceFresh(copy.ago.minutes(40)));
    expect(verdict?.tone).toBe('ok');
  });

  /** An executor nobody has installed is expected, and must never be red. */
  it('words a source that was never wired up as 未接, in the grey tone', () => {
    const verdict = worstSource(health([
      ['collector', 'ready', nowSec() - MINUTE],
      ['komari', 'stale', nowSec() - 19 * HOUR],
      ['jobs', 'missing', null],
    ]));
    expect(verdict?.text).toBe(copy.sourceGone(copy.sourceWord.jobs));
    expect(verdict?.tone).toBe('unk');
  });

  it('lists every source in the hover, so the pill is never taken on trust', () => {
    const verdict = worstSource(health([
      ['collector', 'ready', nowSec() - MINUTE],
      ['jobs', 'missing', null],
    ]));
    expect(verdict?.title.split('\n')).toEqual([
      copy.sourceLine(copy.sourceWord.collector, copy.sourceState.ready, copy.ago.now),
      copy.sourceLineNever(copy.sourceWord.jobs, copy.sourceState.missing),
    ]);
  });

  it('judges nothing when there is nothing to judge', () => {
    expect(worstSource(health([]))).toBeNull();
  });
});

describe('how far behind the console itself is', () => {
  it('is patient with one slow read and hard about a stopped one', () => {
    expect(consoleBehind(null)).toBe(false);
    expect(consoleBehind(nowSec() - 2 * MINUTE)).toBe(false);
    expect(consoleBehind(nowSec() - 10 * MINUTE)).toBe(true);
  });
});

describe('the backfill line', () => {
  it('says nothing once nothing is behind', () => {
    expect(backfillLine(null)).toBeNull();
    expect(backfillLine({ windowsTotal: 8640, windowsFlattened: 8640, windowsProjected: 8640 })).toBeNull();
  });

  /** 5440 windows left, 200 a run, five minutes a run: 28 runs, 140 minutes. */
  it('counts whole runs, because a partial run finishes nothing', () => {
    expect(backfillLine({ windowsTotal: 8640, windowsFlattened: 8640, windowsProjected: 3200 }))
      .toBe(copy.backfilling('3200', '8640', '140'));
  });
});
