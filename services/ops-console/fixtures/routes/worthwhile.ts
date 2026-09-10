/**
 * 本周最值得做的三件事, for the fixture dev server.
 */

const HOUR = 3_600;
const DAY = 24 * HOUR;

export type FixtureSet = 'default' | 'dense' | 'empty';

type Pick = {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  metric: { kind: string; value: number } | null;
  payoff: { kind: string; value: number; isEstimate: boolean } | null;
  confidence: 'high' | 'medium' | 'low';
  deadlineSec: number | null;
  evidenceAsOfSec: number | null;
  action: { page: string; section: string | null; subjectId: string | null };
};

function weekOf(at: number): string {
  const dayIndex = Math.floor((at + 8 * HOUR) / DAY);
  const sinceMonday = ((dayIndex + 3) % 7 + 7) % 7;
  return new Date((dayIndex - sinceMonday) * DAY * 1_000).toISOString().slice(0, 10);
}

function lastMonth(at: number): string {
  const day = new Date((at + 8 * HOUR) * 1_000).toISOString().slice(0, 10);
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  if (month > 1) return `${year}-${String(month - 1).padStart(2, '0')}`;
  return `${year - 1}-12`;
}

function id(pick: Omit<Pick, 'id'>, week: string): Pick {
  return { ...pick, id: `${pick.kind}:${pick.subjectType}:${pick.subjectId}:${week}` };
}

function three(clock: number): Pick[] {
  const week = weekOf(clock);
  return [
    id({
      kind: 'idle_node',
      subjectType: 'node',
      subjectId: 'Tokyo · Fuji',
      subjectLabel: 'Tokyo · Fuji',
      metric: { kind: 'cnyMinor', value: 8_400 },
      payoff: { kind: 'cny', value: 8_400, isEstimate: false },
      confidence: 'high',
      deadlineSec: clock + 12 * DAY,
      evidenceAsOfSec: clock - 2 * HOUR,
      action: { page: 'nodes', section: null, subjectId: 'Tokyo · Fuji' },
    }, week),
    id({
      kind: 'repeat_repair',
      subjectType: 'node',
      subjectId: 'Seoul · Han',
      subjectLabel: 'Seoul · Han',
      metric: { kind: 'incidents', value: 4 },
      payoff: { kind: 'hours', value: 2, isEstimate: true },
      confidence: 'medium',
      deadlineSec: null,
      evidenceAsOfSec: clock - 6 * HOUR,
      action: { page: 'nodes', section: null, subjectId: 'Seoul · Han' },
    }, week),
    id({
      kind: 'month_unclosed',
      subjectType: 'month',
      subjectId: lastMonth(clock),
      subjectLabel: lastMonth(clock),
      metric: { kind: 'days', value: 9 },
      payoff: null,
      confidence: 'high',
      deadlineSec: null,
      evidenceAsOfSec: null,
      action: { page: 'settings', section: 'ledger', subjectId: lastMonth(clock) },
    }, week),
  ];
}

export function worthwhileOf(set: FixtureSet, clock: number): unknown {
  const picks = set === 'empty' ? [] : three(clock);
  return {
    weekOf: weekOf(clock),
    computedAt: clock,
    picks,
    considered: set === 'empty' ? 0 : picks.length + 4,
  };
}
