// Offline update-feed dry run. No private key, no network, no upload.
// Writes candidate files only. Refuses the live customer directory
// services/control-plane/public/. See docs/UPDATE_INTEGRATION_V1.md.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assembleManifest, readManifest } from './desktop-update-v1.mjs'
import { validateEdSignature } from './publish-macos-appcast.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const publicDir = path.join(repoRoot, 'services/control-plane/public')

export const APP_VERSION = '0.0.80'
export const SPARKLE_BUILD = 81
export const BUILD_COMMIT = '322f48c6fcb13b26279fed22ae19f79dcc2522bb'
export const RELEASE_ID = 'dry-run-2026-10-24-not-for-publish'
// Format placeholder only. The owner assigns TONO_UPDATE_RELEASE_SEQUENCE
// when a real pair is signed. This number is not an installed floor.
export const RELEASE_SEQUENCE = 1
export const SIGNATURE_PLACEHOLDER = 'UNSIGNED-DRY-RUN'
export const CANDIDATE_HOST = 'example.invalid'

const labelDigest = (label) => createHash('sha256').update(label).digest('hex')

const measurement = (targetId, singBox) => {
  const components = {
    appSha256: labelDigest(`${targetId}:app`),
    coreSha256: labelDigest(`${targetId}:core`),
    privilegedSha256: labelDigest(`${targetId}:privileged`),
  }
  if (singBox) components.singBoxSha256 = labelDigest(`${targetId}:sing-box`)
  return {
    kind: 'tonoUpdateTargetMeasurement',
    appVersion: APP_VERSION,
    buildCommit: BUILD_COMMIT,
    releaseSequence: RELEASE_SEQUENCE,
    target: {
      id: targetId,
      artifactSha256: labelDigest(`${targetId}:artifact`),
      artifactSizeBytes: 1,
      components,
    },
  }
}

const semverParts = (value) => {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) throw new Error(`not a three-part version: ${value}`)
  return match.slice(1).map(Number)
}

export const semverGreater = (left, right) => {
  const a = semverParts(left)
  const b = semverParts(right)
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

export const liveFloors = () => {
  const appcast = readFileSync(path.join(publicDir, 'appcast.xml'), 'utf8')
  const latest = JSON.parse(readFileSync(path.join(publicDir, 'windows/latest.json'), 'utf8'))
  const builds = [...appcast.matchAll(/<sparkle:version>(\d+)<\/sparkle:version>/g)].map((match) => Number(match[1]))
  const shorts = [...appcast.matchAll(/<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/g)].map((match) => match[1])
  if (builds.length === 0 || shorts.length !== builds.length || typeof latest.version !== 'string') {
    throw new Error('live customer feed is missing a version')
  }
  const sparkleBuild = Math.max(...builds)
  return {
    sparkleBuild,
    macosShortVersion: shorts[builds.indexOf(sparkleBuild)],
    windowsVersion: latest.version,
    sparkleSignature: appcast.match(/sparkle:edSignature="([^"]+)"/)?.[1] ?? '',
    windowsSignature: latest.platforms?.['windows-x86_64']?.signature ?? '',
  }
}

const appcastXml = () => `<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
    <channel>
        <title>Tono DRY RUN — not for publish</title>
        <item>
            <title>${APP_VERSION}</title>
            <pubDate>Fri, 24 Oct 2026 00:00:00 +0000</pubDate>
            <sparkle:version>${SPARKLE_BUILD}</sparkle:version>
            <sparkle:shortVersionString>${APP_VERSION}</sparkle:shortVersionString>
            <description sparkle:format="markdown"><![CDATA[DRY RUN. Not a release. Do not upload. The signature is a placeholder, and the enclosure is not a package.]]></description>
            <enclosure url="https://${CANDIDATE_HOST}/tono-dry-run/Tono-${APP_VERSION}-build${SPARKLE_BUILD}-arm64.zip" length="1" type="application/zip" sparkle:edSignature="${SIGNATURE_PLACEHOLDER}"/>
        </item>
    </channel>
</rss>
`

