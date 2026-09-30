import { describe, expect, it } from 'vitest';
import { byteTicks, extent, linear, nearestIndex, niceTicks, splitRuns, timeTicks } from './chart-scale';

describe('chart scale', () => {
  it('picks round ticks that cover the whole range', () => {
    expect(niceTicks(0, 105, 4)).toEqual([0, 50, 100, 150]);
  });

  it('picks byte ticks on round multiples of the printed unit', () => {
    const gib = 1024 ** 3;
    expect(byteTicks(0, 37 * gib, 4)).toEqual([0, 10, 20, 30, 40].map((n) => n * gib));
  });

  it('starts a non-negative extent at zero and ignores gaps', () => {
    expect(extent([null, 40, 42, null], 0)).toEqual([0, 42]);
  });

  it('maps a zero-width domain to the middle of the range', () => {
    expect(linear(5, 5, 0, 100)(5)).toBe(50);
  });

  it('puts time ticks on wall-clock boundaries in the given offset', () => {
    const eightHours = 8 * 3_600;
    const lo = Date.UTC(2026, 8, 30, 0, 20) / 1_000 - eightHours;
    const ticks = timeTicks(lo, lo + 12 * 3_600, 4, eightHours);
    expect(ticks.map((at) => new Date((at + eightHours) * 1_000).getUTCHours())).toEqual([3, 6, 9, 12]);
  });

  it('snaps a pointer to the closest column', () => {
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2);
  });

  it('breaks a line at every gap instead of joining across it', () => {
    expect(splitRuns([1, null, null, 2, 3, null], (point) => point === null)).toEqual([[1], [2, 3]]);
  });
});
