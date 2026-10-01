import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises'
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

function plist(publicEdKey) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleVersion</key><string>43</string>
<key>CFBundleShortVersionString</key><string>0.0.2</string>
<key>LSMinimumSystemVersion</key><string>26.3</string>
<key>SUPublicEDKey</key><string>${publicEdKey}</string>
</dict></plist>
`
}

function zipApp(appDir, zipPath) {
  execFileSync(
    'python3',
    [
      '-c',
      `
import os, sys, zipfile
from pathlib import Path
app = Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w') as archive:
    for dirpath, _, filenames in os.walk(app):
        for name in filenames:
            full = Path(dirpath) / name
            rel = Path('Tono.app') / full.relative_to(app)
            archive.write(full, rel.as_posix())
`,
      appDir,
      zipPath,
    ],
    { encoding: 'utf8' },
  )
}

test('the release gate sees the app inside the zip, not a different --app', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tono-appcast-zip-'))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicEdKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  const passed = path.join(dir, 'passed', 'Tono.app')
  const zipped = path.join(dir, 'zipped', 'Tono.app')
  await mkdir(path.join(passed, 'Contents'), { recursive: true })
  await mkdir(path.join(zipped, 'Contents'), { recursive: true })
  await writeFile(path.join(passed, 'Contents', 'Info.plist'), plist(publicEdKey))
  await writeFile(path.join(zipped, 'Contents', 'Info.plist'), plist(publicEdKey))
  await writeFile(path.join(passed, 'Contents', 'marker'), 'passed-to---app')
  await writeFile(path.join(zipped, 'Contents', 'marker'), 'inside-the-zip')
  const zipPath = path.join(dir, 'Tono-0.0.2-build43-arm64.zip')
  zipApp(zipped, zipPath)
  const zipBytes = await readFile(zipPath)
  const signature = sign(null, zipBytes, privateKey).toString('base64')
  const feedPath = path.join(dir, 'appcast.xml')
  const notes = path.join(dir, 'notes.md')
  const sig = path.join(dir, 'enclosure.sig')
  await writeFile(feedPath, feed)
  await writeFile(notes, '## Tono Build 43\n\n- zip\n')
  await writeFile(sig, signature)
  const cli = [
    script,
    '--app',
    passed,
    '--zip',
    zipPath,
    '--version',
    '43',
    '--short-version',
    '0.0.2',
    '--url',
    'https://releases.afk.ccwu.cc/download/tono-0.0.2-build43/Tono-0.0.2-build43-arm64.zip',
    '--link',
    'https://github.com/raydocs/tono/releases/tag/tono-0.0.2-build43',
    '--notes-file',
    notes,
    '--signature-file',
    sig,
    '--feed',
    feedPath,
  ]
  const mismatched = await execFileAsync(process.execPath, cli, { encoding: 'utf8' }).then(
    () => ({ status: 0, stderr: '' }),
    (error) => ({ status: error.code ?? error.status ?? 1, stderr: `${error.stderr ?? ''}${error.stdout ?? ''}` }),
  )
  assert.notEqual(mismatched.status, 0)
  assert.match(mismatched.stderr, /not byte-identical to Tono\.app inside the zip/)
  assert.equal(await readFile(feedPath, 'utf8'), feed)

  await cp(passed, zipped, { recursive: true, force: true })
  zipApp(zipped, zipPath)
  const sameBytes = await readFile(zipPath)
  await writeFile(sig, sign(null, sameBytes, privateKey).toString('base64'))
  const matched = await execFileAsync(process.execPath, cli, { encoding: 'utf8' }).then(
    () => ({ status: 0, stderr: '' }),
    (error) => ({ status: error.code ?? error.status ?? 1, stderr: `${error.stderr ?? ''}${error.stdout ?? ''}` }),
  )
  assert.notEqual(matched.status, 0)
  assert.match(matched.stderr, /verify-release-gate\.sh rejected (\S+)/)
  const gated = /verify-release-gate\.sh rejected (\S+)/.exec(matched.stderr)[1].replace(/:$/, '')
  assert.notEqual(path.resolve(gated), path.resolve(passed))
  assert.equal(await readFile(feedPath, 'utf8'), feed)
})
