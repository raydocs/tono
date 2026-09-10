import { describe, expect, it } from 'vitest';
import { NODE_HEALTH_WORDS, healthWordForVerdict, NODE_VERDICTS } from '@contract';
import { copy } from '@/copy/copy';
import { HEALTH_WORDS } from './health';

/**
 * The console no longer maps probe statuses to words — the engine does, and
 * these hold the two lists to saying the same thing. A word the engine can emit
 * that the console has no copy for would render as an empty status cell, and a
 * word the console knows that the engine never emits is a filter nobody can
 * reach.
 */
describe('the health vocabulary', () => {
  it('is the contract list, in the contract order', () => {
    expect([...HEALTH_WORDS]).toEqual([...NODE_HEALTH_WORDS]);
  });

  it('has copy for every word the engine can reach through a verdict', () => {
    const reachable = new Set(NODE_VERDICTS.map((verdict) => healthWordForVerdict(verdict).word));
    for (const word of reachable) expect(HEALTH_WORDS).toContain(word);
    expect(reachable.size).toBe(HEALTH_WORDS.length);
  });

  it('names the five words the count sentence is written against', () => {
    expect(Object.values(copy.health).sort()).toEqual([...NODE_HEALTH_WORDS].sort());
  });
});
