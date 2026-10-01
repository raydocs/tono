import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const script = path.resolve(import.meta.dirname, '../publish-macos-appcast.mjs')

const enclosure = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('unsigned bundle packaged as a sparkle enclosure'),
])
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicEdKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
const signature = sign(null, enclosure, privateKey).toString('base64')

const feed = `<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
    <channel>
        <title>Tono</title>
    </channel>
</rss>
`

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tono-appcast-gate-'))
  const contents = path.join(dir, 'Tono.app', 'Contents')
  await mkdir(contents, { recursive: true })
  await writeFile(
    path.join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleVersion</key><string>43</string>
<key>CFBundleShortVersionString</key><string>0.0.2</string>
<key>LSMinimumSystemVersion</key><string>26.3</string>
<key>SUPublicEDKey</key><string>${publicEdKey}</string>
</dict></plist>
`,
  )
  const zip = path.join(dir, 'Tono-0.0.2-build43-arm64.zip')
  const feedPath = path.join(dir, 'appcast.xml')
  const notes = path.join(dir, 'notes.md')
  const sig = path.join(dir, 'enclosure.sig')
  await writeFile(zip, enclosure)
  await writeFile(feedPath, feed)
  await writeFile(notes, '## Tono Build 43\n\n- gate\n')
  await writeFile(sig, signature)
  return { dir, zip, feedPath, notes, sig }
}

function args(paths, extra = []) {
  return [
    script,
    '--app',
    path.join(paths.dir, 'Tono.app'),
    '--zip',
    paths.zip,
    '--version',
    '43',
    '--short-version',
    '0.0.2',
    '--url',
    'https://releases.afk.ccwu.cc/download/tono-0.0.2-build43/Tono-0.0.2-build43-arm64.zip',
    '--link',
    'https://github.com/raydocs/tono/releases/tag/tono-0.0.2-build43',
    '--notes-file',
    paths.notes,
    '--signature-file',
    paths.sig,
    '--feed',
    paths.feedPath,
    ...extra,
  ]
}

async function run(paths, extra) {
  try {
    await execFileAsync(process.execPath, args(paths, extra), { encoding: 'utf8' })
    return 0
  } catch (error) {
    return error.code ?? error.status ?? 1
  }
}

test('sparkle publish refuses an app the release gate does not accept', async () => {
  const paths = await fixture()
  const before = await readFile(paths.feedPath, 'utf8')
  const published = await run(paths)
  const dryRun = await run(paths, ['--dry-run'])
  const after = await readFile(paths.feedPath, 'utf8')
  assert.notEqual(published, 0)
  assert.notEqual(dryRun, 0)
  assert.equal(after, before)
})
