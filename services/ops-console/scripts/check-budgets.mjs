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
const BUDGET = {
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

function kb(bytes) {
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

function distPath(href) {
  return join(DIST, href.replace(/^\/ops2\//, '').replace(/^\//, ''));
}

const failures = [];
const lines = [];

let indexHtml;
try {
  indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
} catch {
  console.error(`check-budgets: no build at ${DIST} — run vite build first.`);
  process.exit(1);
}

const initial = initialScripts(indexHtml)
  .filter((href) => href.endsWith('.js'))
  .map(distPath);
if (initial.length === 0) failures.push('index.html references no module scripts');

const initialGzip = initial.reduce((sum, path) => sum + gzipBytes(path), 0);
lines.push(`initial JS  ${kb(initialGzip).padStart(9)} gzip  / ${kb(BUDGET.initialJsGzip)}  (${initial.length} chunks)`);
if (initialGzip > BUDGET.initialJsGzip) {
  failures.push(`initial JS ${kb(initialGzip)} gzip is over the ${kb(BUDGET.initialJsGzip)} budget`);
}

const allJs = walk(DIST).filter((path) => extname(path) === '.js');
const totalGzip = allJs.reduce((sum, path) => sum + gzipBytes(path), 0);
lines.push(`total JS    ${kb(totalGzip).padStart(9)} gzip  / ${kb(BUDGET.totalJsGzip)}  (${allJs.length} chunks)`);
if (totalGzip > BUDGET.totalJsGzip) {
  failures.push(`total JS ${kb(totalGzip)} gzip is over the ${kb(BUDGET.totalJsGzip)} budget`);
}

const long = walk(SRC)
  .filter((path) => ['.ts', '.tsx', '.css'].includes(extname(path)))
  .filter((path) => !path.includes(`${SRC}/components/ui/`))
  .map((path) => ({ path, count: readFileSync(path, 'utf8').split('\n').length }))
  .filter((row) => row.count > BUDGET.srcFileLines);
lines.push(`src files   ${String(long.length).padStart(9)} over ${BUDGET.srcFileLines} lines`);
for (const row of long) {
  failures.push(`${relative(ROOT, row.path)} is ${row.count} lines, over the ${BUDGET.srcFileLines}-line budget`);
}

console.log(lines.join('\n'));
if (failures.length > 0) {
  console.error(`\ncheck-budgets: ${failures.length} budget violation(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('check-budgets: all budgets green');
