import { describe, expect, it } from 'vitest';
import { EXIT_SIDE_SQL, exitUnreachableUsers } from '../src/ops/verdict-exit-fails';

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

describe('which failures count as exit-side', () => {
  it('names every client code that means the exit never answered', () => {
    // Windows after the lock, Windows before any tunnel, macOS after the lock.
    for (const code of [
      'TONO_NODE_OR_CORE_UNREACHABLE',
      'TONO_EXIT_UNREACHABLE',
      'CORE_EXIT_UNREACHABLE',
    ]) {
      expect(EXIT_SIDE_SQL).toContain(`'${code}'`);
    }
    expect(EXIT_SIDE_SQL).toContain("LIKE 'tcp connect to the selected exit%'");
  });

  it('does not count the client-side codes', () => {
    for (const code of ['TUN_ROUTE_UNAVAILABLE', 'TONO_CORE_EXITED', 'PROTECTED_DNS_NOT_READY']) {
      expect(EXIT_SIDE_SQL).not.toContain(code);
    }
  });
});
