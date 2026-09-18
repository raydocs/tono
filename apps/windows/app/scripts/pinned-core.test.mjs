import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateCoreVersion, verifyPinnedWindowsCore } from './pinned-core.mjs'

const identity = JSON.parse(readFileSync(new URL('../src-tauri/core-identity.json', import.meta.url), 'utf8'))
const good = 'sing-box version 1.15.0-alpha.3-tono-m1.1\n\nEnvironment: go1.27.1 windows/amd64\nTags: with_gvisor,with_quic,with_utls,with_clash_api\nRevision: 93fff5954390367dd456cad3cbd79be54f8b941f\nCGO: disabled\n'
test('accepts the pinned Windows identity with either line ending and rejects bytes before execution', () => {
  validateCoreVersion(good, identity)
  validateCoreVersion(good.replaceAll('\n', '\r\n'), identity)
  const dir = mkdtempSync(join(tmpdir(), 'tono-core-identity-'))
  try {
    const binary = join(dir, 'not-an-executable')
    writeFileSync(binary, good)
    assert.throws(() => verifyPinnedWindowsCore(binary,
      new URL('../src-tauri/core-identity.json', import.meta.url)), /SHA-256/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
for (const [name, bad] of [
  ['stock upstream core', good.replace(identity.tonoCoreVersion, '1.15.0-alpha.3')],
  ['different patch', good.replace(identity.tonoCoreVersion, `${identity.tonoCoreVersion}0`)],
  ['different Go version', good.replace(identity.goVersion, 'go0.0.0')],
  ['wrong platform', good.replace('windows', 'darwin')],
  ['wrong architecture', good.replace('amd64', 'arm64')],
  ['missing gvisor', good.replace('with_gvisor', '')],
  ['extra build tag', good.replace('with_gvisor', 'with_gvisor unexpected')],
  ['missing output', ''],
]) {
  test(`rejects ${name}`, () => assert.throws(() => validateCoreVersion(bad, identity)))
}
