import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import { formatWhen, formatWhenAgo } from './display';

const AT = Date.parse('2026-09-09T03:23:46Z');

describe('relative time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AT);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the shared clock', () => {
    expect(nowSec()).toBe(Math.floor(AT / 1_000));
  });

  it('walks the four buckets and never invents a value', () => {
    const now = nowSec();
    expect(formatWhenAgo(now - 10)).toBe(copy.ago.now);
    expect(formatWhenAgo(now - 20 * 60)).toBe(copy.ago.minutes(20));
    expect(formatWhenAgo(now - 3 * 3600)).toBe(copy.ago.hours(3));
    expect(formatWhenAgo(now - 5 * 86400)).toBe(copy.ago.days(5));
    expect(formatWhenAgo(null)).toBe(copy.missing);
  });
});

describe('absolute time', () => {
  it('prints a moment the way every other date on these pages reads', () => {
    const at = new Date(2026, 8, 8, 22, 3, 46).getTime() / 1_000;
    expect(formatWhen(at)).toBe('2026-09-08 22:03');
    expect(formatWhen(null)).toBe(copy.missing);
  });
});
