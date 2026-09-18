// Exercise the real public Worker producers with disposable encrypted rows.
// No account, network, database connection or production signing key is used.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { createPrivateKey, sign } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const worker = new URL('../../../services/control-plane/', import.meta.url)
const require = createRequire(new URL('package.json', worker))
const { build } = require('esbuild')
const compiled = await build({
  stdin: { contents: `export * from './src/catalog'; export * from './src/traffic-policy'; export * from './src/crypto';`,
    resolveDir: fileURLToPath(worker), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
})
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const source = await readFile(new URL('../Runtime/config_test.go', import.meta.url), 'utf8')
const yaml = source.match(/const fixtureYAML = `([^`]+)`/)[1]
const json = '{"version":4,"domains":[],"mediaEndpoints":[],"tcpEndpoints":[],"webDomains":[],"directSuffixes":[]}'
const key = Buffer.alloc(32, 7).toString('base64url')
const privateKey = createPrivateKey({ key: Buffer.concat([
  Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32),
]), format: 'der', type: 'pkcs8' })
const catalogRow = { revision: 7, updated_at: 1700000000,
  content_sha256: await api.sha256(yaml), ...await api.encryptCatalog(yaml, key) }
const policyRow = { revision: 4, updated_at: 1700000001,
  content_sha256: await api.sha256(json), ...await api.encryptTrafficPolicy(json, key),
  signature: sign(null, Buffer.from(api.TRAFFIC_POLICY_SIGNATURE_CONTEXT + json), privateKey).toString('base64') }
const env = { CATALOG_ENCRYPTION_KEY: key, DB: { prepare(sql) {
  return { bind() { return this }, async first() {
    if (sql.includes('FROM managed_exit_catalog')) return catalogRow
    if (sql.includes('FROM managed_traffic_policy')) return policyRow
    if (sql.includes('FROM home_exit_catalog_names')) return { proxy_names_json: '[]' }
    if (sql.includes('FROM user_home_bindings')) return null
    throw Error('Unexpected producer query: ' + sql)
  } }
} } }
const catalog = await api.publicManagedCatalog(env, { userId: 'fixture', filterHomeExits: true, acceptHy2: true })
const policy = await api.publicTrafficPolicy(env)
assert.equal(catalog.updatedAt, 1700000000)
assert.equal(catalog.routing, undefined)
assert.equal(catalog.routingSha256, await api.routingSha256(undefined))
assert.equal(policy.updatedAt, 1700000001)
assert.equal(policy.signature, policyRow.signature)
// Pass complete serialized producer envelopes to Go. No field-stripping adapter.
await writeFile(process.argv[2], JSON.stringify({ catalog, policy }) + '\n')
console.log('Actual Worker public catalog/policy producers serialized for Go admission')
