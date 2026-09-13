import { describe, expect, it } from 'vitest';
import envSource from '../src/env.ts?raw';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options?: { query?: string; import?: string; eager?: boolean },
    ): Record<string, string>;
  }
}

const srcFiles = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const KEY = /RATE_LIMIT_[A-Z_]+/g;
const DECLARED = /^\s+(RATE_LIMIT_[A-Z_]+)\?:/gm;

function keysIn(text: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(re)) out.add(match[1] ?? match[0]);
  return out;
}

describe('RATE_LIMIT_* declared vs used', () => {
  it('every Env RATE_LIMIT_* key is a literal in src, and every used key is declared', () => {
    const paths = Object.keys(srcFiles);
    expect(paths.length, 'import.meta.glob ../src/**/*.ts?raw should resolve under the vitest pool').toBeGreaterThan(0);

    const declared = keysIn(envSource, DECLARED);
    expect(declared.size).toBeGreaterThan(0);

    const used = new Set<string>();
    for (const [path, text] of Object.entries(srcFiles)) {
      if (path.endsWith('/env.ts') || path.endsWith('\\env.ts')) continue;
      for (const key of keysIn(text, KEY)) used.add(key);
    }

    const unused = [...declared].filter((key) => !used.has(key)).sort();
    const undeclared = [...used].filter((key) => !declared.has(key)).sort();
    expect(unused, `declared but never used: ${unused.join(', ')}`).toEqual([]);
    expect(undeclared, `used but not declared on Env: ${undeclared.join(', ')}`).toEqual([]);
  });
});
