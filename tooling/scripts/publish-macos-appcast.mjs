import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const DEFAULT_FEED_PATH = 'services/control-plane/public/appcast.xml'
// Enclosures come from the control plane's bucket, not from the GitHub release
// they were built by: a release asset is anonymously downloadable only while the
// repository is public, and github.com is not dependably reachable from where
// most of these users are. The signature covers the bytes, not the address.
export const DEFAULT_ENCLOSURE_HOST = 'releases.afk.ccwu.cc'
export const DEFAULT_ENCLOSURE_PATH_PREFIX = '/download/'
// The link is the human-facing release page and stays on GitHub, which is a
// different question from where the bytes come from. They shared one constant
// until the download moved, and then the link was required to be somewhere it
// has never been.
export const DEFAULT_RELEASE_LINK_HOST = 'github.com'
export const ED_SIGNATURE_BYTES = 64
export const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

const MUTABLE_ALIAS = /(?:^|[^a-z0-9])(?:latest|current|stable|edge|nightly|rolling|main|master|head|dev|preview)(?:[^a-z0-9]|$)/i
const PLACEHOLDER_SIGNATURE = /placeholder|changeme|change-me|todo|fixme|example|sample|unsigned|dummy|fake|xxxx|replace/i

export class AppcastRefusal extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'AppcastRefusal'
  }
}

function refuse(reason) {
  throw new AppcastRefusal(reason)
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    refuse(`${label} is required`)
  }
  return value.trim()
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    refuse(`${label} is required`)
  }
  return value
}

function decodeXmlText(value) {
  return String(value).replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (match, dec, hex, named) => {
      if (dec) return String.fromCodePoint(Number(dec))
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named]
    },
  )
}

export function escapeXmlText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function escapeXmlAttribute(value) {
  return escapeXmlText(value).replaceAll('"', '&quot;')
}

function tokenizePlistXml(text) {
  const tokens = []
  let cursor = 0
  while (cursor < text.length) {
    const open = text.indexOf('<', cursor)
    if (open === -1) break
    if (open > cursor) {
      tokens.push({ type: 'text', value: text.slice(cursor, open) })
    }
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open)
      if (end === -1) refuse('Info.plist XML has an unterminated comment')
      cursor = end + 3
      continue
    }
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open)
      if (end === -1) refuse('Info.plist XML has an unterminated declaration')
      cursor = end + 2
      continue
    }
    if (text.startsWith('<!', open)) {
      const end = text.indexOf('>', open)
      if (end === -1) refuse('Info.plist XML has an unterminated doctype')
      cursor = end + 1
      continue
    }
    const close = text.indexOf('>', open)
    if (close === -1) refuse('Info.plist XML has an unterminated tag')
    const inner = text.slice(open + 1, close).trim()
    if (!inner) refuse('Info.plist XML has an empty tag')
    if (inner.startsWith('/')) {
      tokens.push({ type: 'close', name: inner.slice(1).trim() })
    } else if (inner.endsWith('/')) {
      tokens.push({ type: 'empty', name: inner.slice(0, -1).trim().split(/\s/)[0] })
    } else {
      tokens.push({ type: 'open', name: inner.split(/\s/)[0] })
    }
    cursor = close + 1
  }
  return tokens
}

