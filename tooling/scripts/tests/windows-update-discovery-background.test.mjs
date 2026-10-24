import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Windows update discovery keeps polling while the window is hidden', () => {
  const source = readFileSync(
    new URL('../../../apps/windows/app/src/hooks/use-update.ts', import.meta.url),
    'utf8',
  )
  assert.match(source, /refetchIntervalInBackground:\s*true/)
  assert.doesNotMatch(source, /refetchIntervalInBackground:\s*false/)
})
