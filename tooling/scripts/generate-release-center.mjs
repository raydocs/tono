#!/usr/bin/env node
// Regenerates the customer-facing release centre from facts that already exist.
//
// The page at https://releases.afk.ccwu.cc/ used to be written by hand, so it
// went stale the moment anything shipped: on 2026-08-14 it still offered macOS
// Build 62 and Windows 0.0.27, three and five releases behind, and described a
// version as an unpublished candidate months after it had been superseded. A
// download page that names the wrong build is worse than no page.
//
// So nothing here is authored twice. Versions, artefacts, sizes, digests,
// signatures, commits and channel state are read from the sources that already
// decide them — the Sparkle feed, the GitHub releases, the audited Windows
// update channel — and the page is a projection of those. What a human still
// writes is prose, in `<notes>.zh.md` beside each release's English notes,
// because the page speaks Chinese and the notes do not.
//
// The page's own design — hero, headings, footer, stylesheet — stays hand-owned.
// This only replaces what sits between the generated:* markers.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const MANIFEST_PATH = 'services/control-plane/public/releases/manifest.json'
export const PAGE_PATH = 'services/control-plane/public/releases/index.html'
export const FEED_PATH = 'services/control-plane/public/appcast.xml'
export const CHANNEL_REF = 'origin/windows-updates:latest.json'
export const CHANNEL_MIRROR_PATH = 'services/control-plane/public/windows/latest.json'
export const REPO = 'raydocs/tono'
// Users download from the bucket, never from the GitHub release, which is the
// audit copy and is anonymously readable only while the repository is public.
export const DOWNLOAD_BASE = 'https://releases.afk.ccwu.cc/download/'

export class GeneratorRefusal extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'GeneratorRefusal'
  }
}

function refuse(reason) {
  throw new GeneratorRefusal(reason)
}

// ---------------------------------------------------------------- primitives

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim()
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Copy is Markdown, but only three shapes of it are meaningful here, so this
// renders exactly those and escapes everything else. A full Markdown engine
// would let a stray character in a release note emit tags into the page.
export function renderInline(value) {
  const escaped = escapeHtml(value)
  return escaped.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
}

// ------------------------------------------------------------------- the copy

// `# 0.0.65 · Build 65` names the card, `> …` is its paragraph, `- …` its
// bullets, `## 时间线` is the archive entry, and `## 限制` lists what this build
// still cannot do — which belongs to the release, not to the generator, so it
// is written here rather than carried forward from the last manifest, where it
// would silently outlive the version it described.
export function parseCopy(markdown, label) {
  const lines = markdown.split('\n')
  const copy = { title: '', lede: '', bullets: [], timeline: '', limitations: [] }
  let section = 'head'
  const timeline = []
  const SECTIONS = { '时间线': 'timeline', '限制': 'limitations' }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) {
      section = SECTIONS[trimmed.slice(3).trim()] ?? 'other'
      continue
    }
    if (section === 'timeline') {
      if (trimmed) timeline.push(trimmed)
      continue
    }
    if (section === 'limitations') {
      if (trimmed.startsWith('- ')) copy.limitations.push(trimmed.slice(2).trim())
      continue
    }
    if (section !== 'head') continue
    if (trimmed.startsWith('# ')) copy.title = trimmed.slice(2).trim()
    else if (trimmed.startsWith('> ')) copy.lede = trimmed.slice(2).trim()
    else if (trimmed.startsWith('- ')) copy.bullets.push(trimmed.slice(2).trim())
  }
  copy.timeline = timeline.join(' ')
  if (!copy.title) refuse(`${label} has no "# " title line`)
  if (!copy.lede) refuse(`${label} has no "> " card paragraph`)
  if (!copy.bullets.length) refuse(`${label} lists no "- " bullets`)
  if (!copy.timeline) refuse(`${label} has no "## 时间线" section`)
  return copy
}

