import { describe, expect, it } from 'vitest';
import type { DirectCandidateDto, HomeLineUsageDayDto } from '@contract';
import { copy } from '@/copy/copy';
import {
  candidateCounts,
  cycleWord,
  deliveryLine,
  draftText,
  durationWord,
  fromDateInput,
  recentDeliveries,
  resolveSection,
  selectCandidates,
  toDateInput,
  usageDays,
} from './settings';

const DAY = 86_400;

function candidate(etld1: string, status: DirectCandidateDto['status']): DirectCandidateDto {
  return {
    etld1,
    status,
    firstSeen: 1_700_000_000,
    users: 1,
    bytes30d: 1_024,
    countryHint: null,
    decidedBy: null,
    decidedAt: null,
  };
}

function usage(dayAt: number, bytes: number, source: HomeLineUsageDayDto['source'] = 'manual'): HomeLineUsageDayDto {
  return { dayAt, bytesUp: 0, bytesDown: bytes, users: 1, source };
}

describe('resolveSection', () => {
  it('falls back to 告警 for a hash that names nothing', () => {
    expect(resolveSection(null)).toBe('alerts');
    expect(resolveSection('nope')).toBe('alerts');
  });

  it('keeps a section the rail actually has', () => {
    expect(resolveSection('audit')).toBe('audit');
  });
});

describe('durationWord', () => {
  it('says 90 秒 rather than rounding the flap window to two minutes', () => {
    expect(durationWord(90)).toBe('90 秒');
  });

  it('uses the largest unit that divides exactly', () => {
    expect(durationWord(300)).toBe('5 分钟');
    expect(durationWord(3_600)).toBe('1 小时');
    expect(durationWord(86_400)).toBe('1 天');
  });

  it('says a rule with no delay does not wait, rather than waiting zero', () => {
    expect(durationWord(0)).toBe(copy.settings.duration.none);
    expect(durationWord(Number.NaN)).toBe(copy.settings.duration.none);
  });
});

describe('deliveryLine', () => {
  it('explains a cooled-down alert as held back, not as a failure', () => {
    expect(deliveryLine('suppressed')).toEqual({ word: '没重复推送', why: '冷却中未发' });
  });

  it('keeps the other three neutral', () => {
    expect(deliveryLine('pending').word).toBe('待发');
    expect(deliveryLine('sent').word).toBe('已发');
    expect(deliveryLine('failed').word).toBe('没发出去');
  });

  it('sorts newest first and caps the block', () => {
    const rows = [1, 2, 3, 4].map((n) => ({ at: n * 100 } as never));
    expect(recentDeliveries(rows, 2).map((row) => (row as { at: number }).at)).toEqual([400, 300]);
  });
});

describe('cycleWord', () => {
  // Built from local midnights: the dates an operator reads off a bill are the
  // ones in their own timezone, and a fixed epoch would move across the runner's.
  const first = new Date(2025, 8, 1).getTime() / 1_000;
  const last = new Date(2025, 8, 30).getTime() / 1_000;

  it('renders both ends when both are known', () => {
    expect(cycleWord(first, last)).toBe('2025-09-01 – 2025-09-30');
  });

  it('keeps the end date when the start was never recorded', () => {
    expect(cycleWord(null, last)).toBe('2025-09-30');
    expect(cycleWord(first, null)).toBe('2025-09-01');
  });

  it('is absent, not a dash pair, when nothing is known', () => {
    expect(cycleWord(null, null)).toBeNull();
  });
});

describe('usageDays', () => {
  const end = 1_788_825_600;

  it('returns one entry per day, oldest first', () => {
    const days = usageDays([], 30, end);
    expect(days).toHaveLength(30);
    expect(days[0].dayAt).toBe(end - 29 * DAY);
    expect(days[29].dayAt).toBe(end);
  });

  it('sums the meters that reported the same day', () => {
    const days = usageDays([usage(end, 100, 'manual'), usage(end, 50, 'node_stats')], 3, end);
    expect(days[2].bytes).toBe(150);
  });

  it('keeps an unmetered day empty instead of calling it zero', () => {
    const days = usageDays([usage(end, 100)], 3, end);
    expect(days[0].bytes).toBeNull();
    expect(days[1].bytes).toBeNull();
  });
});

describe('candidates', () => {
  const rows = [
    candidate('bilibili.com', 'new'),
    candidate('weibo.com', 'accepted'),
    candidate('qq.com', 'accepted'),
  ];

  it('counts every chip off the same list it filters', () => {
    const counts = candidateCounts(rows);
    expect(counts.all).toBe(3);
    expect(counts.accepted).toBe(2);
    expect(counts.rejected).toBe(0);
    expect(selectCandidates(rows, 'accepted')).toHaveLength(counts.accepted);
    expect(selectCandidates(rows, 'all')).toHaveLength(counts.all);
  });
});

describe('date inputs', () => {
  it('round-trips a local date without sliding a day', () => {
    const seconds = new Date(2026, 8, 9).getTime() / 1_000;
    expect(toDateInput(seconds)).toBe('2026-09-09');
    expect(fromDateInput('2026-09-09')).toBe(seconds);
  });

  it('treats an empty or malformed box as no date at all', () => {
    expect(toDateInput(null)).toBe('');
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('2026-9-9')).toBeNull();
  });
});

describe('draftText', () => {
  it('pretty-prints what came back', () => {
    expect(draftText({ version: 4 })).toBe('{\n  "version": 4\n}');
  });

  it('has nothing to show when the draft is missing', () => {
    expect(draftText(null)).toBeNull();
  });
});
