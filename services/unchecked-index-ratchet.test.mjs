import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { countTypeScriptErrors, readBaseline, ratchetResult } from './unchecked-index-ratchet.mjs'

test('counts tsc diagnostic lines and ignores other text', () => {
  const output = [
    'src/a.ts(1,1): error TS2532: Object is possibly \'undefined\'.',
    'note: this is not an error line',
    'src/b.ts(2,2): error TS18048: \'row\' is possibly \'undefined\'.',
  ].join('\n')
  assert.equal(countTypeScriptErrors(output), 2)
  assert.equal(countTypeScriptErrors(''), 0)
})

test('baseline is the first non-comment integer', () => {
  assert.equal(readBaseline('# note\n521\n'), 521)
  assert.throws(() => readBaseline('nope'), /non-negative integer/)
})

test('ratchet fails only when the count rises', () => {
  assert.equal(ratchetResult(521, 521).ok, true)
  assert.equal(ratchetResult(520, 521).ok, true)
  assert.equal(ratchetResult(522, 521).ok, false)
})

test('the command fails closed when the compiler reports one new error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unchecked-index-'))
  const baseline = join(dir, 'baseline')
  writeFileSync(baseline, '0\n')
  const script = new URL('./unchecked-index-ratchet.mjs', import.meta.url)
  const run = spawnSync(process.execPath, [
    script.pathname,
    '--baseline', baseline,
    '--', process.execPath, '-e',
    "console.log('src/a.ts(1,1): error TS2532: Object is possibly undefined.')",
  ], { encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.match(run.stdout, /rose from 0 to 1/)
})