// When a release has no Chinese copy the page must still be correct, because a
// page naming the previous build is the failure this whole script exists to
// prevent — worse than one whose prose is in English. The release notes are
// already what the updater shows a customer, so they are the fallback, and the
// caller is told which file to write.
export function copyFromReleaseNotes(markdown, label) {
  const lines = markdown.split('\n')
  const bullets = []
  const paragraphs = []
  let title = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('# ')) {
      if (!title) title = trimmed.slice(2).trim()
      continue
    }
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('- ')) bullets.push(trimmed.slice(2).trim())
    else paragraphs.push(trimmed)
  }
  if (!title) refuse(`${label} has no "# " title line`)
  if (!bullets.length && !paragraphs.length) refuse(`${label} says nothing`)
  const lede = paragraphs[0] ?? bullets[0]
  return {
    title,
    lede,
    bullets: bullets.slice(0, 6),
    timeline: paragraphs[0] ?? bullets[0],
    limitations: [],
    translated: false,
  }
}

// --------------------------------------------------------------- the sources

// The newest item in the Sparkle feed. This is the authority for what macOS
// users are actually offered — not the newest GitHub release, which may exist
// without the feed pointing at it, which is exactly how Builds 63 and 64 were
// assembled and reached nobody.
export function parseFeedNewest(feedXml) {
  const items = [...feedXml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1])
  if (!items.length) refuse('the Sparkle feed has no <item>')
  const read = (item, pattern) => {
    const found = item.match(pattern)
    return found ? found[1] : ''
  }
  const parsed = items.map((item) => ({
    build: Number.parseInt(read(item, /<sparkle:version>([^<]+)</), 10),
    version: read(item, /<sparkle:shortVersionString>([^<]+)</),
    minimumSystemVersion: read(item, /<sparkle:minimumSystemVersion>([^<]+)</),
    hardwareRequirements: read(item, /<sparkle:hardwareRequirements>([^<]+)</),
    url: read(item, /url="([^"]+)"/),
    size: Number.parseInt(read(item, /length="(\d+)"/), 10),
    edSignature: read(item, /sparkle:edSignature="([^"]+)"/),
    link: read(item, /<link>([^<]+)</),
  }))
  const newest = parsed.sort((a, b) => b.build - a.build)[0]
  for (const field of ['build', 'version', 'url', 'size', 'edSignature']) {
    if (!newest[field] || (typeof newest[field] === 'number' && !Number.isFinite(newest[field]))) {
      refuse(`the newest feed item has no ${field}`)
    }
  }
  return newest
}

// The audited channel branch is the only file tauri-plugin-updater reads, so it
// is the authority for what Windows users are offered — which is a different
// question from what the newest published release is, and the two were six
// versions apart until 2026-08-14.
export function readWindowsChannel(repoRoot) {
  let raw
  try {
    raw = git(repoRoot, ['show', CHANNEL_REF])
  } catch {
    refuse(`could not read ${CHANNEL_REF}; run "git fetch origin windows-updates" first`)
  }
  const parsed = JSON.parse(raw)
  if (!parsed.version) refuse(`${CHANNEL_REF} names no version`)
  for (const [platform, entry] of Object.entries(parsed.platforms ?? {})) {
    if (!String(entry.url ?? '').startsWith(DOWNLOAD_BASE)) {
      refuse(
        `${CHANNEL_REF} sends ${platform} to ${entry.url}, which is not under ${DOWNLOAD_BASE}`,
      )
    }
  }

  // The same file is served twice: the orphan branch that every build shipped
  // before 0.0.33 still asks for, and the control-plane asset every later build
  // asks for instead. Two copies of one fact drift, and the drift is invisible —
  // one population of users would go on being offered a version the other had
  // moved past — so they are compared here rather than discovered in the field.
  const mirrorPath = join(repoRoot, CHANNEL_MIRROR_PATH)
  if (!existsSync(mirrorPath)) refuse(`${CHANNEL_MIRROR_PATH} is missing`)
  const mirror = readFileSync(mirrorPath, 'utf8')
  if (JSON.stringify(JSON.parse(mirror)) !== JSON.stringify(parsed)) {
    refuse(
      `${CHANNEL_MIRROR_PATH} does not match ${CHANNEL_REF}: ` +
        `the asset offers ${JSON.parse(mirror).version} and the branch offers ${parsed.version}`,
    )
  }
  return parsed
}

// The compatibility section exists because the two halves of a release have to
// agree, so it must state what the shipped build actually declares — read from
// the source at the released commit, not from this checkout, which may already
// be a version ahead.
export function readContractConstant(repoRoot, commit, path, pattern, label) {
  let source
  try {
    source = git(repoRoot, ['show', `${commit}:${path}`])
  } catch {
    refuse(`${path} does not exist at ${commit.slice(0, 12)}`)
  }
  const found = source.match(pattern)
  if (!found) refuse(`${path} at ${commit.slice(0, 12)} declares no ${label}`)
  return found[1]
}

