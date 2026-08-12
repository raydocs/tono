import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'

import {
  AppcastRefusal,
  buildAppcastUpdate,
  compareDottedVersions,
  detectFeedFormatting,
  inspectEnclosure,
  parseFeedItems,
  parsePlistXml,
  readBundleVersions,
  readSparklePublicKey,
  validateEdSignature,
  validateEnclosureUrl,
  validateHardwareRequirements,
  validateReleaseNotes,
} from '../publish-macos-appcast.mjs'

const ENCLOSURE = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('tono signed archive payload'),
])

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PUBLIC_ED_KEY = publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('base64')
const SIGNATURE = sign(null, ENCLOSURE, privateKey).toString('base64')

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Tono</string>
\t<key>CFBundleVersion</key>
\t<string>43</string>
\t<key>CFBundleShortVersionString</key>
\t<string>0.0.2</string>
\t<key>LSMinimumSystemVersion</key>
\t<string>26.3</string>
\t<key>SUPublicEDKey</key>
\t<string>${PUBLIC_ED_KEY}</string>
\t<key>SUVerifyUpdateBeforeExtraction</key>
\t<true/>
\t<key>SUScheduledCheckInterval</key>
\t<integer>21600</integer>
\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.raydocs.tono</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>tono</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`

const PUBLISHED_ITEM = `        <item>
            <title>0.0.1</title>
            <pubDate>Fri, 07 Aug 2026 05:47:51 +0000</pubDate>
            <link>https://github.com/raydocs/tono/releases/tag/tono-0.0.1-build42</link>
            <sparkle:version>42</sparkle:version>
            <sparkle:shortVersionString>0.0.1</sparkle:shortVersionString>
            <sparkle:minimumSystemVersion>26.3</sparkle:minimumSystemVersion>
            <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
            <description sparkle:format="markdown"><![CDATA[## Tono Build 42

- shipped
]]></description>
            <enclosure url="https://github.com/raydocs/tono/releases/download/tono-0.0.1-build42/Tono-0.0.1-build42-arm64.zip" length="19862862" type="application/zip" sparkle:edSignature="hem2MI+cAfLkGABNUj+3v0eWI0SoI1AUM6RTpwUYWVnRcrmNBsb1ZyeEUH2IaVnzO1W0oAb6UJt011hBki0SBg=="/>
        </item>`

const FEED = `<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
    <channel>
        <title>Tono</title>
${PUBLISHED_ITEM}
    </channel>
</rss>
`

const EMPTY_FEED = `<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
    <channel>
        <title>Tono</title>
    </channel>
