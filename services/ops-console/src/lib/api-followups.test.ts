import { describe, expect, it } from 'vitest';
import { isFollowupOverdue, shanghaiDayStartSec } from './api-followups';

/**
 * The digest's 已逾期 tag follows the Worker's calendar-day rule
 * (`handlers/followups.ts`: overdue is `due_at <` Shanghai midnight, today
 * is `[dayStart, nextMidnight)`), never the current second — a note promised
 * for today at 00:00 is still due today at 03:23. Frozen epochs, so the
 * boundary reads the same on every run.
 */
describe('followup overdue boundary', () => {
  const at = Date.parse('2026-09-09T03:23:46+08:00') / 1_000;
  const midnight = Date.parse('2026-09-09T00:00:00+08:00') / 1_000;

  it('marks only the days before Shanghai today as overdue', () => {
    expect(shanghaiDayStartSec(at)).toBe(midnight);
    expect(isFollowupOverdue(midnight - 86_400, at)).toBe(true);
    expect(isFollowupOverdue(midnight - 3_600, at)).toBe(true);
    expect(isFollowupOverdue(midnight, at)).toBe(false);
    expect(isFollowupOverdue(midnight + 8 * 3_600, at)).toBe(false);
    expect(isFollowupOverdue(null, at)).toBe(false);
  });
});
