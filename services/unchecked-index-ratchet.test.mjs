import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { countTypeScriptErrors, readBaseline, ratchetResult, resolveCommand } from './unchecked-index-ratchet.mjs'

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

test('a Windows node_modules shim uses the .cmd file when the package cannot be resolved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unchecked-index-shim-'))
  writeFileSync(join(dir, 'package.json'), '{"name":"empty","private":true}\n')
  const tsc = resolveCommand(['./node_modules/.bin/tsc', '--noEmit'], { platform: 'win32', cwd: dir })
  assert.equal(tsc.file, './node_modules/.bin/tsc.cmd')
  assert.equal(tsc.shell, true)
  assert.deepEqual(tsc.args, ['--noEmit'])
  const vite = resolveCommand(['./node_modules/.bin/vite', 'build'], { platform: 'win32', cwd: dir })
  assert.equal(vite.file, './node_modules/.bin/vite.cmd')
  assert.equal(vite.shell, true)
  const linux = resolveCommand(['./node_modules/.bin/tsc', '--noEmit'], { platform: 'linux', cwd: dir })
  assert.equal(linux.file, './node_modules/.bin/tsc')
  assert.equal(linux.shell, false)
  const other = resolveCommand(['git', 'status'], { platform: 'win32', cwd: dir })
  assert.equal(other.file, 'git')
  assert.equal(other.shell, false)
})

test('the tsc shim runs typescript/bin/tsc with this node', () => {
  const cwd = fileURLToPath(new URL('./control-plane/', import.meta.url))
  const planned = resolveCommand(['./node_modules/.bin/tsc', '--version'], { platform: 'win32', cwd })
  assert.equal(planned.file, process.execPath)
  assert.equal(planned.shell, false)
  assert.match(planned.args[0], /[/\\]typescript[/\\]bin[/\\]tsc$/)
  assert.deepEqual(planned.args.slice(1), ['--version'])
  const run = spawnSync(planned.file, planned.args, { cwd, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /Version/)
})
