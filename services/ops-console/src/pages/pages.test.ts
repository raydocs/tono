import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGES = import.meta.dirname;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

describe('pages do not format numbers themselves', () => {
  it('contains no toFixed or toLocaleString', () => {
    const hits: string[] = [];
    for (const file of walk(PAGES)) {
      if (!['.ts', '.tsx'].includes(extname(file))) continue;
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const text = readFileSync(file, 'utf8');
      if (text.includes('toFixed') || text.includes('toLocaleString')) {
        hits.push(file.slice(PAGES.length));
      }
    }
    expect(hits).toEqual([]);
  });
});
