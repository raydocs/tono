// Executes existing Worker crypto/validator, without starting a Worker or using accounts.
// Fixture compatibility is NOT proof that Swift emitted these bytes or ops timeline support.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
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

const cryptoModule = await build({
  entryPoints: [fileURLToPath(new URL('src/crypto.ts', worker))],
  bundle: true, platform: 'node', format: 'esm', write: false,
})
const { sha256 } = await import(`data:text/javascript;base64,${Buffer.from(cryptoModule.outputFiles[0].text).toString('base64')}`)
const yaml = 'opaque'
const json = '{"version":3,"domains":[],"mediaEndpoints":[],"tcpEndpoints":[],"webDomains":[],"directSuffixes":[]}\n'
const expected = {
  producer: 'services/control-plane/src/crypto.ts sha256 (unpadded base64url)',
  catalog: { revision: 7, yaml, sha256: await sha256(yaml) },
  policy: { revision: 8, json, sha256: await sha256(json), signature: null },
}
const fixtureURL = new URL('../Tests/Fixtures/admission.json', import.meta.url)
if (process.argv.includes('--write-digest-fixtures')) {
  await writeFile(fixtureURL, JSON.stringify(expected, null, 2) + '\n')
}
const fixture = JSON.parse(await readFile(fixtureURL, 'utf8'))
assert.deepEqual(fixture, expected, 'Worker digest fixture drift; regenerate explicitly and review')
assert.equal(fixture.catalog.sha256, 'bSKYhMEmi7CrMtjaMV0P5S-RRyKL2DCje8n7KKlUlA0')
assert.notEqual(await sha256(yaml + '\n'), fixture.catalog.sha256)
assert.notEqual(await sha256(json.trimEnd()), fixture.policy.sha256)
assert.match(fixture.policy.sha256, /^[A-Za-z0-9_-]{43}$/)
console.log('Worker SHA-256 contract: catalog/policy fixtures match unpadded base64url; byte-tamper controls differ')
