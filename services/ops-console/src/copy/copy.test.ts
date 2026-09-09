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
    const text = readFileSync(join(import.meta.dirname, 'copy.ts'), 'utf8');
    for (const word of FORBIDDEN) {
      expect(text.includes(word), word).toBe(false);
    }
  });

  it('exposes the five shell pages', () => {
    expect(Object.keys(copy.pages)).toEqual(['today', 'nodes', 'customers', 'clients', 'settings']);
  });
});
