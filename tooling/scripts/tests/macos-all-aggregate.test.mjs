import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// test-macos-all.sh is a zsh script. The Linux services job has no zsh, so these
// skip there; macos-ci runs this file by name, where they do run.
const hasZsh = spawnSync('zsh', ['-c', 'true']).status === 0
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const aggregateSource = fileURLToPath(new URL('../test-macos-all.sh', import.meta.url))

// A repository holding only the aggregate and the stubs given: every suite it
// does not find fails, which is fine, the assertions look at single lines.
function aggregate(stubs, env = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'tono-macos-all-'))
  try {
    const scripts = path.join(root, 'tooling/scripts')
    const bin = path.join(root, 'bin')
    mkdirSync(scripts, { recursive: true })
    mkdirSync(bin, { recursive: true })
    const script = path.join(scripts, 'test-macos-all.sh')
    copyFileSync(aggregateSource, script)
    writeFileSync(path.join(bin, 'xcodebuild'), '#!/bin/sh\nexit 1\n')
    chmodSync(path.join(bin, 'xcodebuild'), 0o755)
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(path.join(scripts, name), `#!/bin/sh\n${body}\n`)
      chmodSync(path.join(scripts, name), 0o755)
    }
    const baseEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
    for (const key of ['TONO_TEST_SIGNED_APP', 'TONO_TEST_INSTALL_SCRIPT', 'TONO_TEST_RUNTIME_YAML']) delete baseEnv[key]
    return spawnSync('zsh', [script], { encoding: 'utf8', timeout: 30000, env: { ...baseEnv, ...env } }).stdout
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a suite that exits 0 after printing SKIP is reported as skipped, not passed',
  { skip: !hasZsh && 'zsh is not installed' }, () => {
    // T4-AGGREGATE-HIDDEN-SKIP: the log was thrown away on success, so the
    // peer-authorization suite's intentional skip counted as a pass.
    const output = aggregate({
      'test-helper-peer-authorization.sh':
        'echo "SKIP: no Apple Development identity for the Tono team" >&2; exit 0',
      'test-subscription-url-policy.sh': 'echo "all good"; exit 0',
    })
    assert.match(output, /skipped {2}helper peer authorization .*no Apple Development identity/)
    assert.doesNotMatch(output, /ok {7}helper peer authorization/)
    assert.match(output, /ok {7}subscription url policy/)
  })

test('the install lifecycle names the emitted install script it needs, not only the app',
  { skip: (!hasZsh && 'zsh is not installed') || (isRoot && 'runs as root') }, () => {
    // T4-AGGREGATE-INSTALL-INPUT: the aggregate passed --app alone, but as root
    // the lifecycle script cannot emit the install script and needs --script.
    const output = aggregate({}, { TONO_TEST_SIGNED_APP: '/Applications/Tono.app' })
    assert.match(output, /skipped {2}helper install lifecycle .*TONO_TEST_INSTALL_SCRIPT/)
  })
