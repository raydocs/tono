import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateCoreVersion } from './pinned-core.mjs'

const identity = JSON.parse(readFileSync(new URL('../src-tauri/core-identity.json', import.meta.url), 'utf8'))
const good = `Mihomo Meta ${identity.tonoCoreVersion} windows amd64 with ${identity.goVersion} 2026-09-08T00:00:00Z\nUse tags: ${identity.buildTags.join(' ')}\n`
test('accepts the committed patched Windows identity with either line ending', () => {
  validateCoreVersion(good, identity)
  validateCoreVersion(good.replaceAll('\n', '\r\n'), identity)
})
for (const [name, bad] of [
  ['stock stable core', good.replace(identity.tonoCoreVersion, identity.mihomoUpstreamTag)],
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
