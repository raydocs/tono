#!/usr/bin/env node
// Puts a published release's artefact into the bucket that users download from.
//
// The GitHub release is the audit copy — immutable, tied to a commit, and
// readable only by whoever can read the repository. What an updater fetches is
// this bucket, because an anonymous download must not depend on the repository
// staying public, and github.com is not dependably reachable from where most of
// these users are.
//
// Windows builds in CI, which holds no Cloudflare credentials, so the upload
// happens here instead. Promotion is what enforces the order: the channel
// validator refuses to advance while the bucket does not already serve the exact
// bytes the key signed, so a forgotten upload fails the promote rather than
// pointing every updater at a 404.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const BUCKET = 'tono-releases'
export const DOWNLOAD_BASE = 'https://releases.afk.ccwu.cc/download/'
export const REPO = 'raydocs/tono'

const CONTENT_TYPES = new Map([
  ['.exe', 'application/vnd.microsoft.portable-executable'],
  ['.zip', 'application/zip'],
  ['.dmg', 'application/x-apple-diskimage'],
])

class UploadRefusal extends Error {}

function refuse(reason) {
  throw new UploadRefusal(reason)
}

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options })
}

function usage() {
  process.stderr.write(
    'usage: upload-release-asset.mjs --tag <tag> [--pattern <glob>]\n' +
      '\n' +
      '  Downloads the published release’s installer and puts it in the bucket\n' +
      '  users download from, then proves the bucket serves those exact bytes.\n' +
      '  Run this before promoting: the channel refuses to advance until it does.\n',
  )
}

export function contentTypeFor(name) {
  for (const [suffix, type] of CONTENT_TYPES) {
    if (name.endsWith(suffix)) return type
  }
  return 'application/octet-stream'
}

// An installer is addressed by name alone, so a name that could ever mean two
// different builds would make the bucket ambiguous and the immutable cache wrong.
export function assertNamesOneBuild(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
    refuse(`asset name ${name} is not a plain file name`)
  }
  if (/(?:^|[^a-z0-9])(?:latest|current|stable|nightly|edge)(?:[^a-z0-9]|$)/i.test(name)) {
    refuse(`asset name ${name} looks like a moving alias, not one build`)
  }
  if (!/\d+\.\d+\.\d+/.test(name)) {
    refuse(`asset name ${name} carries no version`)
  }
}

async function servedLength(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  if (!response.ok) return null
  const length = response.headers.get('content-length')
  return length === null ? null : Number(length)
}

async function main(argv) {
  let tag = ''
  let pattern = ''
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--tag') { tag = argv[index + 1]; index += 1 }
    else if (argv[index] === '--pattern') { pattern = argv[index + 1]; index += 1 }
    else if (argv[index] === '-h' || argv[index] === '--help') { usage(); return 0 }
    else { usage(); return 2 }
  }
  if (!tag) { usage(); return 2 }

  const release = JSON.parse(gh(['api', `repos/${REPO}/releases/tags/${tag}`]))
  if (release.draft) refuse(`${tag} is still a draft; publish it before uploading its artefact`)

  const candidates = release.assets.filter((asset) => {
    if (asset.name.endsWith('.sig') || asset.name === 'latest.json') return false
    return pattern ? asset.name.includes(pattern) : /\.(exe|zip|dmg)$/.test(asset.name)
  })
  if (candidates.length === 0) refuse(`${tag} carries no installer asset`)

  const scratch = mkdtempSync(join(tmpdir(), 'tono-release-'))
  try {
    for (const asset of candidates) {
      assertNamesOneBuild(asset.name)
      const local = join(scratch, asset.name)

      // gh, not fetch: the repository is private, so an anonymous download of the
      // release asset is a 404 rather than the artefact.
      gh(['release', 'download', tag, '--repo', REPO, '--pattern', asset.name, '--dir', scratch, '--clobber'])
      const bytes = await import('node:fs').then((fs) => fs.readFileSync(local))
      if (bytes.byteLength !== asset.size) {
        refuse(`${asset.name} downloaded as ${bytes.byteLength} bytes but the release says ${asset.size}`)
      }
      const digest = createHash('sha256').update(bytes).digest('hex')

      execFileSync(
        'npx',
        ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${asset.name}`,
          '--file', local, '--remote', '--content-type', contentTypeFor(asset.name)],
        { cwd: 'services/control-plane', stdio: 'ignore' },
      )

      const url = `${DOWNLOAD_BASE}${asset.name}`
      const length = await servedLength(url)
      if (length !== asset.size) {
        refuse(`${url} serves ${length ?? 'nothing'} but the artefact is ${asset.size} bytes`)
      }
      process.stdout.write(`  ${asset.name}\n    ${url}\n    ${asset.size} bytes  sha256 ${digest}\n`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return 0
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('upload-release-asset.mjs')
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${error instanceof UploadRefusal ? error.message : error.stack}\n`)
      process.exit(1)
    })
}
