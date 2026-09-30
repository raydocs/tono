import { describe, expect, it } from 'vitest';
import type { SloRowDto } from './api-slo';
import { dailyOutage, dailyRate, nodeQuality } from './slo';

function row(over: Partial<SloRowDto>): SloRowDto {
  return {
    dayAt: 0,
    platform: 'macos',
    carrier: 'telecom',
    node: 'A',
    attempts: 100,
    successes: 100,
    p50Ms: 50,
    verifiedOutageMin: 0,
    unmeasuredMin: 0,
    ...over,
  };
}

describe('slo folding', () => {
  it('weights a daily rate by attempts instead of averaging slice rates', () => {
    const rates = dailyRate([
      row({ attempts: 4_000, successes: 3_960 }),
      row({ carrier: 'unicom', attempts: 12, successes: 6 }),
    ], (r) => r.platform);
    expect(rates.get('macos')?.[0].v).toBeCloseTo(3_966 / 4_012, 6);
  });

  it('leaves a day with no attempts for a key as a gap', () => {
    const rates = dailyRate([
      row({ dayAt: 0, platform: 'macos' }),
      row({ dayAt: 86_400, platform: 'windows' }),
    ], (r) => r.platform);
    expect(rates.get('windows')?.[0].v).toBeNull();
  });

  it('counts outage minutes once per node-day, not once per slice', () => {
    expect(dailyOutage([
      row({ verifiedOutageMin: 60 }),
      row({ carrier: 'unicom', verifiedOutageMin: 60 }),
      row({ node: 'B', verifiedOutageMin: 30 }),
    ])).toEqual([{ dayAt: 0, minutes: 90 }]);
  });

  it('ranks the worst node first', () => {
    const ranked = nodeQuality([
      row({ node: 'good', successes: 99 }),
      row({ node: 'bad', successes: 40 }),
    ]);
    expect(ranked.map((r) => r.node)).toEqual(['bad', 'good']);
  });
});
