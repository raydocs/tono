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

test('a CRLF lock keeps its line endings', () => {
  const lock = '[[package]]\r\nname = "tono-windows"\r\nversion = "0.0.74"\r\n'

  assert.equal(
    setCargoLockVersion(lock, 'tono-windows', '0.0.75'),
    lock.replace('0.0.74', '0.0.75'),
  )
})

test('a lock that names the package with its version is refused', () => {
  const lock = [
    '[[package]]',
    'name = "tono-windows"',
    'version = "0.0.74"',
    '',
    '[[package]]',
    'name = "consumer"',
    'version = "1.0.0"',
    'dependencies = [',
    ' "tono-windows 0.0.74",',
    ']',
    '',
  ].join('\n')

  assert.throws(() => setCargoLockVersion(lock, 'tono-windows', '0.0.75'))
})

test('only the version value changes, wherever a look-alike line sits', () => {
  const toml = [
    '[package] # the app',
    'description = """',
    'version = "example"',
    '"""',
    'version="0.0.74" # bumped by release-version',
    '',
  ].join('\n')

  assert.equal(
    setCargoPackageVersion(toml, '0.0.75'),
    toml.replace('version="0.0.74"', 'version="0.0.75"'),
  )
})

test('an inherited package version is refused', () => {
  assert.throws(() =>
    setCargoPackageVersion(
      '[package]\nversion = { workspace = true } # version = "old"\n',
      '0.0.75',
    ),
  )
})
