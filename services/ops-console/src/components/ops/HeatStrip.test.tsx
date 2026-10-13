import type { ActivityHourDto } from '@contract';
import { describe, expect, it } from 'vitest';
import { mergeHour, toDays } from './HeatStrip';

const HOUR = 3_600;
const BASE = Date.parse('2026-09-09T10:00:00Z') / 1_000;

function row(over: Partial<ActivityHourDto>): ActivityHourDto {
  return {
    hourAt: BASE,
    onlineMinutes: 0,
    connectedMinutes: 0,
    bytesUp: 0,
    bytesDown: 0,
    node: 'node-a',
    platform: 'windows',
    appVersion: '1.0.0',
    ...over,
  };
}

describe('HeatStrip toDays', () => {
  it('merges two devices in the same hour instead of letting the last row win', () => {
    const days = toDays([
      row({ onlineMinutes: 40, connectedMinutes: 30, bytesUp: 100, bytesDown: 1_000, node: 'node-a' }),
      row({ onlineMinutes: 25, connectedMinutes: 10, bytesUp: 50, bytesDown: 500, node: 'node-b', platform: 'ios' }),
    ]);
    const cells = days.flatMap((day) => day.hours).filter((cell) => cell !== null);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      hourAt: BASE,
      onlineMinutes: 40,
      connectedMinutes: 30,
      bytesUp: 150,
      bytesDown: 1_500,
      node: 'node-a',
      platform: 'windows',
    });
  });

  it('keeps rows from different hours in separate cells', () => {
    const days = toDays([row({ onlineMinutes: 10 }), row({ hourAt: BASE + HOUR, onlineMinutes: 20 })]);
    const cells = days.flatMap((day) => day.hours).filter((cell) => cell !== null);
    expect(cells).toHaveLength(2);
  });
});

describe('HeatStrip mergeHour', () => {
  it('caps presence at 60 minutes and adds bytes when the hour repeats', () => {
    const merged = mergeHour(
      row({ onlineMinutes: 60, connectedMinutes: 60, bytesUp: 10, bytesDown: 20 }),
      row({ hourAt: BASE + HOUR, onlineMinutes: 60, connectedMinutes: 50, bytesUp: 5, bytesDown: 7, node: 'node-b' }),
    );
    expect(merged.onlineMinutes).toBe(60);
    expect(merged.connectedMinutes).toBe(60);
    expect(merged.bytesUp).toBe(15);
    expect(merged.bytesDown).toBe(27);
    expect(merged.node).toBe('node-a');
  });

  it('takes the title fields from the longer connection, earlier hourAt on a tie', () => {
    const early = row({ connectedMinutes: 20, node: 'early' });
    const late = row({ hourAt: BASE + HOUR, connectedMinutes: 20, node: 'late' });
    expect(mergeHour(late, early).node).toBe('early');
    expect(mergeHour(early, late).hourAt).toBe(BASE);
    expect(mergeHour(early, row({ connectedMinutes: 45, node: 'long' })).node).toBe('long');
  });
});
