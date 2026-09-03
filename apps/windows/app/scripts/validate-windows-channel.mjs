import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { verifyUpdaterSignature } from './prepare-updater-config.mjs'

const WINDOWS_PLATFORM = /^windows-(?:x86_64|i686|aarch64)(?:-(?:nsis|msi))?$/

// Updaters are sent to the bucket, never to the GitHub release. A release asset
// is anonymously readable only while the repository is public, so pointing the
// channel there made one settings toggle enough to 404 every update — and it
// broke this validator too, which downloads the artifact to verify it.
export const DOWNLOAD_BASE = 'https://releases.afk.ccwu.cc/download/'

export async function validateWindowsChannel(
  manifest,
  expectedVersion,
  publicKey,
  release,
  fetchAsset = fetch,
) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('latest.json must be an object')
  }
  const version = String(manifest.version ?? '').replace(/^v/, '')
  if (version !== expectedVersion) {
    throw new Error(
      `latest.json version ${manifest.version ?? 'missing'} does not match ${expectedVersion}`,
    )
  }

  const platforms = manifest.platforms
  const entries =
    platforms && typeof platforms === 'object' && !Array.isArray(platforms)
      ? Object.entries(platforms)
      : []
  if (entries.length === 0) {
    throw new Error('latest.json has no Windows platforms')
  }
  const releaseAssets = Array.isArray(release?.assets) ? release.assets : []
  if (releaseAssets.length === 0) {
    throw new Error('published Windows Release has no assets')
  }

  for (const [platform, update] of entries) {
    if (!WINDOWS_PLATFORM.test(platform)) {
      throw new Error(
        `non-Windows platform is forbidden in the Windows channel: ${platform}`,
      )
    }
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new Error(`invalid update entry for ${platform}`)
    }

    const sourceUrl = String(update.url ?? '')
    const releaseAsset = releaseAssets.find(
      (asset) =>
        asset?.url === sourceUrl || asset?.browser_download_url === sourceUrl,
    )
    if (!releaseAsset) {
      throw new Error(
        `${platform} does not reference an asset owned by the selected Release`,
      )
    }
    const url = new URL(String(releaseAsset.browser_download_url ?? ''))
    const expectedPrefix = `/raydocs/tono/releases/download/v${expectedVersion}/`
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      !url.pathname.startsWith(expectedPrefix) ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        `${platform} must reference an immutable raydocs/tono v${expectedVersion} release asset`,
      )
    }
    const assetName = url.pathname.slice(expectedPrefix.length)
    if (!assetName || assetName.includes('/')) {
      throw new Error(`${platform} does not name a single release asset`)
    }
    update.url = `${DOWNLOAD_BASE}${assetName}`
    if (typeof update.signature !== 'string' || !update.signature.trim()) {
      throw new Error(`${platform} has no updater signature`)
    }

    // Deliberately the bucket rather than the release: this both proves the
    // object is already there — the channel must never name a file that has not
    // been uploaded yet — and proves it is byte-for-byte the artifact the key
    // signed, since the signature is checked over exactly what an updater will
    // download.
    const response = await fetchAsset(new URL(update.url))
    if (!response.ok) {
      throw new Error(
        `${platform} is not in the release bucket yet: ${update.url} answered HTTP ${response.status}`,
      )
    }
    const body = Buffer.from(await response.arrayBuffer())
    if (
      typeof releaseAsset.size === 'number' &&
      body.byteLength !== releaseAsset.size
    ) {
      throw new Error(
        `${platform} bucket object is ${body.byteLength} bytes but the release asset is ${releaseAsset.size}`,
      )
    }
    verifyUpdaterSignature(publicKey, update.signature, body)
  }

  return manifest
}

async function main() {
  const [, , manifestPath, releasePath, expectedVersion, outputPath] =
    process.argv
  if (!manifestPath || !releasePath || !expectedVersion || !outputPath) {
    throw new Error(
      'usage: validate-windows-channel.mjs <latest.json> <release.json> <version> <validated-output.json>',
    )
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const release = JSON.parse(await readFile(releasePath, 'utf8'))
  await validateWindowsChannel(
    manifest,
    expectedVersion,
    process.env.TONO_UPDATER_PUBLIC_KEY,
    release,
  )
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`validated Windows update channel candidate v${expectedVersion}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      `[windows-channel] ${error instanceof Error ? error.message : error}`,
    )
    process.exit(1)
  })
}
