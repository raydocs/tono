import { describe, expect, it } from 'vitest';
import { exitUnreachableUsers } from '../src/ops/verdict-exit-fails';

describe('exit-side failures counted per node', () => {
  it('counts a user for the one node they could not reach', () => {
    const out = exitUnreachableUsers([
      { node: 'Westwood', userId: 'u1' },
      { node: 'Westwood', userId: 'u2' },
      { node: 'Erie', userId: 'u3' },
    ]);
    expect([...out.entries()].sort()).toEqual([['Erie', 1], ['Westwood', 2]]);
  });

  it('a user who could not reach two exits counts for neither', () => {
    const out = exitUnreachableUsers([
      { node: 'Westwood', userId: 'u1' },
      { node: 'Erie', userId: 'u1' },
      { node: 'Westwood', userId: 'u2' },
    ]);
    expect(out.get('Westwood')).toBe(1);
    expect(out.has('Erie')).toBe(false);
  });

  it('repeated failures by one user are still one user', () => {
    const out = exitUnreachableUsers([
      { node: 'Westwood', userId: 'u1' },
      { node: 'Westwood', userId: 'u1' },
    ]);
    expect(out.get('Westwood')).toBe(1);
  });

  it('is empty with no failures', () => {
    expect(exitUnreachableUsers([]).size).toBe(0);
  });
});