function parsePlistValue(tokens, state) {
  const token = tokens[state.index]
  if (!token) refuse('Info.plist ended before a value was closed')
  state.index += 1

  if (token.type === 'empty') {
    if (token.name === 'true') return true
    if (token.name === 'false') return false
    if (token.name === 'array') return []
    if (token.name === 'dict') return {}
    if (token.name === 'string') return ''
    refuse(`Info.plist contains an unsupported empty element: ${token.name}`)
  }
  if (token.type !== 'open') {
    refuse(`Info.plist contains unexpected content where a value was expected`)
  }

  if (token.name === 'dict') {
    const dict = {}
    while (state.index < tokens.length) {
      const next = tokens[state.index]
      if (next.type === 'text') {
        state.index += 1
        continue
      }
      if (next.type === 'close' && next.name === 'dict') {
        state.index += 1
        return dict
      }
      if (next.type !== 'open' || next.name !== 'key') {
        refuse('Info.plist dict contains an element that is not a <key>')
      }
      state.index += 1
      let key = ''
      while (state.index < tokens.length && tokens[state.index].type === 'text') {
        key += tokens[state.index].value
        state.index += 1
      }
      const keyClose = tokens[state.index]
      if (!keyClose || keyClose.type !== 'close' || keyClose.name !== 'key') {
        refuse('Info.plist has an unterminated <key>')
      }
      state.index += 1
      while (state.index < tokens.length && tokens[state.index].type === 'text') {
        state.index += 1
      }
      dict[decodeXmlText(key)] = parsePlistValue(tokens, state)
    }
    refuse('Info.plist has an unterminated <dict>')
  }

  if (token.name === 'array') {
    const array = []
    while (state.index < tokens.length) {
      const next = tokens[state.index]
      if (next.type === 'text') {
        state.index += 1
        continue
      }
      if (next.type === 'close' && next.name === 'array') {
        state.index += 1
        return array
      }
      array.push(parsePlistValue(tokens, state))
    }
    refuse('Info.plist has an unterminated <array>')
  }

  let raw = ''
  while (state.index < tokens.length && tokens[state.index].type === 'text') {
    raw += tokens[state.index].value
    state.index += 1
  }
  const closing = tokens[state.index]
  if (!closing || closing.type !== 'close' || closing.name !== token.name) {
    refuse(`Info.plist has an unterminated <${token.name}>`)
  }
  state.index += 1

  const text = decodeXmlText(raw)
  if (token.name === 'string' || token.name === 'data' || token.name === 'date') {
    return token.name === 'string' ? text : text.trim()
  }
  if (token.name === 'integer') {
    if (!/^-?\d+$/.test(text.trim())) {
      refuse('Info.plist contains a non-integer <integer>')
    }
    return Number.parseInt(text.trim(), 10)
  }
  if (token.name === 'real') {
    const value = Number(text.trim())
    if (!Number.isFinite(value)) refuse('Info.plist contains a non-numeric <real>')
    return value
  }
  refuse(`Info.plist contains an unsupported element: ${token.name}`)
}

export function parsePlistXml(text) {
  if (typeof text !== 'string' || !text.includes('<plist')) {
    refuse('Info.plist is not an XML property list; convert it with plutil first')
  }
  const tokens = tokenizePlistXml(text)
  const rootIndex = tokens.findIndex(
    (token) => token.type === 'open' && token.name === 'plist',
  )
  if (rootIndex === -1) refuse('Info.plist has no <plist> root element')
  const state = { index: rootIndex + 1 }
  while (state.index < tokens.length && tokens[state.index].type === 'text') {
    state.index += 1
  }
  const root = parsePlistValue(tokens, state)
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    refuse('Info.plist root value is not a dictionary')
  }
  return root
}

export function readBundleVersions(plist) {
  if (!plist || typeof plist !== 'object' || Array.isArray(plist)) {
    refuse('Info.plist did not parse into a dictionary')
  }
  const rawVersion = plist.CFBundleVersion
  const version =
    typeof rawVersion === 'number' ? String(rawVersion) : String(rawVersion ?? '').trim()
  if (!/^\d+$/.test(version)) {
    refuse(
      `Info.plist CFBundleVersion must be a plain integer build number, got ${JSON.stringify(rawVersion ?? null)}`,
    )
  }
  const shortVersionString = String(plist.CFBundleShortVersionString ?? '').trim()
  if (!/^\d+(?:\.\d+){1,3}$/.test(shortVersionString)) {
    refuse(
      `Info.plist CFBundleShortVersionString must be a dotted numeric version, got ${JSON.stringify(plist.CFBundleShortVersionString ?? null)}`,
    )
  }
  const rawMinimum = plist.LSMinimumSystemVersion
  const minimumSystemVersion =
    typeof rawMinimum === 'number' ? String(rawMinimum) : String(rawMinimum ?? '').trim()
  if (!minimumSystemVersion) {
    refuse('Info.plist has no LSMinimumSystemVersion; Sparkle needs a minimum system version')
  }
  return { version, shortVersionString, minimumSystemVersion }
}

