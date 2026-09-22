import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { assembleManifest, measureTarget, readManifest, verifyManifest, writeBundle } from '../desktop-update-v1.mjs'

const fixture = await readFile(new URL('./fixtures/update-protocol-v1/manifest.json', import.meta.url))
const source = JSON.parse(fixture)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const macosKeys = generateKeyPairSync('ed25519')
const windowsKeys = generateKeyPairSync('ed25519')

function measurement(target) {
  return {
    kind: 'tonoUpdateTargetMeasurement', appVersion: source.appVersion,
    buildCommit: source.buildCommit, releaseSequence: source.releaseSequence, target,
  }
}

function inputs() {
  return {
    macos: measurement(source.targets[0]), windows: measurement(source.targets[1]),
    buildCommit: source.buildCommit, releaseId: source.releaseId, releaseSequence: source.releaseSequence,
  }
}

function signed(bytes) {
  // Generated test-only keys; neither key is a production trust input. Exercise
  // the actual existing verifier with a prehashed minisign box and trusted comment.
  const rawKey = key => key.export({ format: 'der', type: 'spki' }).subarray(-32)
  const keyId = Buffer.from('0102030405060708', 'hex')
  const publicBox = Buffer.concat([Buffer.from('Ed'), keyId, rawKey(windowsKeys.publicKey)])
  const signature = sign(null, createHash('blake2b512').update(bytes).digest(), windowsKeys.privateKey)
  const packet = Buffer.concat([Buffer.from('ED'), keyId, signature])
  const comment = 'timestamp:1900000000\tfile:manifest.json'
  const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(comment)]), windowsKeys.privateKey)
  const box = `untrusted comment: synthetic test signature\n${packet.toString('base64')}\ntrusted comment: ${comment}\n${globalSignature.toString('base64')}\n`
  return {
    bytes,
    macosSignature: sign(null, bytes, macosKeys.privateKey).toString('base64'),
    macosPublicKey: rawKey(macosKeys.publicKey).toString('base64'),
    windowsSignature: Buffer.from(box).toString('base64'),
    windowsPublicKey: Buffer.from(`untrusted comment: synthetic test key\n${publicBox.toString('base64')}\n`).toString('base64'),
  }
}

test('publisher produces the exact common native manifest and rejects malformed wire bytes', async () => {
  assert.deepEqual(assembleManifest(inputs()), fixture)
  assert.deepEqual(readManifest(fixture), source)
  const cases = JSON.parse(await readFile(new URL('./fixtures/update-protocol-v1/conformance.json', import.meta.url)))
  for (const item of cases.rejectedDocuments.filter(item => item.document === 'manifest.json')) {
    assert.throws(() => readManifest(Buffer.from(fixture.toString().replaceAll(item.find, item.replace))), item.name)
  }
  const malformed = structuredClone(source)
  malformed.targets[0].components = {
    'appSha256,coreSha256': '1'.repeat(64), privilegedSha256: '3'.repeat(64),
  }
  assert.throws(() => readManifest(Buffer.from(`${JSON.stringify(malformed)}\n`)), /component digests/)
  assert.throws(() => readManifest(Buffer.alloc(16_385)), /byte limit/)
})

test('pairing refuses independently built source, version and sequence rather than relabelling one target', () => {
  const value = inputs()
  assert.throws(() => assembleManifest({ ...value, windows: { ...value.windows, buildCommit: 'f'.repeat(40) } }), /same exact source SHA/)
  assert.throws(() => assembleManifest({ ...value, windows: { ...value.windows, appVersion: '0.0.74' } }), /versions differ/)
  assert.throws(() => assembleManifest({ ...value, windows: { ...value.windows, releaseSequence: 73 } }), /same release sequence/)
  assert.deepEqual(assembleManifest(value), fixture)
})

test('both platform signatures must bind the same complete manifest, including the release sequence', () => {
  const value = signed(fixture)
  assert.deepEqual(verifyManifest(value), source)
  const changed = Buffer.from(fixture.toString().replace('"releaseSequence":74', '"releaseSequence":75'))
  assert.throws(() => verifyManifest({ ...value, bytes: changed }), /does not verify/)
  const other = signed(changed)
  assert.throws(() => verifyManifest({ ...value, windowsSignature: other.windowsSignature }), /does not match/)
  assert.throws(() => verifyManifest({ ...value, windowsSignature: '' }))
  assert.throws(() => verifyManifest({ ...value, macosSignature: '' }))
})

test('actual measured package bytes survive a signed bundle; tampering cannot produce a discovery pointer', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tono-update-bundle-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const macosArtifact = path.join(root, 'mac.zip')
  const windowsArtifact = path.join(root, 'win.exe')
  const app = path.join(root, 'app')
  const core = path.join(root, 'core')
  const privileged = path.join(root, 'privileged')
  const macBytes = Buffer.from('ZIP synthetic archive bytes: macOS, NOT an installable candidate')
  const windowsBytes = Buffer.from('MZ synthetic package bytes: Windows, NOT an installable candidate')
  await writeFile(macosArtifact, macBytes)
  await writeFile(windowsArtifact, windowsBytes)
  await writeFile(app, 'application bytes')
  await writeFile(core, 'different core bytes')
  await writeFile(privileged, 'privileged executable bytes')
  const common = { appVersion: source.appVersion, buildCommit: source.buildCommit, releaseSequence: 74, app, core, privileged }
  const macos = await measureTarget({ ...common, targetId: 'macos-arm64', artifact: macosArtifact })
  const windows = await measureTarget({ ...common, targetId: 'windows-x86_64', artifact: windowsArtifact })
  assert.equal(macos.target.artifactSha256, hash(macBytes))
  assert.equal(windows.target.artifactSha256, hash(windowsBytes))
  assert.equal(macos.target.artifactSizeBytes, macBytes.length)
  assert.deepEqual(macos.target.components, {
    appSha256: hash('application bytes'), coreSha256: hash('different core bytes'),
    privilegedSha256: hash('privileged executable bytes'),
  })
  const bytes = assembleManifest({ ...inputs(), macos, windows })
  const signatures = signed(bytes)
  const output = path.join(root, 'bundle')
  const digest = await writeBundle({ ...signatures, output, macosArtifact, windowsArtifact })
  assert.equal(digest, hash(bytes))
  const immutable = path.join(output, 'desktop/v1', digest)
  assert.deepEqual(await readFile(path.join(immutable, 'package.macos-arm64.zip')), macBytes)
  assert.deepEqual(await readFile(path.join(immutable, 'package.windows-x86_64.exe')), windowsBytes)
  assert.deepEqual(await readFile(path.join(output, 'desktop/v1/latest/manifest.json')), bytes)
  assert.deepEqual(verifyManifest({
    ...signatures, bytes: await readFile(path.join(immutable, 'manifest.json')),
    macosSignature: await readFile(path.join(immutable, 'manifest.macos-arm64.sig'), 'utf8'),
    windowsSignature: await readFile(path.join(immutable, 'manifest.windows-x86_64.sig'), 'utf8'),
  }), JSON.parse(bytes))
  await assert.rejects(writeBundle({ ...signatures, output, macosArtifact, windowsArtifact }), /EEXIST/)
  await writeFile(windowsArtifact, Buffer.alloc(windowsBytes.length, 42))
  const refused = path.join(root, 'tampered')
  await assert.rejects(writeBundle({ ...signatures, output: refused, macosArtifact, windowsArtifact }), /does not match/)
  await assert.rejects(stat(refused), /ENOENT/)
})