function releaseByTag(tag) {
  let raw
  try {
    raw = gh(['api', `repos/${REPO}/releases/tags/${tag}`])
  } catch {
    refuse(`no published GitHub release is tagged ${tag}`)
  }
  const release = JSON.parse(raw)
  if (release.draft) refuse(`${tag} is still a draft, so no customer can reach it`)
  return release
}

function commitForTag(tag) {
  return JSON.parse(gh(['api', `repos/${REPO}/commits/${tag}`])).sha
}

function assetNamed(release, predicate, tag) {
  const asset = release.assets.find(predicate)
  if (!asset) refuse(`the ${tag} release carries no installer asset`)
  return asset
}

// Digests cost a download, so they are reused whenever the previous manifest
// already recorded one for this exact URL at this exact size. A changed size is
// a changed file and always re-hashes.
async function digestFor(url, size, previous) {
  const prior = previous.find((entry) => entry?.url === url && entry?.size === size)
  if (prior?.sha256) return { sha256: prior.sha256, downloaded: false }
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) refuse(`${url} answered ${response.status}; it is not downloadable`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength !== size) {
    refuse(`${url} is ${bytes.byteLength} bytes but was announced as ${size}`)
  }
  return { sha256: createHash('sha256').update(bytes).digest('hex'), downloaded: true }
}

// ---------------------------------------------------------------- the model

async function buildModel(repoRoot, log) {
  const previousManifest = JSON.parse(readFileSync(join(repoRoot, MANIFEST_PATH), 'utf8'))
  const knownArtifacts = [
    previousManifest.platforms?.macos?.current?.artifact,
    previousManifest.platforms?.windows?.current?.artifact,
  ].filter(Boolean)

  const feed = parseFeedNewest(readFileSync(join(repoRoot, FEED_PATH), 'utf8'))
  const macTag = feed.link.split('/').pop()
  const macRelease = releaseByTag(macTag)
  const macCommit = commitForTag(macTag)
  const macDigest = await digestFor(feed.url, feed.size, knownArtifacts)
  if (macDigest.downloaded) log(`  hashed ${feed.url.split('/').pop()}`)

  const channel = readWindowsChannel(repoRoot)
  const channelVersion = channel.version
  const winTag = `v${channelVersion}`
  const winRelease = releaseByTag(winTag)
  const winCommit = commitForTag(winTag)
  const winAsset = assetNamed(winRelease, (a) => a.name.endsWith('-setup.exe'), winTag)
  // The channel is what an updater obeys, so the page must describe the address
  // it actually sends people to — not the GitHub asset the build happens to be
  // archived beside, which is where the two could silently diverge.
  const winUrl = `${DOWNLOAD_BASE}${winAsset.name}`
  const channelUrls = new Set(Object.values(channel.platforms ?? {}).map((entry) => entry.url))
  for (const url of channelUrls) {
    if (url !== winUrl) refuse(`${CHANNEL_REF} offers ${url} but the ${winTag} asset is ${winAsset.name}`)
  }
  const winDigest = await digestFor(winUrl, winAsset.size, knownArtifacts)
  if (winDigest.downloaded) log(`  hashed ${winAsset.name}`)

  const copyFor = (path, notesPath, label) => {
    const full = join(repoRoot, path)
    if (existsSync(full)) return { ...parseCopy(readFileSync(full, 'utf8'), path), translated: true }
    const notes = join(repoRoot, notesPath)
    if (!existsSync(notes)) refuse(`${label} has neither ${path} nor ${notesPath}`)
    log(`  ! ${label} has no Chinese copy; falling back to ${notesPath}. Write ${path}.`)
    return copyFromReleaseNotes(readFileSync(notes, 'utf8'), notesPath)
  }

  return {
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    macos: {
      version: feed.version,
      build: feed.build,
      releaseId: `macos-${feed.version}-build${feed.build}`,
      tag: macTag,
      commit: macCommit,
      publishedAt: macRelease.published_at,
      releaseURL: macRelease.html_url,
      minimumOS: feed.minimumSystemVersion,
      architecture: feed.hardwareRequirements || 'arm64',
      edSignature: feed.edSignature,
      helperContract: readContractConstant(
        repoRoot,
        macCommit,
        'apps/macos/Tono/Core/HelperProtocolVersion.swift',
        /static let current = "([\d.]+)"/,
        'helper contract version',
      ),
      artifact: {
        name: feed.url.split('/').pop(),
        url: feed.url,
        size: feed.size,
        sha256: macDigest.sha256,
      },
      copy: copyFor(
        `apps/macos/release-notes/build${feed.build}.zh.md`,
        `apps/macos/release-notes/build${feed.build}.md`,
        `macOS build ${feed.build}`,
      ),
    },
    windows: {
      version: channelVersion,
      releaseId: `windows-${channelVersion}`,
      tag: winTag,
      commit: winCommit,
      publishedAt: winRelease.published_at,
      releaseURL: winRelease.html_url,
      channelVersion,
      protocolRevision: readContractConstant(
        repoRoot,
        winCommit,
        'apps/windows/service/src/lib.rs',
        /pub const PROTOCOL_REVISION: u16 = (\d+);/,
        'protocol revision',
      ),
      minimumServiceRevision: readContractConstant(
        repoRoot,
        winCommit,
        'apps/windows/service/src/lib.rs',
        /pub const MIN_REQUIRED_SERVICE_REVISION: u16 = (\d+);/,
        'minimum service revision',
      ),
      artifact: {
        name: winAsset.name,
        url: winUrl,
        size: winAsset.size,
        sha256: winDigest.sha256,
      },
      copy: copyFor(
        `apps/windows/release-notes/${channelVersion}.zh.md`,
        `apps/windows/release-notes/${channelVersion}.md`,
        `Windows ${channelVersion}`,
      ),
    },
    previousManifest,
  }
}

