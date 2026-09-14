// Executes the existing Worker validator, without starting a Worker or using accounts.
// Fixture compatibility is NOT proof that Swift emitted these bytes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const repo = new URL('../../../', import.meta.url)
const worker = new URL('services/control-plane/', repo)
const require = createRequire(new URL('package.json', worker))
const { build } = require('esbuild')
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('src/telemetry-window.ts', worker))],
  bundle: true, platform: 'node', format: 'esm', write: false,
})
const { canonicalTelemetryWindow } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const { window } = JSON.parse(await readFile(new URL('../Tests/Fixtures/telemetry.json', import.meta.url), 'utf8'))
const result = canonicalTelemetryWindow(window)
assert.equal(JSON.parse(result.json).platform, 'ios')
assert.equal(JSON.parse(result.json).events[0].code, 'coreUnavailable')
assert.throws(() => canonicalTelemetryWindow({ ...window, events: [{ ...window.events[0], email: 'canary@example.invalid' }] }))
assert.throws(() => canonicalTelemetryWindow({ ...window, events: [{ ...window.events[0], refreshToken: 'CANARY' }] }))
assert.throws(() => canonicalTelemetryWindow({ ...window, platform: 'unrecognized' }))
console.log('Worker telemetry contract: iOS fixture accepted; identity/token/unknown-platform negative controls rejected')
