import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdir, open, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { verifyUpdaterSignature } from '../../apps/windows/app/scripts/prepare-updater-config.mjs'
import { readSparklePublicKey, verifyEnclosureSignature } from './publish-macos-appcast.mjs'

const MAX_DOCUMENT_BYTES = 16_384
const MAX_ARTIFACT_BYTES = 4_294_967_296
const TARGETS = ['macos-arm64', 'windows-x86_64']
const PACKAGE_NAMES = ['package.macos-arm64.zip', 'package.windows-x86_64.exe']

function requireValue(condition, reason) {
  if (!condition) throw new Error(reason)
}

function identifier(value, max) {
  return typeof value === 'string' && value.length <= max && /^[A-Za-z0-9._:-]+$/.test(value)
}

function hex(value, length) {
  return typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value)
}

function exactKeys(value, keys) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function sequence(value) {
  requireValue(Number.isSafeInteger(value) && value > 0, 'releaseSequence must be a positive safe integer')
}

function targetShape(target, expectedId) {
  requireValue(exactKeys(target, ['id', 'artifactSha256', 'artifactSizeBytes', 'components']), 'invalid target fields')
  requireValue(target.id === expectedId, `expected target ${expectedId}`)
  requireValue(hex(target.artifactSha256, 64), 'invalid artifact digest')
  requireValue(Number.isSafeInteger(target.artifactSizeBytes)
    && target.artifactSizeBytes > 0 && target.artifactSizeBytes <= MAX_ARTIFACT_BYTES, 'invalid artifact size')
  requireValue(exactKeys(target.components, ['appSha256', 'coreSha256', 'privilegedSha256'])
    && Object.values(target.components).every(value => hex(value, 64)), 'invalid component digests')
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]))
  }
  return value
}

function canonical(value) {
  return Buffer.from(`${JSON.stringify(sorted(value))}\n`)
}

// Publisher-side format validation. Native signature/admission/store tests remain
// independent; this writer is not a replacement for either native decoder.
export function readManifest(bytes) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length <= MAX_DOCUMENT_BYTES, 'manifest exceeds byte limit')
  const value = JSON.parse(bytes.toString('utf8'))
  requireValue(exactKeys(value, ['appVersion', 'buildCommit', 'kind', 'protocolVersion', 'releaseId', 'releaseSequence', 'targets']), 'invalid manifest fields')
  requireValue(value.kind === 'tonoUpdateManifest' && value.protocolVersion === 1, 'unsupported manifest')
  requireValue(identifier(value.appVersion, 64) && identifier(value.releaseId, 128)
    && hex(value.buildCommit, 40), 'invalid release identity')
  sequence(value.releaseSequence)
  requireValue(Array.isArray(value.targets) && value.targets.length === 2, 'both native targets are required')
  requireValue(new Set(value.targets.map(target => target?.id)).size === 2, 'duplicate target')
  for (const target of value.targets) {
    requireValue(TARGETS.includes(target?.id), 'unsupported native target')
    targetShape(target, target.id)
  }
  requireValue(canonical(value).equals(bytes), 'manifest is not canonical exact bytes')
  return value
}

async function digestFile(file) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    requireValue(before.isFile() && before.size > 0 && before.size <= MAX_ARTIFACT_BYTES, 'expected a nonempty bounded regular file')
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of createReadStream(file, { fd: handle.fd, autoClose: false })) {
      size += chunk.length
      requireValue(size <= MAX_ARTIFACT_BYTES, 'file grew beyond byte limit')
      hash.update(chunk)
    }
    const after = await handle.stat()
    requireValue(size === before.size && size === after.size
      && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'file changed while being measured')
    return { sha256: hash.digest('hex'), size }
  } finally {
    await handle.close()
  }
}

export async function measureTarget({ appVersion, buildCommit, releaseSequence, targetId, artifact, app, core, privileged }) {
  requireValue(identifier(appVersion, 64) && hex(buildCommit, 40), 'invalid measurement identity')
  sequence(releaseSequence)
  requireValue(TARGETS.includes(targetId), 'unsupported native target')
  const packageBytes = await digestFile(artifact)
  return {
    kind: 'tonoUpdateTargetMeasurement', appVersion, buildCommit, releaseSequence,
    target: {
      id: targetId, artifactSha256: packageBytes.sha256, artifactSizeBytes: packageBytes.size,
      components: {
        appSha256: (await digestFile(app)).sha256,
        coreSha256: (await digestFile(core)).sha256,
        privilegedSha256: (await digestFile(privileged)).sha256,
      },
    },
  }
}

export function assembleManifest({ macos, windows, buildCommit, releaseId, releaseSequence }) {
  requireValue(hex(buildCommit, 40) && identifier(releaseId, 128), 'invalid release identity')
  sequence(releaseSequence)
  const reports = [macos, windows]
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index]
    requireValue(exactKeys(report, ['kind', 'appVersion', 'buildCommit', 'releaseSequence', 'target'])
      && report.kind === 'tonoUpdateTargetMeasurement', 'invalid native measurement')
    requireValue(report.buildCommit === buildCommit, 'native packages must come from the same exact source SHA')
    requireValue(report.releaseSequence === releaseSequence, 'native packages must use the same release sequence')
    requireValue(identifier(report.appVersion, 64) && report.appVersion === macos.appVersion, 'native package versions differ')
    targetShape(report.target, TARGETS[index])
  }
  const bytes = canonical({
    kind: 'tonoUpdateManifest', protocolVersion: 1, appVersion: macos.appVersion,
    buildCommit, releaseId, releaseSequence, targets: reports.map(report => report.target),
  })
  readManifest(bytes)
  return bytes
}

