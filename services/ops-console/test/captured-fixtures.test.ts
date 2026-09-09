import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHECKER_BY_NAME, type CheckerName } from '@contract';

const capturedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/captured');

function indexFiles(dir: string): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of entries) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...indexFiles(full));
    else if (name === 'index.json') found.push(full);
  }
  return found;
}

const passthrough = (value: unknown) => value;

describe('captured ops fixtures', () => {
  const indexes = indexFiles(capturedRoot);

  it('commits at least one captured index.json', () => {
    expect(indexes.length, `no index.json under ${capturedRoot}`).toBeGreaterThan(0);
  });

  it('every captured file matches the checker named in index.json', () => {
    expect(indexes.length).toBeGreaterThan(0);
    for (const indexPath of indexes) {
      const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
        routes: Array<{ route: string; file: string; checker: string }>;
      };
      const dir = path.dirname(indexPath);
      expect(index.routes.length, indexPath).toBeGreaterThan(0);
      for (const row of index.routes) {
        const file = path.join(dir, row.file);
        const body = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        const checker = row.checker === 'passthrough'
          ? passthrough
          : CHECKER_BY_NAME[row.checker as CheckerName];
        expect(checker, `${row.route} checker ${row.checker}`).toEqual(expect.any(Function));
        expect(() => checker(body), `${indexPath} ${row.route}`).not.toThrow();
      }
    }
  });
});
