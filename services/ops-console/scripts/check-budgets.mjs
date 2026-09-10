#!/usr/bin/env node
/**
 * Size and shape budgets, run straight after `vite build` so a build that
 * blows them fails instead of shipping.
 *
 *   - initial JS  <= 400 KB gzip  (the entry chunk plus everything the HTML
 *                                  preloads, i.e. what the first paint costs)
 *   - total JS    <= 600 KB gzip  (every chunk, lazy routes included)
 *   - src file    <= 400 lines
 *
 * Gzip is the honest unit here: the console is served through Cloudflare and
 * nobody downloads the raw bytes.
 */
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, '../control-plane/public/ops2');
const SRC = join(ROOT, 'src');

const KB = 1024;
export const BUDGET = {
  initialJsGzip: 400 * KB,
  totalJsGzip: 600 * KB,
  srcFileLines: 400,
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

function gzipBytes(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

export function kb(bytes) {
  return `${(bytes / KB).toFixed(1)} KB`;
}

/**
 * What the browser fetches before it can paint: the entry module plus every
 * chunk the HTML asks it to preload. Lazily imported routes are deliberately
 * not in here — that is the point of splitting them.
 */
function initialScripts(html) {
  const out = new Set();
  const patterns = [
    /<script[^>]+type="module"[^>]+src="([^"]+)"/g,
    /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) out.add(match[1]);
  }
  return [...out];
}

function distPath(dist, href) {
  return join(dist, href.replace(/^\/ops2\//, '').replace(/^\//, ''));
}

/**
 * Measure the console against BUDGET. Throws with `code: 'NO_BUILD'` when
 * dist/index.html is missing — the same message the CLI has always printed.
 */
export function measureBudgets({ dist = DIST, src = SRC, root = ROOT } = {}) {
  const failures = [];
  const lines = [];

  let indexHtml;
  try {
    indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
  } catch {
    const error = new Error(`check-budgets: no build at ${dist} — run vite build first.`);
    error.code = 'NO_BUILD';
    throw error;
  }

  const initial = initialScripts(indexHtml)
    .filter((href) => href.endsWith('.js'))
    .map((href) => distPath(dist, href));
  if (initial.length === 0) failures.push('index.html references no module scripts');

  const initialGzip = initial.reduce((sum, path) => sum + gzipBytes(path), 0);
  lines.push(`initial JS  ${kb(initialGzip).padStart(9)} gzip  / ${kb(BUDGET.initialJsGzip)}  (${initial.length} chunks)`);
  if (initialGzip > BUDGET.initialJsGzip) {
    failures.push(`initial JS ${kb(initialGzip)} gzip is over the ${kb(BUDGET.initialJsGzip)} budget`);
  }

  const allJs = walk(dist).filter((path) => extname(path) === '.js');
  const totalGzip = allJs.reduce((sum, path) => sum + gzipBytes(path), 0);
  lines.push(`total JS    ${kb(totalGzip).padStart(9)} gzip  / ${kb(BUDGET.totalJsGzip)}  (${allJs.length} chunks)`);
  if (totalGzip > BUDGET.totalJsGzip) {
    failures.push(`total JS ${kb(totalGzip)} gzip is over the ${kb(BUDGET.totalJsGzip)} budget`);
  }

  const longFiles = walk(src)
    .filter((path) => ['.ts', '.tsx', '.css'].includes(extname(path)))
    .filter((path) => !path.includes(`${src}/components/ui/`))
    .map((path) => ({ path, count: readFileSync(path, 'utf8').split('\n').length }))
    .filter((row) => row.count > BUDGET.srcFileLines);
  lines.push(`src files   ${String(longFiles.length).padStart(9)} over ${BUDGET.srcFileLines} lines`);
  for (const row of longFiles) {
    failures.push(`${relative(root, row.path)} is ${row.count} lines, over the ${BUDGET.srcFileLines}-line budget`);
  }

  return {
    initialGzip,
    initialChunks: initial.length,
    totalGzip,
    totalChunks: allJs.length,
    longFiles: longFiles.map((row) => ({ path: relative(root, row.path), count: row.count })),
    BUDGET,
    lines,
    failures,
  };
}

function main() {
  let measured;
  try {
    measured = measureBudgets();
  } catch (error) {
    if (error && error.code === 'NO_BUILD') {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  console.log(measured.lines.join('\n'));
  if (measured.failures.length > 0) {
    console.error(`\ncheck-budgets: ${measured.failures.length} budget violation(s)`);
    for (const failure of measured.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('check-budgets: all budgets green');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
