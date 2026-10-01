// The macOS sing-box input download may retry a dropped connection.
// The pin and the checksum stay mandatory: a retry is not a weaker fetch.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const script = readFileSync(new URL('../prepare-macos-sing-box.sh', import.meta.url), 'utf8')

test('go tarball retries and still checks the pinned sha256', () => {
  assert.match(script, /curl --fail --location --proto '=https' --tlsv1\.2 \\\n {2}--retry 5 --retry-all-errors --retry-delay 2 \\\n/)
  assert.match(script, /63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445/)
  assert.match(script, /sha256sum -c -/)
})

test('pinned sing-box commit is fetched with a bounded retry', () => {
  assert.match(script, /132b38e9caaba1a1959354d518e54d2d08419afe/)
  assert.match(script, /\$attempt" -ge 5/)
  assert.match(script, /pinned sing-box fetch failed/)
})