// ---------------------------------------------------------------- rendering

function renderCard(platform, label, model, extraNote) {
  const bullets = model.copy.bullets
    .map((bullet) => `            <li>${renderInline(bullet)}</li>`)
    .join('\n')
  return `        <article class="card${platform === 'macos' ? ' current' : ''}">
          <div class="card-title"><span class="platform">${label}</span><span class="status good">已发布 · 自动更新</span></div>
          <h3>${renderInline(model.copy.title)}</h3>
          <p>${renderInline(model.copy.lede)}</p>
          <ul>
${bullets}
          </ul>
          <a class="text-link" href="${escapeHtml(model.artifact.url)}">下载 ${escapeHtml(extraNote)} →</a>
        </article>`
}

export function renderCards(model) {
  return [
    renderCard('macos', 'macOS', model.macos, `Build ${model.macos.build} ZIP`),
    '',
    renderCard('windows', 'Windows', model.windows, `Windows ${model.windows.version}`),
  ].join('\n')
}

export function renderContract(model) {
  const rows = [
    ['macOS', `Build ${model.macos.build} · helper ${model.macos.helperContract}`],
    ['macOS 更新 feed', `${model.macos.version} · Sparkle 已指向`],
    ['Windows 已发布包', `${model.windows.version} · 服务协议 ${model.windows.protocolRevision}`],
    ['Windows 更新通道', `${model.windows.channelVersion} · ${model.windows.channelVersion === model.windows.version ? '与安装包一致' : '落后于安装包'}`],
  ]
  return rows
    .map(([term, detail]) => `        <div><strong>${escapeHtml(term)}</strong><span>${escapeHtml(detail)}</span></div>`)
    .join('\n')
}

export function renderTimeline(model) {
  const day = (iso) => iso.slice(0, 10)
  const entries = [
    { date: day(model.macos.publishedAt), title: `macOS ${model.macos.version} · Build ${model.macos.build}`, body: model.macos.copy.timeline },
    { date: day(model.windows.publishedAt), title: `Windows ${model.windows.version}`, body: model.windows.copy.timeline },
  ]
  return entries
    .map((entry) => `        <article><time>${escapeHtml(entry.date)}</time><h3>${escapeHtml(entry.title)}</h3><p>${renderInline(entry.body)}</p></article>`)
    .join('\n')
}

