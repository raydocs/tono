import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

test('Windows release scripts stage every generated resource before the complete packaging gate', () => {
  const ps1 = read('build-windows-release.ps1')
  const psGate = ps1.indexOf("@('release:preflight', '--config-only')")
  const psStage = ps1.indexOf('Copy-Item -LiteralPath $source -Destination $destination -Force')
  assert.ok(psStage >= 0 && psStage < psGate, 'PowerShell must stage Service binaries before preflight')
  const psIdentity = ps1.indexOf("-Destination (Join-Path $resourceRoot 'core-identity.json')")
  assert.ok(psIdentity >= 0 && psIdentity < psGate, 'PowerShell must stage the core identity before preflight')
  assert.ok(psGate < ps1.indexOf("-ArgumentList @('build')"), 'PowerShell must gate before App packaging')

  const sh = read('build-windows-release.sh')
  const shGate = sh.indexOf('release:preflight --config-only')
  const shStage = sh.indexOf('"$app_root/src-tauri/resources/$name.exe"')
  assert.ok(shStage >= 0 && shStage < shGate, 'cross-build must stage Service binaries before preflight')
  const shDirectory = sh.indexOf('/bin/mkdir -p "$app_root/src-tauri/resources"')
  assert.ok(shDirectory >= 0 && shDirectory < sh.indexOf('> "$app_root/src-tauri/resources/core-sha256.txt"'), 'cross-build must create the resource directory before writing its pin')
  const shIdentity = sh.indexOf('"$app_root/src-tauri/resources/core-identity.json"')
  assert.ok(shIdentity >= 0 && shIdentity < shGate, 'cross-build must stage the core identity before preflight')
  assert.ok(shGate < sh.indexOf('cargo tauri build'), 'cross-build must gate before App packaging')
})
