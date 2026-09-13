#!/usr/bin/env node
// Numeric prefixes on D1 migrations from 0039 upward must be unique. A
// duplicate is the failure 0016/0017/0018 already taught us: two files share a
// number, apply order is lexical, and a restore from an empty database can
// disagree with a restore from a dump. Prefixes below 0039 are exempt — those
// three collisions are historical and must keep their names (see
// services/control-plane/migrations/README.md). Gaps after 0039 are advisory:
// departments are allocated ranges with unused numbers on purpose.
//
// Usage: node tooling/scripts/check-migration-numbers.mjs [--root <dir>] [--dir <dir>]

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
const MIGRATIONS_REL = path.join('services', 'control-plane', 'migrations');
/** First prefix this check owns. 0016/0017/0018 sit below it. */
export const FLOOR = 39;

function pad4(n) {
  return String(n).padStart(4, '0');
}

function migrationsDirFromArgs(argv) {
  const dirFlag = argv.indexOf('--dir');
  if (dirFlag !== -1) return path.resolve(argv[dirFlag + 1]);
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? DEFAULT_ROOT : path.resolve(argv[rootFlag + 1]);
  return path.join(root, MIGRATIONS_REL);
}

/**
 * @param {string} dir directory that holds NNNN_name.sql files
 * @returns {{ duplicates: Map<number, string[]>, missing: number[], numbers: number[] }}
 */
export function checkMigrationNumbers(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql'));
  const byPrefix = new Map();
  for (const name of files) {
    const match = /^(\d+)_/.exec(name);
    if (!match) continue;
    const n = Number(match[1]);
    if (!Number.isInteger(n) || n < FLOOR) continue;
    const list = byPrefix.get(n);
    if (list) list.push(name);
    else byPrefix.set(n, [name]);
  }

  const duplicates = new Map();
  for (const [n, names] of byPrefix) {
    if (names.length > 1) duplicates.set(n, names.slice().sort());
  }

  const numbers = [...byPrefix.keys()].sort((a, b) => a - b);
  const max = numbers.length === 0 ? FLOOR - 1 : numbers[numbers.length - 1];
  const missing = [];
  for (let n = FLOOR; n <= max; n++) {
    if (!byPrefix.has(n)) missing.push(n);
  }

  return { duplicates, missing, numbers };
}

function main(argv) {
  const dir = migrationsDirFromArgs(argv);
  const { duplicates, missing } = checkMigrationNumbers(dir);

  if (duplicates.size > 0) {
    console.error('duplicate migration prefixes from 0039 upward:');
    for (const n of [...duplicates.keys()].sort((a, b) => a - b)) {
      console.error(`  ${pad4(n)}: ${duplicates.get(n).join(', ')}`);
    }
    return 1;
  }

  if (missing.length > 0) {
    const listed = missing.map(pad4).join(', ');
    // GitHub Actions warning annotation: gaps are advisory, not a hard failure.
    console.log(`::warning::migration number gaps from 0039: missing ${listed}`);
    return 0;
  }

  console.log('migration numbers from 0039: unique and contiguous');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
