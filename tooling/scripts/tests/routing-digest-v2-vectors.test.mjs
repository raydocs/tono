import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const vectorsPath = path.join(here, 'fixtures', 'routing-digest-v2-vectors.json')
const enc = new TextEncoder()

function compareUtf8Bytes(a, b) {
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  const len = Math.min(ab.length, bb.length)
  for (let i = 0; i < len; i += 1) {
    if (ab[i] !== bb[i]) return ab[i] - bb[i]
  }
  return ab.length - bb.length
}

function rejectDisallowedChars(value, label, disallowComma = false) {
  if (value.includes('\n') || value.includes('\u001f') || (disallowComma && value.includes(','))) {
    throw new Error(`Disallowed character in ${label}`)
  }
}

function buildPreimageV2(routing) {
  const homeProxy = routing?.homeProxy ?? ''
  const defaultProxy = routing?.defaultProxy ?? ''
  rejectDisallowedChars(homeProxy, 'homeProxy')
  rejectDisallowedChars(defaultProxy, 'defaultProxy')

  let s5Host = ''
  let s5Port = ''
  let s5User = ''
  let s5Pass = ''
  if (routing?.homeSocks5) {
    const s5 = routing.homeSocks5
    if (!Number.isSafeInteger(s5.port) || s5.port < 1 || s5.port > 65535) {
      throw new Error(`Invalid port: ${s5.port}`)
    }
    rejectDisallowedChars(s5.host, 'homeSocks5.host')
    rejectDisallowedChars(s5.username, 'homeSocks5.username')
    rejectDisallowedChars(s5.password, 'homeSocks5.password')
    s5Host = s5.host
    s5Port = String(s5.port)
    s5User = s5.username
    s5Pass = s5.password
  }

  let htField = ''
  if (routing?.homeTunnel) {
    const ht = routing.homeTunnel
    rejectDisallowedChars(ht.homeExitId, 'homeTunnel.homeExitId')
    rejectDisallowedChars(ht.clientUuid, 'homeTunnel.clientUuid')
    const deduped = [...new Set(ht.exitBaseNames)]
    for (const name of deduped) rejectDisallowedChars(name, 'homeTunnel.exitBaseNames', true)
    deduped.sort(compareUtf8Bytes)
    htField = [ht.homeExitId, ht.clientUuid, deduped.join(',')].join('\u001f')
  }

  return ['v2', homeProxy, defaultProxy, s5Host, s5Port, s5User, s5Pass, htField].join('\n')
}

function sha256Base64Url(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64url')
}

test('shared routingSha256 v2 vectors match canonical preimage and SHA-256 base64url', () => {
  const doc = JSON.parse(readFileSync(vectorsPath, 'utf8'))
  assert.equal(doc.version, 2)
  assert.ok(Array.isArray(doc.vectors) && doc.vectors.length >= 7)

  for (const vector of doc.vectors) {
    const preimage = buildPreimageV2(vector.routing ?? undefined)
    assert.equal(preimage, vector.preimage, `preimage mismatch for ${vector.name}`)
    assert.equal(preimage.split('\n').length, 8, `segment count mismatch for ${vector.name}`)
    assert.equal(sha256Base64Url(preimage), vector.sha256, `digest mismatch for ${vector.name}`)
  }
})

test('routingSha256 v2 canonicalizer rejects forbidden delimiters and invalid ports', () => {
  assert.throws(() => buildPreimageV2({ defaultProxy: 'bad\nline' }))
  assert.throws(() => buildPreimageV2({ homeProxy: 'bad\u001funit' }))
  assert.throws(() => buildPreimageV2({
    homeTunnel: { homeExitId: 'h1', clientUuid: 'uuid', exitBaseNames: ['Los Angeles, Mesa'] },
  }))
  assert.throws(() => buildPreimageV2({
    homeSocks5: { host: '1.2.3.4', port: 0, username: 'u', password: 'p' },
  }))
  assert.throws(() => buildPreimageV2({
    homeSocks5: { host: '1.2.3.4', port: 65536, username: 'u', password: 'p' },
  }))
})
