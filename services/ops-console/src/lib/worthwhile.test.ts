import type { WorthwhilePickDto } from '@contract';
import { describe, expect, it } from 'vitest';
import { confidenceWord, metricText, payoffText, sentenceOf } from './worthwhile';

const pick = (over: Partial<WorthwhilePickDto> = {}): WorthwhilePickDto => ({
  id: 'idle_node:node:Tokyo · Fuji:2026-09-07',
  kind: 'idle_node',
  subjectType: 'node',
  subjectId: 'Tokyo · Fuji',
  subjectLabel: 'Tokyo · Fuji',
  metric: { kind: 'cnyMinor', value: 8_400 },
  payoff: { kind: 'cny', value: 8_400, isEstimate: false },
  confidence: 'high',
  deadlineSec: null,
  evidenceAsOfSec: null,
  action: { page: 'nodes', section: null, subjectId: 'Tokyo · Fuji' },
  ...over,
});

describe('payoffText', () => {
  it('shows a measured amount as itself', () => {
    expect(payoffText({ kind: 'cny', value: 8_400, isEstimate: false })).toBe('¥84.00');
  });

  it('marks an estimate in front of the number and again after it', () => {
    const text = payoffText({ kind: 'cny', value: 8_400, isEstimate: true });
    expect(text.startsWith('≈')).toBe(true);
    expect(text).not.toBe('¥84.00');
    expect(text).toContain('¥84.00');
  });

  it('reads hours and customers in their own units', () => {
    expect(payoffText({ kind: 'hours', value: 2, isEstimate: true })).toContain('2');
    expect(payoffText({ kind: 'customers', value: 4, isEstimate: true })).toContain('4');
  });

  /** Zero is a measurement; "cannot be estimated" is not, and must not read as one. */
  it('says nothing can be claimed rather than claiming nothing', () => {
    const nothing = payoffText(null);
    expect(nothing).not.toContain('0');
    expect(nothing).toBe(payoffText(null));
  });
});

describe('metricText', () => {
  it('reads days, incidents, customers, bytes and money each in their own unit', () => {
    expect(metricText({ kind: 'days', value: 5 })).toContain('5');
    expect(metricText({ kind: 'incidents', value: 3 })).toContain('3');
    expect(metricText({ kind: 'customers', value: 2 })).toContain('2');
    expect(metricText({ kind: 'bytes', value: 200_000_000_000 })).toContain('GB');
    expect(metricText({ kind: 'cnyMinor', value: 8_400 })).toBe('¥84.00');
  });

  it('has a word for a pick with no measurement behind it', () => {
    expect(metricText(null)).not.toBe('');
  });
});

describe('confidenceWord', () => {
  it('gives each level a different word', () => {
    const words = new Set(['high', 'medium', 'low'].map(
      (level) => confidenceWord(level as 'high' | 'medium' | 'low'),
    ));
    expect(words.size).toBe(3);
  });
});

describe('sentenceOf', () => {
  it('puts the label and the measurement into one line', () => {
    const line = sentenceOf(pick(), 'Tokyo · Fuji');
    expect(line).toContain('Tokyo · Fuji');
    expect(line).toContain('¥84.00');
  });

  /** The console masks a customer before the sentence is built, never after. */
  it('uses the label it is given rather than the id on the pick', () => {
    const line = sentenceOf(
      pick({
        kind: 'repeat_repair',
        subjectType: 'user',
        subjectId: 'u-04',
        subjectLabel: 'u-04',
        metric: { kind: 'incidents', value: 3 },
        payoff: { kind: 'hours', value: 2, isEstimate: true },
      }),
      'u-***',
    );
    expect(line).toContain('u-***');
    expect(line).not.toContain('u-04');
  });

  it('writes a line for every kind the hub can send', () => {
    const kinds: WorthwhilePickDto['kind'][] = [
      'idle_node', 'quota_exhausting', 'node_renewal', 'line_renewal',
      'repeat_repair', 'route_direct', 'followup_overdue', 'month_unclosed',
    ];
    for (const kind of kinds) {
      const line = sentenceOf(pick({ kind, metric: { kind: 'days', value: 4 } }), '甲');
      expect(line.length, kind).toBeGreaterThan(2);
      expect(line, kind).toContain('甲');
    }
  });
});