// Only the marked regions are ours. Everything else on the page — the hero, the
// section headings, the footer, the stylesheet — is hand-written and stays that
// way, so a regeneration can never quietly restyle the site.
export function replaceRegion(html, name, body) {
  const open = `<!-- generated:${name} -->`
  const close = `<!-- /generated:${name} -->`
  const start = html.indexOf(open)
  const end = html.indexOf(close)
  if (start < 0 || end < 0) refuse(`the page has no ${open} … ${close} region`)
  return `${html.slice(0, start + open.length)}\n${body}\n${' '.repeat(6)}${html.slice(end)}`
}

export function renderPage(templateHtml, model) {
  let html = templateHtml
  html = replaceRegion(html, 'cards', renderCards(model))
  html = replaceRegion(html, 'contract', renderContract(model))
  html = replaceRegion(html, 'timeline', renderTimeline(model))
  return html
}

export function renderManifest(model) {
  const previous = model.previousManifest
  const archive = previous.archive.filter(
    (entry) => entry.releaseId !== model.macos.releaseId && entry.releaseId !== model.windows.releaseId,
  )
  const summaryOf = (copy) => [copy.timeline, ...copy.bullets]

  return {
    schemaVersion: previous.schemaVersion,
    channel: previous.channel,
    generatedAt: model.generatedAt,
    generator: 'tooling/scripts/generate-release-center.mjs',
    releaseCenter: previous.releaseCenter,
    // `trafficPolicy` used to sit here with a revision and a schema number, both
    // carried forward by hand from whatever they were when someone last typed
    // them. The revision is a live counter in D1 and the schema lives inside an
    // AES-GCM ciphertext, so nothing here can check either — and an unverifiable
    // number on a published artefact is worse than no number, because it reads
    // as measured. What the compatibility section is actually for is served by
    // the helper contract and the service protocol, which are read out of each
    // released commit on every run.
    controlPlane: {
      baseURL: previous.controlPlane?.baseURL,
      apiVersion: previous.controlPlane?.apiVersion,
    },
    // Why everything before the baseline is gone. Carried forward rather than
    // regenerated: it is a decision about the past, and the past stops changing.
    ...(previous.withdrawn ? { withdrawn: previous.withdrawn } : {}),
    releaseSet: {
      id: `${model.macos.publishedAt.slice(0, 10)}-macos-build${model.macos.build}-windows-${model.windows.version}`,
      status:
        model.windows.channelVersion === model.windows.version
          ? 'both-lines-published-and-reachable'
          : 'windows-channel-behind-installer',
      reason: `macOS Build ${model.macos.build} is the newest item in the Sparkle feed and Windows ${model.windows.version} is what the audited update channel serves. Both were read from those sources, not recorded by hand.`,
    },
    platforms: {
      macos: {
        current: {
          releaseId: model.macos.releaseId,
          version: model.macos.version,
          build: model.macos.build,
          architecture: model.macos.architecture,
          minimumOS: model.macos.minimumOS,
          availability: 'sparkle-published',
          update: {
            mechanism: 'sparkle-2',
            feedURL: 'https://releases.afk.ccwu.cc/macos/appcast.xml',
            legacyFeedURL: 'https://api.afk.ccwu.cc/appcast.xml',
            automaticCheckSeconds: 21600,
            silentInstall: false,
          },
          provenance: {
            releaseLine: 'release/macos',
            sourceCommit: model.macos.commit,
            immutableTagCommit: model.macos.commit,
            tagStatus: 'exact',
          },
          helperContract: model.macos.helperContract,
          knownLimitations: model.macos.copy.limitations,
          artifact: { ...model.macos.artifact, sparkleEdSignature: model.macos.edSignature },
          releaseURL: model.macos.releaseURL,
        },
      },
      windows: {
        current: {
          releaseId: model.windows.releaseId,
          version: model.windows.version,
          architecture: 'x86_64',
          installer: 'nsis',
          availability: 'published-stable',
          update: {
            mechanism: 'tauri-updater-v2',
            automaticUpdaterEnabled: true,
            channelVersion: model.windows.channelVersion,
          },
          commit: model.windows.commit,
          releaseLine: 'release/windows',
          serviceProtocolRevision: Number(model.windows.protocolRevision),
          minimumServiceRevision: Number(model.windows.minimumServiceRevision),
          recommended: true,
          artifact: { ...model.windows.artifact, authenticodeSigned: false, authenticodeStatus: 'not-signed' },
          knownLimitations: model.windows.copy.limitations,
          releaseURL: model.windows.releaseURL,
        },
      },
    },
    archive: [
      {
        releaseId: model.macos.releaseId,
        platform: 'macos',
        version: model.macos.version,
        build: model.macos.build,
        publishedAt: model.macos.publishedAt,
        status: 'published-sparkle-current',
        sourceCommit: model.macos.commit,
        tagCommit: model.macos.commit,
        summary: summaryOf(model.macos.copy),
        releaseURL: model.macos.releaseURL,
      },
      {
        releaseId: model.windows.releaseId,
        platform: 'windows',
        version: model.windows.version,
        publishedAt: model.windows.publishedAt,
        status: 'published-stable-channel-current',
        sourceCommit: model.windows.commit,
        tagCommit: model.windows.commit,
        summary: summaryOf(model.windows.copy),
        releaseURL: model.windows.releaseURL,
      },
      ...archive,
    ],
  }
}

