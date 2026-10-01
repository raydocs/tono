import { describe, expect, it } from 'vitest';
import { probesOf } from './probes';

describe('probesOf', () => {
  it('keeps an unrun round a gap and calls total loss dead', () => {
    expect(probesOf([
      { latencyMs: 40, lossPct: 20 },
      { latencyMs: null, lossPct: null },
      { latencyMs: null, lossPct: 100 },
      { latencyMs: 41, lossPct: 100 },
    ])).toEqual(['alive', null, 'dead', 'dead']);
  });
});