export function assertVersionsMatchArguments(bundle, supplied) {
  const suppliedVersion = requireString(supplied?.version, '--version')
  const suppliedShort = requireString(supplied?.shortVersion, '--short-version')
  if (suppliedVersion !== bundle.version) {
    refuse(
      `--version ${suppliedVersion} does not match the built app CFBundleVersion ${bundle.version}`,
    )
  }
  if (suppliedShort !== bundle.shortVersionString) {
    refuse(
      `--short-version ${suppliedShort} does not match the built app CFBundleShortVersionString ${bundle.shortVersionString}`,
    )
  }
  if (supplied.minimumSystemVersion !== undefined) {
    const suppliedMinimum = requireString(
      supplied.minimumSystemVersion,
      '--minimum-system-version',
    )
    if (suppliedMinimum !== bundle.minimumSystemVersion) {
      refuse(
        `--minimum-system-version ${suppliedMinimum} does not match the built app LSMinimumSystemVersion ${bundle.minimumSystemVersion}`,
      )
    }
  }
  return {
    version: bundle.version,
    shortVersionString: bundle.shortVersionString,
    minimumSystemVersion: bundle.minimumSystemVersion,
  }
}

export function validateMinimumSystemVersion(value) {
  const minimum = requireString(value, 'sparkle:minimumSystemVersion')
  if (!/^\d+(?:\.\d+){0,2}$/.test(minimum)) {
    refuse(`sparkle:minimumSystemVersion must be a dotted numeric macOS version, got ${minimum}`)
  }
  return minimum
}

export function validateHardwareRequirements(value) {
  const requirements = requireString(value, 'sparkle:hardwareRequirements')
  const parts = requirements.split(',').map((part) => part.trim())
  if (parts.some((part) => !/^[a-z0-9_-]+$/.test(part))) {
    refuse(`sparkle:hardwareRequirements must be a comma separated token list, got ${requirements}`)
  }
  if (!parts.includes('arm64')) {
    refuse(
      `sparkle:hardwareRequirements must keep arm64; Tono only ships an arm64 slice, got ${requirements}`,
    )
  }
  return parts.join(',')
}

function decodeStrictBase64(value, label) {
  const encoded = String(value)
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    refuse(`${label} is not valid Base64`)
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.toString('base64') !== encoded) {
    refuse(`${label} is not canonical Base64`)
  }
  return decoded
}

export function validateEdSignature(value, options = {}) {
  const signature = String(value ?? '').trim()
  if (!signature) {
    refuse(
      'sparkle:edSignature is required; produce it with Sparkle sign_update and pass --signature or --signature-file',
    )
  }
  if (/\s/.test(signature)) {
    refuse('sparkle:edSignature must be a single Base64 token with no whitespace')
  }
  if (PLACEHOLDER_SIGNATURE.test(signature)) {
    refuse(`sparkle:edSignature looks like a placeholder, not a Sparkle signature: ${signature}`)
  }
  const decoded = decodeStrictBase64(signature, 'sparkle:edSignature')
  if (decoded.byteLength !== ED_SIGNATURE_BYTES) {
    refuse(
      `sparkle:edSignature must decode to ${ED_SIGNATURE_BYTES} Ed25519 bytes, got ${decoded.byteLength}`,
    )
  }
  if (decoded.every((byte) => byte === decoded[0])) {
    refuse('sparkle:edSignature is a constant byte pattern, not a Sparkle signature')
  }
  const existing = options.existingSignatures ?? []
  if (existing.includes(signature)) {
    refuse(
      'sparkle:edSignature is already used by another item in the feed; sign the new archive instead of copying an old signature',
    )
  }
  return signature
}