</rss>
`

function input(overrides = {}) {
  return {
    infoPlistXml: INFO_PLIST,
    feedXml: FEED,
    enclosureBytes: ENCLOSURE,
    enclosureFileName: 'Tono-0.0.2-build43-arm64.zip',
    version: '43',
    shortVersion: '0.0.2',
    edSignature: SIGNATURE,
    enclosureUrl:
      'https://github.com/raydocs/tono/releases/download/tono-0.0.2-build43/Tono-0.0.2-build43-arm64.zip',
    link: 'https://github.com/raydocs/tono/releases/tag/tono-0.0.2-build43',
    notes: '## Tono Build 43\n\n- fixed the feed publication path\n',
    pubDate: '2026-08-10T12:00:00Z',
    ...overrides,
  }
}

function refusal(overrides, pattern) {
  assert.throws(() => buildAppcastUpdate(input(overrides)), (error) => {
    assert.ok(error instanceof AppcastRefusal, `expected AppcastRefusal, got ${error}`)
    assert.match(error.message, pattern)
    return true
  })
}

test('refuses a downgrade below the newest published build', () => {
  refusal(
    {
      infoPlistXml: INFO_PLIST.replace('<string>43</string>', '<string>41</string>').replace(
        '<string>0.0.2</string>',
        '<string>0.0.1</string>',
      ),
      version: '41',
      shortVersion: '0.0.1',
      enclosureUrl:
        'https://github.com/raydocs/tono/releases/download/tono-0.0.1-build41/Tono-0.0.1-build41-arm64.zip',
      link: 'https://github.com/raydocs/tono/releases/tag/tono-0.0.1-build41',
      enclosureFileName: 'Tono-0.0.1-build41-arm64.zip',
    },
    /build 41 is older than the newest published build 42/,
  )
})

test('refuses republishing the version already in the feed', () => {
  refusal(
    {
      infoPlistXml: INFO_PLIST.replace('<string>43</string>', '<string>42</string>').replace(
        '<string>0.0.2</string>',
        '<string>0.0.1</string>',
      ),
      version: '42',
      shortVersion: '0.0.1',
      enclosureUrl:
        'https://github.com/raydocs/tono/releases/download/tono-0.0.1-build42/Tono-0.0.1-build42-arm64.zip',
      link: 'https://github.com/raydocs/tono/releases/tag/tono-0.0.1-build42',
      enclosureFileName: 'Tono-0.0.1-build42-arm64.zip',
    },
    /build 42 is already published in the feed/,
  )
})

test('refuses a lower short version even when the build advances', () => {
  refusal(
    {
      infoPlistXml: INFO_PLIST.replace('<string>0.0.2</string>', '<string>0.0.0</string>'),
      shortVersion: '0.0.0',
      enclosureUrl:
        'https://github.com/raydocs/tono/releases/download/tono-0.0.0-build43/Tono-0.0.0-build43-arm64.zip',
      enclosureFileName: 'Tono-0.0.0-build43-arm64.zip',
    },
    /short version 0\.0\.0 is lower than the published 0\.0\.1/,
  )
})

test('refuses a placeholder signature', () => {
  refusal({ edSignature: 'PLACEHOLDER_SPARKLE_SIGNATURE' }, /looks like a placeholder/)
})

test('refuses a missing signature', () => {
  refusal({ edSignature: '   ' }, /sparkle:edSignature is required/)
})

test('refuses a signature that is not 64 Ed25519 bytes', () => {
  refusal(
    { edSignature: Buffer.alloc(32, 9).toString('base64') },
    /must decode to 64 Ed25519 bytes, got 32/,
  )
})

test('refuses reusing a signature already present in the feed', () => {
  refusal(
    {
      edSignature:
        'hem2MI+cAfLkGABNUj+3v0eWI0SoI1AUM6RTpwUYWVnRcrmNBsb1ZyeEUH2IaVnzO1W0oAb6UJt011hBki0SBg==',
    },
    /already used by another item in the feed/,
  )
})

test('refuses an app bundle that ships no SUPublicEDKey', () => {
  refusal(
    {
      infoPlistXml: INFO_PLIST.replace(
        /\t<key>SUPublicEDKey<\/key>\n\t<string>[^<]*<\/string>\n/,
        '',
      ),
    },
    /no SUPublicEDKey/,
  )
})

test('refuses a mutable "latest" enclosure alias', () => {
  refusal(
    {
      enclosureUrl:
        'https://github.com/raydocs/tono/releases/download/latest/Tono-0.0.2-build43-arm64.zip',
    },
    /looks like a mutable alias/,
  )
})

test('refuses an enclosure URL that does not embed the build', () => {
  refusal(
    {
      enclosureUrl:
        'https://github.com/raydocs/tono/releases/download/tono-0.0.2-build43/Tono-0.0.2-arm64.zip',
      enclosureFileName: 'Tono-0.0.2-arm64.zip',
    },
    /archive file name "Tono-0\.0\.2-arm64\.zip" must embed build43/,
  )
})

test('refuses a build number that is only a prefix of the URL build token', () => {
  refusal(
    {
      enclosureUrl:
        'https://github.com/raydocs/tono/releases/download/tono-0.0.2-build430/Tono-0.0.2-build430-arm64.zip',
      enclosureFileName: 'Tono-0.0.2-build430-arm64.zip',
    },
    /must embed build43/,
  )
})

test('refuses a plain http enclosure URL', () => {
  refusal(
    {
      enclosureUrl:
        'http://github.com/raydocs/tono/releases/download/tono-0.0.2-build43/Tono-0.0.2-build43-arm64.zip',
    },
    /must be https/,
  )
})

test('refuses an enclosure URL on an unexpected host', () => {
  refusal(
    {
      enclosureUrl:
        'https://cdn.example.com/raydocs/tono/releases/download/tono-0.0.2-build43/Tono-0.0.2-build43-arm64.zip',
    },
    /host must be github\.com/,
  )
})

test('refuses an Info.plist that disagrees with the supplied version arguments', () => {
  refusal({ version: '44' }, /--version 44 does not match the built app CFBundleVersion 43/)
  refusal(
    { shortVersion: '9.9.9' },
    /--short-version 9\.9\.9 does not match the built app CFBundleShortVersionString 0\.0\.2/,
  )
  refusal(
    { minimumSystemVersion: '15.0' },
    /--minimum-system-version 15\.0 does not match the built app LSMinimumSystemVersion 26\.3/,
  )
})

test('refuses an enclosure that is not a zip', () => {
  refusal(
    { enclosureBytes: Buffer.from('not a zip archive at all') },
    /does not start with the zip local file header magic/,
  )
  refusal(
    { enclosureFileName: 'Tono-0.0.2-build43-arm64.tar.gz' },
    /enclosure must be a \.zip archive/,
  )
})

test('refuses a length or digest that disagrees with the real file', () => {
  refusal({ expectedLength: '19862862' }, /does not match the real enclosure size/)
  refusal({ expectedSha256: 'f'.repeat(64) }, /does not match the real enclosure digest/)
})

test('refuses hardware requirements that drop arm64', () => {
  refusal({ hardwareRequirements: 'x86_64' }, /must keep arm64/)
})

test('refuses empty release notes and notes that break out of CDATA', () => {
  refusal({ notes: '\n \n' }, /release notes are required/)
  refusal({ notes: 'done ]]> and more' }, /must not contain "\]\]>"/)
})

test('publishes the new item newest-first and leaves prior items byte-identical', () => {
  const result = buildAppcastUpdate(input())

  assert.equal(result.fields.version, '43')
  assert.equal(result.fields.shortVersionString, '0.0.2')
  assert.equal(result.fields.minimumSystemVersion, '26.3')
  assert.equal(result.fields.hardwareRequirements, 'arm64')
  assert.equal(result.enclosure.length, ENCLOSURE.byteLength)
  assert.equal(result.fields.length, ENCLOSURE.byteLength)
  assert.equal(result.fields.pubDate, 'Mon, 10 Aug 2026 12:00:00 +0000')

  assert.ok(
    result.feedXml.includes(PUBLISHED_ITEM),
    'the already-published build 42 item must survive byte-identically',
  )

  const items = parseFeedItems(result.feedXml)
  assert.deepEqual(
    items.map((item) => item.version),
    ['43', '42'],
  )
  assert.equal(items[0].edSignature, SIGNATURE)
  assert.equal(items[0].enclosureUrl, input().enclosureUrl)

  assert.ok(result.feedXml.startsWith('<?xml version="1.0" standalone="yes"?>\n<rss '))
  assert.ok(result.feedXml.endsWith('    </channel>\n</rss>\n'))
  assert.match(result.itemXml, /^ {8}<item>\n {12}<title>0\.0\.2<\/title>\n/)
  assert.match(result.itemXml, /\n {8}<\/item>$/)
  assert.match(
    result.itemXml,
    /\n {12}<enclosure url="[^"]+" length="\d+" type="application\/zip" sparkle:edSignature="[^"]+"\/>\n/,
  )
  assert.match(
    result.itemXml,
    /<description sparkle:format="markdown"><!\[CDATA\[## Tono Build 43\n\n- fixed the feed publication path\n\]\]><\/description>/,
  )

  assert.throws(
    () => buildAppcastUpdate(input({ feedXml: result.feedXml })),
    /build 43 is already published in the feed/,
  )
})

test('publishes into a feed that has no items yet', () => {
  const result = buildAppcastUpdate(input({ feedXml: EMPTY_FEED }))
  const items = parseFeedItems(result.feedXml)
  assert.equal(items.length, 1)
  assert.equal(items[0].version, '43')
  assert.ok(result.feedXml.includes('        <title>Tono</title>\n        <item>\n'))
})

test('parses the app Info.plist without trusting the CLI', () => {
  const plist = parsePlistXml(INFO_PLIST)
  assert.equal(plist.SUVerifyUpdateBeforeExtraction, true)
  assert.equal(plist.SUScheduledCheckInterval, 21600)
  assert.deepEqual(plist.CFBundleURLTypes[0].CFBundleURLSchemes, ['tono'])
  assert.deepEqual(readBundleVersions(plist), {
    version: '43',
    shortVersionString: '0.0.2',
    minimumSystemVersion: '26.3',
  })
  assert.equal(readSparklePublicKey(plist).encoded, PUBLIC_ED_KEY)
  assert.throws(
    () => readSparklePublicKey({ SUPublicEDKey: Buffer.alloc(16).toString('base64') }),
    /must decode to a 32-byte Ed25519 public key/,
  )
})

test('refuses an Info.plist without a usable CFBundleVersion', () => {
  assert.throws(
    () => readBundleVersions(parsePlistXml(INFO_PLIST.replace('<string>43</string>', '<string>1.2.3</string>'))),
    /CFBundleVersion must be a plain integer build number/,
  )
  assert.throws(
    () => readBundleVersions(parsePlistXml(INFO_PLIST.replace(/\t<key>LSMinimumSystemVersion<\/key>\n\t<string>26\.3<\/string>\n/, ''))),
    /no LSMinimumSystemVersion/,
  )
})

test('pure helpers refuse independently of the aggregate validator', () => {
  assert.throws(() => validateEdSignature(''), AppcastRefusal)
  assert.throws(() => validateHardwareRequirements('arm 64'), AppcastRefusal)
  assert.throws(() => validateReleaseNotes(''), AppcastRefusal)
  assert.throws(
    () =>
      validateEnclosureUrl(
        'https://github.com/raydocs/tono/releases/download/tono-0.0.2-build43/Tono-0.0.2-build43-arm64.zip?x=1',
        { version: '43', shortVersionString: '0.0.2' },
      ),
    /query string/,
  )
  assert.throws(
    () => inspectEnclosure(Buffer.alloc(0), { fileName: 'Tono.zip' }),
    /is empty/,
  )
  assert.equal(compareDottedVersions('0.0.10', '0.0.9'), 1)
  assert.equal(compareDottedVersions('1.2', '1.2.0'), 0)
  assert.deepEqual(detectFeedFormatting(FEED), {
    newline: '\n',
    itemIndent: '        ',
    childIndent: '            ',
  })
})