// -------------------------------------------------------------------- driver

function serialiseManifest(manifest) {
  return `${JSON.stringify(manifest, null, 1)}\n`
}

export async function generate(repoRoot, { check = false, log = () => {} } = {}) {
  const model = await buildModel(repoRoot, log)
  const manifest = serialiseManifest(renderManifest(model))
  const page = renderPage(readFileSync(join(repoRoot, PAGE_PATH), 'utf8'), model)

  const outputs = [
    [MANIFEST_PATH, manifest],
    [PAGE_PATH, page],
  ]
  const stale = outputs.filter(([path, body]) => readFileSync(join(repoRoot, path), 'utf8') !== body)

  if (check) {
    // generatedAt moves every run, so a manifest that differs only there is not
    // stale — otherwise this check would fail on a repository nobody touched.
    const meaningfullyStale = stale.filter(([path, body]) => {
      if (path !== MANIFEST_PATH) return true
      const current = JSON.parse(readFileSync(join(repoRoot, path), 'utf8'))
      const next = JSON.parse(body)
      current.generatedAt = next.generatedAt = ''
      return JSON.stringify(current) !== JSON.stringify(next)
    })
    return { stale: meaningfullyStale.map(([path]) => path), model }
  }

  for (const [path, body] of outputs) writeFileSync(join(repoRoot, path), body)
  return { written: outputs.map(([path]) => path), stale: stale.map(([path]) => path), model }
}

function usage() {
  process.stderr.write(
    'usage: generate-release-center.mjs [--check] [--repo-root <path>]\n' +
      '\n' +
      '  Rewrites the release centre from the Sparkle feed, the audited Windows\n' +
      '  update channel and the published GitHub releases.\n' +
      '\n' +
      '  --check  writes nothing and exits non-zero if the committed page no\n' +
      '           longer matches what those sources say. This is what stops a\n' +
      '           release from shipping while the download page still names the\n' +
      '           version before it.\n',
  )
}

async function main(argv) {
  let check = false
  let repoRoot = process.cwd()
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--check') check = true
    else if (argv[index] === '--repo-root') {
      repoRoot = argv[index + 1]
      index += 1
    } else if (argv[index] === '-h' || argv[index] === '--help') {
      usage()
      return 0
    } else {
      usage()
      return 2
    }
  }

  const log = (line) => process.stdout.write(`${line}\n`)
  const result = await generate(repoRoot, { check, log })
  const { model } = result

  log(`  macOS   ${model.macos.version} build ${model.macos.build}  ${model.macos.artifact.sha256.slice(0, 12)}…`)
  log(`  Windows ${model.windows.version} (channel ${model.windows.channelVersion})  ${model.windows.artifact.sha256.slice(0, 12)}…`)

  if (check) {
    if (result.stale.length) {
      process.stderr.write(
        `\nthe release centre is out of date:\n${result.stale.map((path) => `  ${path}`).join('\n')}\n` +
          '\nrun: node tooling/scripts/generate-release-center.mjs\n',
      )
      return 1
    }
    log('  the release centre matches what the feed and the channel serve')
    return 0
  }

  log(result.stale.length ? `  rewrote ${result.stale.join(', ')}` : '  already up to date')
  return 0
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('generate-release-center.mjs')
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${error instanceof GeneratorRefusal ? error.message : error.stack}\n`)
      process.exit(1)
    })
}