export function readSparklePublicKey(plist) {
  const encoded = String(plist?.SUPublicEDKey ?? '').trim()
  if (!encoded) {
    refuse('Info.plist has no SUPublicEDKey; the built app could not verify any update')
  }
  const raw = decodeStrictBase64(encoded, 'SUPublicEDKey')
  if (raw.byteLength !== 32) {
    refuse(`SUPublicEDKey must decode to a 32-byte Ed25519 public key, got ${raw.byteLength}`)
  }
  return { encoded, raw }
}

export function validateEnclosureUrl(value, options = {}) {
  const raw = requireString(value, '--url')
  const version = requireString(options.version, 'version')
  const shortVersionString = requireString(options.shortVersionString, 'shortVersionString')
  const expectedHost = options.expectedHost ?? DEFAULT_ENCLOSURE_HOST
  const expectedPathPrefix = options.expectedPathPrefix ?? DEFAULT_ENCLOSURE_PATH_PREFIX

  let url
  try {
    url = new URL(raw)
  } catch {
    refuse(`--url is not an absolute URL: ${raw}`)
  }
  if (url.protocol !== 'https:') {
    refuse(`enclosure URL must be https, got ${url.protocol.replace(':', '')}`)
  }
  if (url.hostname !== expectedHost) {
    refuse(`enclosure URL host must be ${expectedHost}, got ${url.hostname}`)
  }
  if (url.username || url.password || url.port) {
    refuse('enclosure URL must not carry credentials or a port')
  }
  if (url.search || url.hash) {
    refuse('enclosure URL must not carry a query string or fragment')
  }
  if (!url.pathname.startsWith(expectedPathPrefix)) {
    refuse(`enclosure URL path must start with ${expectedPathPrefix}, got ${url.pathname}`)
  }
  const relativePath = url.pathname.slice(expectedPathPrefix.length)
  const segments = relativePath.split('/').filter(Boolean)
  // Two shapes are legitimate: <tag>/<file> under a GitHub release, and <file>
  // in the bucket, where the object name alone identifies the build. Every
  // segment is still checked below, so the shorter form gives up no guarantee —
  // the file name has always been the part that has to name one exact build.
  if (segments.length < 1 || segments.length > 2) {
    refuse(
      `enclosure URL must be <file> or <tag>/<file>, got ${relativePath || '(empty)'} under ${expectedPathPrefix}`,
    )
  }
  const fileName = segments[segments.length - 1]
  if (!fileName.endsWith('.zip')) {
    refuse(`enclosure URL must reference a .zip archive, got ${fileName}`)
  }
  const buildToken = `build${version}`
  const buildPattern = new RegExp(`(?:^|[^0-9A-Za-z])build${version}(?![0-9])`)
  const shortPattern = new RegExp(
    `(?:^|[^0-9.])${shortVersionString.replaceAll('.', '\\.')}(?![0-9.])`,
  )
  for (const [label, segment] of segments.map((segment, index) => [
    index === segments.length - 1 ? 'archive file name' : 'release tag',
    segment,
  ])) {
    if (MUTABLE_ALIAS.test(segment)) {
      refuse(
        `enclosure URL ${label} "${segment}" looks like a mutable alias; it must name exactly one immutable build`,
      )
    }
    if (!buildPattern.test(segment)) {
      refuse(`enclosure URL ${label} "${segment}" must embed ${buildToken}`)
    }
    if (!shortPattern.test(segment)) {
      refuse(`enclosure URL ${label} "${segment}" must embed ${shortVersionString}`)
    }
  }
  return url.href
}

export function validateReleaseLink(value, options = {}) {
  const raw = requireString(value, '--link')
  const version = requireString(options.version, 'version')
  const expectedHost = options.expectedHost ?? DEFAULT_RELEASE_LINK_HOST
  let url
  try {
    url = new URL(raw)
  } catch {
    refuse(`--link is not an absolute URL: ${raw}`)
  }
  if (url.protocol !== 'https:') refuse('release link must be https')
  if (url.hostname !== expectedHost) {
    refuse(`release link host must be ${expectedHost}, got ${url.hostname}`)
  }
  if (!new RegExp(`(?:^|[^0-9A-Za-z])build${version}(?![0-9])`).test(url.pathname)) {
    refuse(`release link must embed build${version}, got ${url.pathname}`)
  }
  if (MUTABLE_ALIAS.test(url.pathname)) {
    refuse(`release link looks like a mutable alias: ${url.pathname}`)
  }
  return url.href
}