const latestJson = () => `${JSON.stringify({
  version: APP_VERSION,
  notes: 'DRY RUN — not a release. Do not upload. The signature is a placeholder, and the URL is not a package.',
  pub_date: '2026-10-24T00:00:00.000Z',
  platforms: {
    'windows-x86_64': {
      signature: SIGNATURE_PLACEHOLDER,
      url: `https://${CANDIDATE_HOST}/tono-dry-run/Tono_${APP_VERSION}_x64-setup.exe`,
    },
    'windows-x86_64-nsis': {
      signature: SIGNATURE_PLACEHOLDER,
      url: `https://${CANDIDATE_HOST}/tono-dry-run/Tono_${APP_VERSION}_x64-setup.exe`,
    },
  },
}, null, 2)}\n`

const assertOutsideCustomerFeed = (output) => {
  const resolved = path.resolve(output)
  const live = path.resolve(publicDir)
  if (resolved === live || resolved.startsWith(`${live}${path.sep}`)) {
    throw new Error('dry-run refuses to write services/control-plane/public')
  }
}

export const writeCandidates = async (output) => {
  assertOutsideCustomerFeed(output)
  const floors = liveFloors()
  const manifest = assembleManifest({
    macos: measurement('macos-arm64', false),
    windows: measurement('windows-x86_64', true),
    buildCommit: BUILD_COMMIT,
    releaseId: RELEASE_ID,
    releaseSequence: RELEASE_SEQUENCE,
  })
  readManifest(manifest)
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'appcast.candidate.xml'), appcastXml())
  await writeFile(path.join(output, 'latest.candidate.json'), latestJson())
  await writeFile(path.join(output, 'manifest.candidate.json'), manifest)
  await writeFile(path.join(output, 'manifest.macos-arm64.sig'), `${SIGNATURE_PLACEHOLDER}\n`)
  await writeFile(path.join(output, 'manifest.windows-x86_64.sig'), `${SIGNATURE_PLACEHOLDER}\n`)
  const report = {
    kind: 'tonoUpdateDryRun',
    publishable: false,
    appVersion: APP_VERSION,
    sparkleBuild: SPARKLE_BUILD,
    buildCommit: BUILD_COMMIT,
    releaseId: RELEASE_ID,
    releaseSequencePlaceholder: RELEASE_SEQUENCE,
    releaseSequenceIsInstalledFloor: false,
    componentDigestsAreLabels: true,
    signature: SIGNATURE_PLACEHOLDER,
    urlsHost: CANDIDATE_HOST,
    wroteCustomerFeed: false,
    liveFloors: {
      sparkleBuild: floors.sparkleBuild,
      macosShortVersion: floors.macosShortVersion,
      windowsVersion: floors.windowsVersion,
    },
  }
  await writeFile(path.join(output, 'dry-run-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export const validateCandidates = async (output) => {
  assertOutsideCustomerFeed(output)
  const floors = liveFloors()
  const appcast = await readFile(path.join(output, 'appcast.candidate.xml'), 'utf8')
  const latest = JSON.parse(await readFile(path.join(output, 'latest.candidate.json'), 'utf8'))
  const manifestBytes = await readFile(path.join(output, 'manifest.candidate.json'))
  const manifest = readManifest(manifestBytes)
  const macosSig = (await readFile(path.join(output, 'manifest.macos-arm64.sig'), 'utf8')).trim()
  const windowsSig = (await readFile(path.join(output, 'manifest.windows-x86_64.sig'), 'utf8')).trim()
  const sparkleBuild = Number(appcast.match(/<sparkle:version>(\d+)<\/sparkle:version>/)?.[1])
  const shortVersion = appcast.match(/<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/)?.[1]
  const edSignature = appcast.match(/sparkle:edSignature="([^"]+)"/)?.[1]
  if (!(sparkleBuild > floors.sparkleBuild)) throw new Error('candidate Sparkle build is not above the live appcast')
  if (!semverGreater(shortVersion, floors.macosShortVersion)) throw new Error('candidate macOS version is not above the live appcast')
  if (!semverGreater(latest.version, floors.windowsVersion)) throw new Error('candidate Windows version is not above live latest.json')
  if (shortVersion !== APP_VERSION || latest.version !== APP_VERSION || manifest.appVersion !== APP_VERSION) {
    throw new Error('candidate versions disagree')
  }
  if (edSignature !== SIGNATURE_PLACEHOLDER || macosSig !== SIGNATURE_PLACEHOLDER || windowsSig !== SIGNATURE_PLACEHOLDER) {
    throw new Error('candidate signature is not the dry-run placeholder')
  }
  if (edSignature === floors.sparkleSignature || latest.platforms['windows-x86_64'].signature === floors.windowsSignature) {
    throw new Error('candidate copied a live signature')
  }
  let signatureRejected = false
  try {
    validateEdSignature(edSignature)
  } catch (error) {
    signatureRejected = /placeholder/i.test(String(error.message))
  }
  if (!signatureRejected) throw new Error('placeholder signature was accepted')
  if (!appcast.includes(CANDIDATE_HOST) || !JSON.stringify(latest).includes(CANDIDATE_HOST)) {
    throw new Error('candidate URL is not on the dry-run host')
  }
  if (!/DRY RUN/.test(appcast) || !/DRY RUN/.test(latest.notes)) throw new Error('candidate is not marked as a dry run')
  const windows = manifest.targets.find((target) => target.id === 'windows-x86_64')
  if (!windows?.components?.singBoxSha256) throw new Error('Windows candidate is missing singBoxSha256')
  if (manifest.releaseSequence !== RELEASE_SEQUENCE) throw new Error('unexpected release sequence')
  if (!latest.platforms['windows-x86_64-nsis']) throw new Error('latest candidate is missing the nsis key')
  return { ok: true, sparkleBuild, shortVersion, windowsVersion: latest.version }
}

const main = async () => {
  const outputFlag = process.argv.indexOf('--output')
  const output = outputFlag === -1
    ? path.join(repoRoot, 'docs/reports/update-prep-2026-10-24')
    : path.resolve(process.argv[outputFlag + 1] ?? '')
  const report = await writeCandidates(output)
  const checked = await validateCandidates(output)
  console.log(JSON.stringify({ ...report, ...checked, output }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[update-feed-dry-run] ${error.message}`)
    process.exitCode = 1
  })
}