export function verifyManifest({ bytes, macosSignature, windowsSignature, macosPublicKey, windowsPublicKey }) {
  const manifest = readManifest(bytes)
  requireValue(typeof macosSignature === 'string' && Buffer.byteLength(macosSignature) <= 4096
    && typeof windowsSignature === 'string' && Buffer.byteLength(windowsSignature) <= 4096, 'signature exceeds byte limit')
  verifyEnclosureSignature(readSparklePublicKey({ SUPublicEDKey: macosPublicKey }), macosSignature, bytes, { fileName: 'manifest.json' })
  verifyUpdaterSignature(windowsPublicKey, windowsSignature.trim(), bytes)
  return manifest
}

async function verifyPackage(file, target) {
  const actual = await digestFile(file)
  requireValue(actual.size === target.artifactSizeBytes && actual.sha256 === target.artifactSha256,
    `${target.id} package does not match the signed manifest`)
}

export async function writeBundle({ output, macosArtifact, windowsArtifact, ...signed }) {
  const manifest = verifyManifest(signed)
  const artifacts = [macosArtifact, windowsArtifact]
  const targets = TARGETS.map(id => manifest.targets.find(target => target.id === id))
  for (let i = 0; i < targets.length; i += 1) await verifyPackage(artifacts[i], targets[i])
  // Never overwrite an existing bundle. A failed copy retains diagnostic files
  // but no discovery pointer; no upload, release or feed operation exists here.
  await mkdir(output)
  const digest = createHash('sha256').update(signed.bytes).digest('hex')
  const root = path.join(output, 'desktop', 'v1')
  const immutable = path.join(root, digest)
  await mkdir(immutable, { recursive: true })
  for (let i = 0; i < targets.length; i += 1) {
    const destination = path.join(immutable, PACKAGE_NAMES[i])
    await copyFile(artifacts[i], destination, constants.COPYFILE_EXCL)
    await verifyPackage(destination, targets[i])
  }
  await writeFile(path.join(immutable, 'manifest.json'), signed.bytes, { flag: 'wx' })
  await writeFile(path.join(immutable, 'manifest.macos-arm64.sig'), signed.macosSignature.trim(), { flag: 'wx' })
  await writeFile(path.join(immutable, 'manifest.windows-x86_64.sig'), signed.windowsSignature.trim(), { flag: 'wx' })
  await mkdir(path.join(root, 'latest'))
  await writeFile(path.join(root, 'latest', 'manifest.json'), signed.bytes, { flag: 'wx' })
  return digest
}

async function boundedRead(file, limit) {
  const handle = await open(file, 'r')
  try {
    requireValue((await handle.stat()).isFile(), 'expected a regular document')
    const buffer = Buffer.alloc(limit + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    requireValue(offset <= limit, 'document exceeds byte limit')
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const names = ['version', 'source', 'sequence', 'target', 'artifact', 'app', 'core', 'privileged',
    'macos', 'windows', 'release-id', 'output', 'manifest', 'macos-signature', 'windows-signature',
    'macos-public-key', 'windows-public-key', 'macos-artifact', 'windows-artifact']
  const { values } = parseArgs({ args, options: Object.fromEntries(names.map(name => [name, { type: 'string' }])) })
  const arg = name => {
    requireValue(values[name], `--${name} is required`)
    return values[name]
  }
  const sequenceArg = () => {
    const text = arg('sequence')
    requireValue(/^[1-9][0-9]*$/.test(text), '--sequence must be a positive decimal integer')
    return Number(text)
  }
  if (command === 'measure') {
    const result = await measureTarget({
      appVersion: arg('version'), buildCommit: arg('source'), releaseSequence: sequenceArg(),
      targetId: arg('target'), artifact: arg('artifact'), app: arg('app'), core: arg('core'), privileged: arg('privileged'),
    })
    await writeFile(arg('output'), canonical(result), { flag: 'wx' })
    console.log('Measured package and native components; not a signature or installed-device acceptance.')
  } else if (command === 'assemble') {
    const bytes = assembleManifest({
      macos: JSON.parse(await boundedRead(arg('macos'), MAX_DOCUMENT_BYTES)),
      windows: JSON.parse(await boundedRead(arg('windows'), MAX_DOCUMENT_BYTES)),
      buildCommit: arg('source'), releaseId: arg('release-id'), releaseSequence: sequenceArg(),
    })
    await writeFile(arg('output'), bytes, { flag: 'wx' })
    console.log(`Unsigned manifest SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`)
  } else if (command === 'bundle') {
    const digest = await writeBundle({
      output: arg('output'), macosArtifact: arg('macos-artifact'), windowsArtifact: arg('windows-artifact'),
      bytes: await boundedRead(arg('manifest'), MAX_DOCUMENT_BYTES),
      macosSignature: (await boundedRead(arg('macos-signature'), 4096)).toString('utf8'),
      windowsSignature: (await boundedRead(arg('windows-signature'), 4096)).toString('utf8'),
      macosPublicKey: (await boundedRead(arg('macos-public-key'), 4096)).toString('utf8').trim(),
      windowsPublicKey: (await boundedRead(arg('windows-public-key'), 4096)).toString('utf8').trim(),
    })
    console.log(`Both detached signatures and copied package digests verified: ${digest}. Nothing published.`)
  } else {
    throw new Error('usage: desktop-update-v1.mjs <measure|assemble|bundle> --output <new-path> [options]; see docs/UPDATE_INTEGRATION_V1.md')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`[desktop-update-v1] ${error.message}`)
    process.exitCode = 1
  })
}
