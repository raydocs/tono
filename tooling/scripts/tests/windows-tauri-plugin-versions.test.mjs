import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (name) => readFileSync(new URL(`../../../apps/windows/app/${name}`, import.meta.url), 'utf8')

// `tauri build` refuses a JS plugin whose major.minor differs from its Rust crate,
// and windows-ci never runs `tauri build`, so a split bump only fails the candidate.
test('every locked Tauri JS plugin matches its locked Rust crate minor', () => {
  const lock = read('pnpm-lock.yaml')
  const importer = lock.slice(lock.indexOf('\n  .:\n'), lock.indexOf('\npackages:'))
  const cargo = read('Cargo.lock')
  const minor = (version) => version.split('.').slice(0, 2).join('.')
  const plugins = [...importer.matchAll(/'@tauri-apps\/plugin-([a-z-]+)':\n\s+specifier: \S+\n\s+version: (\d+\.\d+\.\d+)/g)]
  assert.ok(plugins.length > 0, 'no Tauri JS plugins found in the lockfile importer')
  for (const [, name, version] of plugins) {
    const crate = cargo.match(new RegExp(`name = "tauri-plugin-${name}"\\nversion = "(\\d+\\.\\d+\\.\\d+)"`))
    if (!crate) continue // JS-only binding of a plugin the App does not compile
    assert.equal(minor(version), minor(crate[1]), `@tauri-apps/plugin-${name} ${version} vs tauri-plugin-${name} ${crate[1]}`)
  }
})