export function inspectEnclosure(bytes, options = {}) {
  if (!Buffer.isBuffer(bytes)) {
    refuse('enclosure contents were not read as bytes')
  }
  const fileName = requireString(options.fileName, 'enclosure file name')
  if (path.extname(fileName).toLowerCase() !== '.zip') {
    refuse(`enclosure must be a .zip archive, got ${fileName}`)
  }
  if (bytes.byteLength === 0) {
    refuse(`enclosure ${fileName} is empty`)
  }
  if (!bytes.subarray(0, ZIP_MAGIC.byteLength).equals(ZIP_MAGIC)) {
    refuse(`enclosure ${fileName} does not start with the zip local file header magic`)
  }
  const length = bytes.byteLength
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (options.expectedLength !== undefined) {
    const expected = Number(options.expectedLength)
    if (!Number.isInteger(expected) || expected !== length) {
      refuse(`--length ${options.expectedLength} does not match the real enclosure size ${length}`)
    }
  }
  if (options.expectedSha256 !== undefined) {
    const expected = String(options.expectedSha256).trim().toLowerCase()
    if (expected !== sha256) {
      refuse(`--sha256 ${expected} does not match the real enclosure digest ${sha256}`)
    }
  }
  return { fileName, length, sha256 }
}

export function parseFeedItems(feedXml) {
  const text = requireText(feedXml, 'appcast feed')
  if (!/<rss[\s>]/.test(text) || !/<channel[\s>]/.test(text)) {
    refuse('appcast feed is not a Sparkle RSS channel')
  }
  const items = []
  const itemPattern = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = itemPattern.exec(text)) !== null) {
    const body = match[1]
    const version = /<sparkle:version>\s*([^<\s]+)\s*<\/sparkle:version>/.exec(body)?.[1]
    const shortVersionString = /<sparkle:shortVersionString>\s*([^<\s]+)\s*<\/sparkle:shortVersionString>/.exec(
      body,
    )?.[1]
    const edSignature = /sparkle:edSignature="([^"]*)"/.exec(body)?.[1]
    const enclosureUrl = /<enclosure[^>]*\surl="([^"]*)"/.exec(body)?.[1]
    if (!version || !/^\d+$/.test(version)) {
      refuse('appcast feed has an item without an integer <sparkle:version>')
    }
    items.push({
      version,
      build: Number.parseInt(version, 10),
      shortVersionString: shortVersionString ?? null,
      edSignature: edSignature ?? null,
      enclosureUrl: enclosureUrl ? decodeXmlText(enclosureUrl) : null,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return items
}

export function compareDottedVersions(left, right) {
  const leftParts = String(left).split('.').map((part) => Number.parseInt(part, 10))
  const rightParts = String(right).split('.').map((part) => Number.parseInt(part, 10))
  const width = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < width; index += 1) {
    const a = leftParts[index] ?? 0
    const b = rightParts[index] ?? 0
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      refuse(`cannot compare non-numeric versions ${left} and ${right}`)
    }
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

export function assertStrictlyNewer(candidate, items) {
  const build = Number.parseInt(requireString(candidate?.version, 'version'), 10)
  if (!Number.isInteger(build) || build <= 0) {
    refuse(`sparkle:version must be a positive integer build number, got ${candidate?.version}`)
  }
  const existing = Array.isArray(items) ? items : []
  if (existing.length === 0) return { build, newest: null }
  const newest = existing.reduce((best, item) => (item.build > best.build ? item : best))
  if (build === newest.build) {
    refuse(
      `build ${build} is already published in the feed; republishing the same sparkle:version would ship a mismatched enclosure to installed clients`,
    )
  }
  if (build < newest.build) {
    refuse(
      `build ${build} is older than the newest published build ${newest.build}; the feed must never move backwards`,
    )
  }
  if (newest.shortVersionString) {
    const order = compareDottedVersions(
      requireString(candidate.shortVersionString, 'shortVersionString'),
      newest.shortVersionString,
    )
    if (order < 0) {
      refuse(
        `short version ${candidate.shortVersionString} is lower than the published ${newest.shortVersionString}`,
      )
    }
  }
  return { build, newest }
}

export function formatPubDate(value) {
  const date = value === undefined || value === null || value === '' ? new Date() : new Date(value)
  if (Number.isNaN(date.getTime())) {
    refuse(`--pub-date is not a parsable date: ${value}`)
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const pad = (number) => String(number).padStart(2, '0')
  return (
    `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  )
}

export function validateReleaseNotes(value) {
  const notes = String(value ?? '')
  if (!notes.trim()) {
    refuse('release notes are required; pass --notes-file with the markdown shipped to users')
  }
  if (notes.includes(']]>')) {
    refuse('release notes must not contain "]]>", which would terminate the CDATA section early')
  }
  return notes.replace(/\r\n/g, '\n').replace(/\s+$/, '')
}

export function detectFeedFormatting(feedXml) {
  const text = requireText(feedXml, 'appcast feed')
  const newline = /\r\n/.test(text) ? '\r\n' : '\n'
  const itemIndentMatch = /(?:^|\n)([ \t]*)<item>/.exec(text)
  const channelIndentMatch = /(?:^|\n)([ \t]*)<channel[\s>]/.exec(text)
  const titleIndentMatch = /(?:^|\n)([ \t]*)<title>/.exec(text)
  let itemIndent = itemIndentMatch?.[1]
  if (itemIndent === undefined) {
    itemIndent = titleIndentMatch?.[1] ?? `${channelIndentMatch?.[1] ?? '    '}    `
  }
  let childIndent
  if (itemIndentMatch) {
    const body = /<item>\r?\n([ \t]*)/.exec(text.slice(itemIndentMatch.index))
    childIndent = body?.[1]
  }
  if (childIndent === undefined) {
    const unit =
      channelIndentMatch && itemIndent.length > channelIndentMatch[1].length
        ? itemIndent.slice(channelIndentMatch[1].length)
        : itemIndent || '    '
    childIndent = itemIndent + (unit || '    ')
  }
  return { newline, itemIndent, childIndent }
}

export function renderItem(fields, formatting) {
  const { newline, itemIndent, childIndent } = formatting
  const lines = [
    `${itemIndent}<item>`,
    `${childIndent}<title>${escapeXmlText(fields.title)}</title>`,
    `${childIndent}<pubDate>${escapeXmlText(fields.pubDate)}</pubDate>`,
    `${childIndent}<link>${escapeXmlText(fields.link)}</link>`,
    `${childIndent}<sparkle:version>${escapeXmlText(fields.version)}</sparkle:version>`,
    `${childIndent}<sparkle:shortVersionString>${escapeXmlText(fields.shortVersionString)}</sparkle:shortVersionString>`,
    `${childIndent}<sparkle:minimumSystemVersion>${escapeXmlText(fields.minimumSystemVersion)}</sparkle:minimumSystemVersion>`,
    `${childIndent}<sparkle:hardwareRequirements>${escapeXmlText(fields.hardwareRequirements)}</sparkle:hardwareRequirements>`,
    `${childIndent}<description sparkle:format="markdown"><![CDATA[${fields.notes}${newline}]]></description>`,
    `${childIndent}<enclosure url="${escapeXmlAttribute(fields.enclosureUrl)}" length="${fields.length}" type="application/zip" sparkle:edSignature="${escapeXmlAttribute(fields.edSignature)}"/>`,
    `${itemIndent}</item>`,
  ]
  return lines.join(newline)
}

export function insertItem(feedXml, itemXml, formatting) {
  const text = requireText(feedXml, 'appcast feed')
  const { newline, itemIndent } = formatting
  const firstItem = /(?:^|\r?\n)[ \t]*<item>/.exec(text)
  if (firstItem) {
    const anchor = text.indexOf('<item>', firstItem.index)
    const lineStart = text.lastIndexOf('\n', anchor) + 1
    return `${text.slice(0, lineStart)}${itemXml}${newline}${text.slice(lineStart)}`
  }
  const closeChannel = text.lastIndexOf('</channel>')
  if (closeChannel === -1) refuse('appcast feed has no </channel> to insert before')
  const lineStart = text.lastIndexOf('\n', closeChannel) + 1
  return `${text.slice(0, lineStart)}${itemXml}${newline}${text.slice(lineStart)}`
}

export function buildAppcastUpdate(input) {
  const plist = parsePlistXml(requireString(input.infoPlistXml, '--app Info.plist'))
  const publicKey = readSparklePublicKey(plist)
  const bundle = readBundleVersions(plist)
  const versions = assertVersionsMatchArguments(bundle, {
    version: input.version,
    shortVersion: input.shortVersion,
    minimumSystemVersion: input.minimumSystemVersion,
  })
  const minimumSystemVersion = validateMinimumSystemVersion(
    input.minimumSystemVersion ?? versions.minimumSystemVersion,
  )
  const hardwareRequirements = validateHardwareRequirements(input.hardwareRequirements ?? 'arm64')
  const items = parseFeedItems(input.feedXml)
  assertStrictlyNewer(versions, items)
  const edSignature = validateEdSignature(input.edSignature, {
    existingSignatures: items.map((item) => item.edSignature).filter(Boolean),
  })
  const enclosureUrl = validateEnclosureUrl(input.enclosureUrl, {
    version: versions.version,
    shortVersionString: versions.shortVersionString,
    expectedHost: input.expectedHost,
    expectedPathPrefix: input.expectedPathPrefix,
  })
  if (items.some((item) => item.enclosureUrl === enclosureUrl)) {
    refuse(`enclosure URL is already published in the feed: ${enclosureUrl}`)
  }
  const link = validateReleaseLink(input.link, {
    version: versions.version,
    expectedHost: input.expectedHost,
  })
  const enclosure = inspectEnclosure(input.enclosureBytes, {
    fileName: input.enclosureFileName ?? decodeURIComponent(new URL(enclosureUrl).pathname.split('/').pop()),
    expectedLength: input.expectedLength,
    expectedSha256: input.expectedSha256,
  })
  if (!enclosureUrl.endsWith(`/${enclosure.fileName}`)) {
    refuse(
      `enclosure URL file name does not match the archive being published: ${enclosureUrl} vs ${enclosure.fileName}`,
    )
  }
  const notes = validateReleaseNotes(input.notes)
  const pubDate = formatPubDate(input.pubDate)
  const formatting = detectFeedFormatting(input.feedXml)
  const fields = {
    title: input.title ?? versions.shortVersionString,
    pubDate,
    link,
    version: versions.version,
    shortVersionString: versions.shortVersionString,
    minimumSystemVersion,
    hardwareRequirements,
    notes,
    enclosureUrl,
    length: enclosure.length,
    edSignature,
  }
  const itemXml = renderItem(fields, formatting)
  const feedXml = insertItem(input.feedXml, itemXml, formatting)
  const previousItems = parseFeedItems(input.feedXml)
  const updatedItems = parseFeedItems(feedXml)
  if (updatedItems.length !== previousItems.length + 1) {
    refuse('rewriting the feed did not append exactly one item')
  }
  if (updatedItems[0].version !== versions.version) {
    refuse('the new item was not inserted newest-first')
  }
  for (let index = 0; index < previousItems.length; index += 1) {
    const before = input.feedXml.slice(previousItems[index].start, previousItems[index].end)
    const after = feedXml.slice(updatedItems[index + 1].start, updatedItems[index + 1].end)
    if (before !== after) {
      refuse(`rewriting the feed modified the already-published item for build ${previousItems[index].version}`)
    }
  }
  return { feedXml, itemXml, fields, enclosure, previousItems, publicKey: publicKey.encoded }
}

function parseArguments(argv) {
  const options = {}
  const flags = new Set(['dry-run', 'validate-only'])
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      refuse(`unexpected positional argument: ${token}`)
    }
    const [name, inlineValue] = token.slice(2).split(/=(.*)/s)
    if (flags.has(name)) {
      options[name] = true
      continue
    }
    const value = inlineValue ?? argv[++index]
    if (value === undefined) refuse(`--${name} needs a value`)
    options[name] = value
  }
  return options
}

async function readPossiblyBinaryPlist(plistPath) {
  const bytes = await readFile(plistPath)
  if (!bytes.subarray(0, 8).equals(Buffer.from('bplist00'))) {
    return bytes.toString('utf8')
  }
  try {
    return execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', plistPath], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch {
    refuse(`${plistPath} is a binary property list and /usr/bin/plutil could not convert it`)
  }
}

const USAGE = `usage: publish-macos-appcast.mjs
  --app <Tono.app>                   built app bundle the release ships
  --zip <archive.zip>                the exact enclosure uploaded to the release
  --version <build>                  must equal the app's CFBundleVersion
  --short-version <x.y.z>            must equal the app's CFBundleShortVersionString
  --url <https://...>                immutable enclosure URL embedding the build
  --link <https://...>               release page URL embedding the build
  --notes-file <notes.md>            release notes shipped in the feed
  (--signature <base64> | --signature-file <path>)  output of Sparkle sign_update
  [--feed <appcast.xml>]             defaults to ${DEFAULT_FEED_PATH}
  [--minimum-system-version <x.y>]   defaults to the app's LSMinimumSystemVersion
  [--hardware-requirements <list>]   defaults to arm64
  [--title <text>] [--pub-date <date>] [--length <bytes>] [--sha256 <hex>]
  [--expected-host <host>] [--expected-path-prefix <path>]
  [--dry-run | --validate-only]      validate everything and write nothing`

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const appPath = path.resolve(requireString(options.app, '--app'))
  const zipPath = path.resolve(requireString(options.zip, '--zip'))
  const feedPath = path.resolve(options.feed ?? path.join(repoRoot, DEFAULT_FEED_PATH))
  if (options.signature && options['signature-file']) {
    refuse('pass either --signature or --signature-file, not both')
  }
  const edSignature = options['signature-file']
    ? (await readFile(path.resolve(options['signature-file']), 'utf8')).trim()
    : options.signature

  const result = buildAppcastUpdate({
    infoPlistXml: await readPossiblyBinaryPlist(path.join(appPath, 'Contents', 'Info.plist')),
    feedXml: await readFile(feedPath, 'utf8'),
    enclosureBytes: await readFile(zipPath),
    enclosureFileName: path.basename(zipPath),
    version: options.version,
    shortVersion: options['short-version'],
    minimumSystemVersion: options['minimum-system-version'],
    hardwareRequirements: options['hardware-requirements'],
    edSignature,
    enclosureUrl: options.url,
    link: options.link,
    title: options.title,
    pubDate: options['pub-date'],
    expectedLength: options.length,
    expectedSha256: options.sha256,
    expectedHost: options['expected-host'],
    expectedPathPrefix: options['expected-path-prefix'],
    notes: await readFile(
      path.resolve(requireString(options['notes-file'], '--notes-file')),
      'utf8',
    ),
  })

  console.log(`build ${result.fields.version} (${result.fields.shortVersionString})`)
  console.log(`enclosure ${result.enclosure.fileName} length=${result.enclosure.length}`)
  console.log(`sha256 ${result.enclosure.sha256}`)
  console.log(`url ${result.fields.enclosureUrl}`)
  console.log(`app SUPublicEDKey ${result.publicKey}`)
  if (options['dry-run'] || options['validate-only']) {
    console.log(`validated only; ${feedPath} was not modified`)
    return
  }
  await writeFile(feedPath, result.feedXml)
  console.log(`published build ${result.fields.version} to ${feedPath}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`[macos-appcast] ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
