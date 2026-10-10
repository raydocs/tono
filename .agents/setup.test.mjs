import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// Run the public setup entry with real, offline npm and disposable data.
// System/toolchain and pnpm provisioning are external boundaries, not under test.
test('setup reuses only matching intact installs and propagates a locked install failure', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tono-setup-'))
  const home = path.join(root, 'home')
  const bin = path.join(home, '.local/share/tono/node-v24.18.0/bin')
  const put = (file, text, mode) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text, { mode })
  }
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, npm_config_offline: 'true', npm_config_cache: path.join(home, 'npm-cache') }
  const run = (command, args) => spawnSync(command, args, { cwd: root, env, encoding: 'utf8' })
  const setup = () => run('bash', ['.agents/setup'])
  const control = path.join(root, 'services/control-plane')
  const marker = path.join(control, 'node_modules/.tono-orb-dependencies')
  try {
    mkdirSync(bin, { recursive: true })
    symlinkSync(process.execPath, path.join(bin, 'node'))
    const npmPath = spawnSync('bash', ['-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim()
    symlinkSync(realpathSync(npmPath), path.join(bin, 'npm'))
    put(path.join(bin, 'corepack'), '#!/bin/sh\nexit 0\n', 0o755)
    put(path.join(bin, 'pnpm'), '#!/bin/sh\necho "11.26.0 (fixture)"\n', 0o755)
    put(path.join(bin, 'dpkg-query'), '#!/bin/sh\necho "install ok installed"\n', 0o755)
    put(path.join(root, '.agents/setup'), '')
    copyFileSync(new URL('./setup', import.meta.url), path.join(root, '.agents/setup'))
    put(path.join(root, 'fixture-lib/package.json'), JSON.stringify({ name: 'fixture-lib', version: '1.0.0' }))
    for (const workspace of ['services/control-plane', 'services/ops-console']) {
      put(path.join(root, workspace, 'package.json'), JSON.stringify({ name: workspace.split('/')[1], version: '1.0.0', dependencies: { 'fixture-lib': 'file:../../fixture-lib' } }))
      const lock = run('npm', ['--prefix', workspace, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'])
      assert.equal(lock.status, 0, lock.stdout + lock.stderr)
    }
    put(path.join(root, 'apps/windows/app/package.json'), JSON.stringify({ packageManager: 'pnpm@11.26.0' }))
    mkdirSync(path.join(root, 'apps/windows/crates/tono-plugin-core'), { recursive: true })
    put(path.join(control, '.dev.vars.example'), '# Synthetic test only\n')

    const first = setup()
    assert.equal(first.status, 0, first.stdout + first.stderr)
    const original = readFileSync(marker, 'utf8')
    const warm = setup()
    assert.equal(warm.status, 0, warm.stdout + warm.stderr)
    assert.match(warm.stdout, /Reusing locked dependencies for services\/control-plane/)

    // A deleted dependency must repair even if the successful fingerprint matches.
    rmSync(path.join(control, 'node_modules/fixture-lib'))
    const repaired = setup()
    assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr)
    assert.doesNotMatch(repaired.stdout, /Reusing locked dependencies for services\/control-plane/)

    // A changed, valid lockfile must reinstall, not keep the old success marker.
    const lockPath = path.join(control, 'package-lock.json')
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    lock.packages[''].license = 'MIT'
    put(lockPath, JSON.stringify(lock))
    const changed = setup()
    assert.equal(changed.status, 0, changed.stdout + changed.stderr)
    assert.notEqual(readFileSync(marker, 'utf8'), original)
    assert.doesNotMatch(changed.stdout, /Reusing locked dependencies for services\/control-plane/)

    // Invalid lock data is an installation failure, never "setup complete".
    put(lockPath, '{ invalid JSON')
    const failed = setup()
    assert.notEqual(failed.status, 0)
    assert.doesNotMatch(failed.stdout, /Tono orb setup complete/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
