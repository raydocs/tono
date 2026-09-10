#!/usr/bin/env node
/**
 * Markdown size table for the ops-contract PR comment. Reporting only: this
 * exits 0 even when a budget is blown, because `check-budgets.mjs` already
 * gated the build that produced `dist`. A missing dist is a missing report,
 * so that still exits 1 with the same message check-budgets prints.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kb, measureBudgets } from './check-budgets.mjs';
import { indexSize } from '../../../tooling/scripts/check-ops-budgets.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--dist') out.dist = argv[++i];
    else if (flag === '--src') out.src = argv[++i];
    else if (flag === '--root') out.root = argv[++i];
    else if (flag === '--repo') out.repoRoot = argv[++i];
  }
  return out;
}

export function formatBudgetReport(measured, index) {
  const rows = [
    ['check', 'measured', 'budget'],
    ['---', '---:', '---:'],
    ['console initial JS gzip', kb(measured.initialGzip), kb(measured.BUDGET.initialJsGzip)],
    ['console total JS gzip', kb(measured.totalGzip), kb(measured.BUDGET.totalJsGzip)],
    [
      `console files over ${measured.BUDGET.srcFileLines} lines`,
      String(measured.longFiles.length),
      '0',
    ],
    ['Worker src/index.ts lines', String(index.lines), String(index.limit)],
  ];
  return `${rows.map((cols) => `| ${cols.join(' | ')} |`).join('\n')}\n`;
}

export function runBudgetReport({
  dist,
  src,
  root,
  repoRoot = REPO_ROOT,
  log = console.log,
  error = console.error,
} = {}) {
  let measured;
  try {
    measured = measureBudgets({ dist, src, root });
  } catch (err) {
    if (err && err.code === 'NO_BUILD') {
      error(err.message);
      return 1;
    }
    throw err;
  }
  const index = indexSize(repoRoot);
  log(formatBudgetReport(measured, index).trimEnd());
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(runBudgetReport(parseArgs(process.argv.slice(2))));
}
