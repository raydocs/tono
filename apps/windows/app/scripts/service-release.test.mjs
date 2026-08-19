import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { resolveServiceRelease } from './service-release.mjs'

test('service prebuild release follows the Cargo dependency version', async () => {
  const cargoManifest = await readFile(
    new URL('../src-tauri/Cargo.toml', import.meta.url),
    'utf8',
  )
  const dependencyVersion = cargoManifest
    .split(/\r?\n/)
    .find((line) => line.startsWith('tono-service-protocol ='))
    ?.match(/\bversion\s*=\s*"([^"]+)"/)?.[1]

  assert.ok(dependencyVersion)
  const releaseVersion = `v${dependencyVersion}`
  assert.deepEqual(
    resolveServiceRelease(cargoManifest, 'x86_64-pc-windows-msvc', 'win32'),
    {
      version: releaseVersion,
      archiveFile: `tono-service-protocol-${releaseVersion}-x86_64-pc-windows-msvc.zip`,
      downloadURL: null,
    },
  )
})

test('service prebuild rejects a dependency without an explicit version', () => {
  assert.throws(
    () =>
      resolveServiceRelease(
        'tono-service-protocol = { path = "../service" }',
        'x86_64-pc-windows-msvc',
        'win32',
      ),
    /must declare an inline version/,
  )
})
