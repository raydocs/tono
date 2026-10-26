import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { readManifest } from '../desktop-update-v1.mjs'
import { validateEdSignature } from '../publish-macos-appcast.mjs'
import { validateCandidates, writeCandidates } from '../update-feed-dry-run.mjs'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const committed = path.join(repoRoot, 'docs/reports/update-prep-2026-10-24')
const liveAppcast = path.join(repoRoot, 'services/control-plane/public/appcast.xml')
const liveLatest = path.join(repoRoot, 'services/control-plane/public/windows/latest.json')

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

test('dry-run candidates are newer, unsigned, and stay out of the customer feed', async () => {
  const before = { appcast: sha256(liveAppcast), latest: sha256(liveLatest) }
  await assert.rejects(
    () => writeCandidates(path.join(repoRoot, 'services/control-plane/public')),
    /refuses to write/,
  )
  assert.equal(sha256(liveAppcast), before.appcast)
  assert.equal(sha256(liveLatest), before.latest)

  const dir = await mkdtemp(path.join(tmpdir(), 'tono-update-dry-'))
  try {
    const report = await writeCandidates(dir)
    assert.equal(report.publishable, false)
    assert.equal(report.wroteCustomerFeed, false)
    assert.equal(report.releaseSequenceIsInstalledFloor, false)
    assert.throws(() => validateEdSignature('UNSIGNED-DRY-RUN'), /placeholder/)
    const manifest = readManifest(await readFile(path.join(dir, 'manifest.candidate.json')))
    assert.equal(manifest.kind, 'tonoUpdateManifest')
    assert.equal(manifest.appVersion, '0.0.80')
    assert.equal(manifest.releaseSequence, 1)
    const checked = await validateCandidates(dir)
    assert.equal(checked.ok, true)
    assert.equal(checked.sparkleBuild, 81)
    for (const name of [
      'appcast.candidate.xml',
      'latest.candidate.json',
      'manifest.candidate.json',
      'manifest.macos-arm64.sig',
      'manifest.windows-x86_64.sig',
      'dry-run-report.json',
    ]) {
      assert.equal(
        await readFile(path.join(dir, name), 'utf8'),
        await readFile(path.join(committed, name), 'utf8'),
        name,
      )
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
