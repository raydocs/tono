import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copy } from './copy';

const SRC = join(import.meta.dirname, '..');
const CJK = /[\u3400-\u9FFF]/;
const FORBIDDEN = ['桶', '差分', 'payload', 'revision', 'schema', 'DTO', 'TODO', 'placeholder', 'undefined', 'NaN'];

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === 'ui') continue;
      walk(path, acc);
    } else {
      acc.push(path);
    }
  }
  return acc;
}

describe('copy', () => {
  it('keeps every CJK glyph out of tsx sources', () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      if (extname(file) !== '.tsx') continue;
      const text = readFileSync(file, 'utf8');
      if (CJK.test(text)) hits.push(file.slice(SRC.length + 1));
    }
    expect(hits).toEqual([]);
  });

  it('does not use internal jargon in operator copy', () => {
    // The whole directory, not just copy.ts: the words moved into four files
    // when the list outgrew one, and a rule that only reads the barrel would
    // have stopped checking them the day they moved.
    for (const file of walk(import.meta.dirname)) {
      if (extname(file) !== '.ts' || file.endsWith('.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      for (const word of FORBIDDEN) {
        expect(text.includes(word), `${file} ${word}`).toBe(false);
      }
    }
  });

  it('exposes the five shell pages', () => {
    expect(Object.keys(copy.pages)).toEqual(['today', 'nodes', 'customers', 'clients', 'settings']);
  });
});
