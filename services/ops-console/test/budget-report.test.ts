import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BUDGET, kb, measureBudgets } from '../scripts/check-budgets.mjs';
import { formatBudgetReport } from '../scripts/budget-report.mjs';
import { indexSize } from '../../../tooling/scripts/check-ops-budgets.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/budget-report.mjs');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A tiny console build plus a src tree the reporter can measure. */
function fakeBuild(opts: { initialBytes?: Buffer; extraChunk?: boolean; longSrc?: boolean } = {}) {
  const root = tempDir('budget-report-');
  const dist = join(root, 'dist');
  const src = join(root, 'src');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(src, { recursive: true });
  const initial = opts.initialBytes ?? Buffer.from('export const n = 1;\n');
  writeFileSync(join(dist, 'assets', 'index.js'), initial);
  writeFileSync(join(dist, 'assets', 'vendor.js'), 'export const v = 2;\n');
  if (opts.extraChunk) writeFileSync(join(dist, 'assets', 'lazy.js'), 'export const l = 3;\n');
  writeFileSync(
    join(dist, 'index.html'),
    `<!doctype html><html><head>
<link rel="modulepreload" href="/ops2/assets/vendor.js">
</head><body>
<script type="module" src="/ops2/assets/index.js"></script>
</body></html>\n`,
  );
  writeFileSync(join(src, 'ok.ts'), 'export const ok = 1;\n');
  if (opts.longSrc) {
    writeFileSync(join(src, 'long.ts'), `${'export const x = 1;\n'.repeat(BUDGET.srcFileLines + 1)}`);
  }
  return { root, dist, src };
}

function runReport(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('budget-report', () => {
  it('prints a table whose numbers equal the exported measurement', () => {
    const fake = fakeBuild({ extraChunk: true, longSrc: true });
    const measured = measureBudgets({ dist: fake.dist, src: fake.src, root: fake.root });
    const index = indexSize(REPO);
    const result = runReport([
      '--dist', fake.dist,
      '--src', fake.src,
      '--root', fake.root,
      '--repo', REPO,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(formatBudgetReport(measured, index).trimEnd() + '\n');
    expect(result.stdout).toContain(kb(measured.initialGzip));
    expect(result.stdout).toContain(kb(measured.totalGzip));
    expect(result.stdout).toContain(kb(measured.BUDGET.initialJsGzip));
    expect(result.stdout).toContain(kb(measured.BUDGET.totalJsGzip));
    expect(result.stdout).toContain(String(measured.longFiles.length));
    expect(result.stdout).toContain(String(index.lines));
    expect(result.stdout).toContain(String(index.limit));
    expect(measured.longFiles.length).toBe(1);
    expect(measured.totalChunks).toBe(3);
  });

  // Missing dist is a missing report, not an empty table: same message and
  // non-zero exit as check-budgets.mjs. Swallowing it would post a comment
  // with no numbers.
  it('exits non-zero with the check-budgets message when dist is missing', () => {
    const missing = join(tempDir('budget-report-missing-'), 'ops2');
    const result = runReport(['--dist', missing]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`check-budgets: no build at ${missing} — run vite build first.`);
  });

  it('exits 0 even when the measured build is over budget', () => {
    const bulky = randomBytes(500 * 1024);
    const fake = fakeBuild({ initialBytes: bulky });
    const measured = measureBudgets({ dist: fake.dist, src: fake.src, root: fake.root });
    expect(measured.initialGzip).toBeGreaterThan(measured.BUDGET.initialJsGzip);
    const result = runReport([
      '--dist', fake.dist,
      '--src', fake.src,
      '--root', fake.root,
      '--repo', REPO,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(kb(measured.initialGzip));
  });
});
