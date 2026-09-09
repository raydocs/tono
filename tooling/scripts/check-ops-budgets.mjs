#!/usr/bin/env node
// Line budgets for the control-plane ops extraction.
//
// src/index.ts may only shrink (ceiling in test/index-size.txt). Every file
// under src/ops/ is capped at 500 lines, except the three modules that already
// exceeded that when the ratchet landed — those are frozen at their then-current
// size and may only shrink.
//
// Usage: node tooling/scripts/check-ops-budgets.mjs [--root <dir>]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
const OPS_MAX = 500;
const CONTROL_PLANE = 'services/control-plane';

/** Files already over 500 when the ratchet landed. Values are wc -l counts. */
const FROZEN = new Map([
  [`${CONTROL_PLANE}/src/ops/reads.ts`, 620],
  [`${CONTROL_PLANE}/src/ops/router.ts`, 535],
]);

function lineCount(source) {
  if (source.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) n++;
  }
  return n;
}

function walkTs(dir, acc) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, acc);
    else if (name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

export function checkBudgets(root) {
  const findings = [];
  const opsDir = path.join(root, CONTROL_PLANE, 'src', 'ops');
  const files = walkTs(opsDir, []).sort();
  for (const full of files) {
    const relative = path.relative(root, full).split(path.sep).join('/');
    const lines = lineCount(readFileSync(full, 'utf8'));
    const limit = FROZEN.get(relative) ?? OPS_MAX;
    if (lines > limit) {
      findings.push({ file: relative, lines, limit });
    }
  }

  const indexRel = `${CONTROL_PLANE}/src/index.ts`;
  const limitRel = `${CONTROL_PLANE}/test/index-size.txt`;
  const indexLines = lineCount(readFileSync(path.join(root, indexRel), 'utf8'));
  const indexLimit = Number(readFileSync(path.join(root, limitRel), 'utf8').trim());
  if (!Number.isSafeInteger(indexLimit) || indexLimit < 0) {
    findings.push({ file: limitRel, lines: indexLimit, limit: 'a non-negative integer' });
  } else if (indexLines > indexLimit) {
    findings.push({ file: indexRel, lines: indexLines, limit: indexLimit });
  }
  return findings;
}

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? DEFAULT_ROOT : path.resolve(argv[rootFlag + 1]);
  const findings = checkBudgets(root);
  if (findings.length === 0) {
    console.log('ops budgets ok: src/ops ≤ 500 (frozen files may only shrink); index.ts ≤ test/index-size.txt');
    return 0;
  }
  console.error('Ops line budget exceeded. Move code out of src/index.ts into src/ops; keep ops modules under 500 lines.');
  for (const finding of findings) {
    console.error(`  ${finding.file}: ${finding.lines} lines (limit ${finding.limit})`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
