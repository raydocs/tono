// The week boundary is the whole of `worthwhile` that exists before D5, and it
// is the half that is easy to get wrong: 本周 means Monday in Asia/Shanghai, so
// a Sunday evening in UTC is already next week's Monday, and a Monday afternoon
// in UTC is still that same Monday.
import { describe, expect, it } from 'vitest';
import { assertWorthwhile } from '../src/ops/contract';
import { emptyWorthwhile, shanghaiWeekOf } from '../src/ops/worthwhile';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('shanghaiWeekOf', () => {
  it('gives the Monday of the week a Thursday falls in', () => {
    expect(shanghaiWeekOf(at('2026-09-10T00:00:00Z'))).toBe('2026-09-07');
  });

  // 04:00 Monday in Shanghai. Answering 2026-09-13 here would put a whole
  // Monday's work under last week's heading.
  it('treats Sunday 20:00 UTC as the next Monday', () => {
    expect(shanghaiWeekOf(at('2026-09-13T20:00:00Z'))).toBe('2026-09-14');
  });

  it('keeps Monday 15:00 UTC on that same Monday', () => {
    expect(shanghaiWeekOf(at('2026-09-14T15:00:00Z'))).toBe('2026-09-14');
  });

  // 23:59:59 Sunday in Shanghai — the last second that still belongs to the
  // week that started on the 7th.
  it('keeps the last Shanghai second of Sunday in the old week', () => {
    expect(shanghaiWeekOf(at('2026-09-13T15:59:59Z'))).toBe('2026-09-07');
  });

  it('is idempotent: the Monday it names is its own week', () => {
    const monday = shanghaiWeekOf(at('2026-09-10T00:00:00Z'));
    expect(shanghaiWeekOf(Math.floor(Date.parse(`${monday}T00:00:00+08:00`) / 1000))).toBe(monday);
  });
});

describe('emptyWorthwhile', () => {
  it('is a valid, empty week', () => {
    const week = emptyWorthwhile(at('2026-09-10T00:00:00Z'));
    expect(assertWorthwhile(week)).toEqual(week);
    expect(week.picks).toEqual([]);
    expect(week.considered).toBe(0);
    expect(week.weekOf).toBe('2026-09-07');
  });
});
