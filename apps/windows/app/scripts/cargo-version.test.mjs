import assert from 'node:assert/strict'
import test from 'node:test'

import {
  setCargoLockVersion,
  setCargoPackageVersion,
} from './cargo-version.mjs'

test('only the [package] version is rewritten', () => {
  const toml = [
    '[package]',
    'name = "tono-windows"',
    'version = "0.0.74"',
    '',
    '[dependencies.windows]',
    'version = "0.61"',
    'features = ["Win32_Foundation"]',
    '',
  ].join('\n')

  assert.equal(
    setCargoPackageVersion(toml, '0.0.75'),
    toml.replace('version = "0.0.74"', 'version = "0.0.75"'),
  )
})

test('the lock entry of the local package follows the bump', () => {
  const lock = [
    '[[package]]',
    'name = "tono-core"',
    'version = "0.0.74"',
    '',
    '[[package]]',
    'name = "tono-windows"',
    'version = "0.0.74"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    '',
    '[[package]]',
    'name = "tono-windows"',
    'version = "0.0.74"',
    'dependencies = [',
    ' "tono-core",',
    ']',
    '',
  ].join('\n')

  const bumped = setCargoLockVersion(lock, 'tono-windows', '0.0.75')

  assert.equal(
    bumped,
    lock.replace(
      'version = "0.0.74"\ndependencies',
      'version = "0.0.75"\ndependencies',
    ),
  )
})
