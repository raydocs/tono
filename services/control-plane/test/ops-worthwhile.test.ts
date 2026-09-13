// 本周 means Monday in Asia/Shanghai: a Sunday evening in UTC is already the
// next week's Monday. That boundary is the whole of `worthwhile` before D5.
import { describe, expect, it } from 'vitest';
import { assertWorthwhile } from '../src/ops/contract';
import { emptyWorthwhile, shanghaiWeekOf } from '../src/ops/worthwhile';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('worthwhile', () => {
  it('names the Shanghai Monday: Sunday 20:00 UTC is already next week', () => {
    expect(shanghaiWeekOf(at('2026-09-13T20:00:00Z'))).toBe('2026-09-14');
    expect(shanghaiWeekOf(at('2026-09-13T15:59:59Z'))).toBe('2026-09-07');
  });

  it('an empty week passes its own checker', () => {
    const week = emptyWorthwhile(at('2026-09-10T00:00:00Z'));
    expect(assertWorthwhile(week)).toEqual(week);
    expect(week.weekOf).toBe('2026-09-07');
  });
});
