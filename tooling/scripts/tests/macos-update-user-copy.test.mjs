import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)

const read = (path) => readFileSync(new URL(path, root), 'utf8')

const sentences = [
  'A previous update did not finish. Tono kept the record. You can try again later, or ask a family member for help.',
  'Tono could not confirm that ordinary internet is back. Try again. If it still fails, ask a family member for help.',
  'This update cannot be tried again yet. Wait until recovery finishes, or ask a family member for help.',
  'Ordinary internet is back, but Tono could not close the update record. Try again later.',
  'The update package did not pass the check, so nothing was installed. Try again later.',
  'The update was not allowed to install, so nothing was replaced. Try again later.',
  'Tono cannot tell whether the update finished. Leave protection on and do not tap repeatedly. Ask a family member to look.',
  'The update could not be downloaded. Check the network, then try again.',
  'Update information could not be read. Check the network, then try again.',
  'Update information was incomplete. Try again later.',
  'The downloaded update did not match the published file. Nothing was installed. Try again later.',
  'The update file could not be saved. Try again later.',
  'Update information was too large to read. Try again later.',
  'Update now',
  'Later',
]

test('macOS update failures use localized human sentences', () => {
  const updater = read('apps/macos/Tono/App/AppUpdater.swift')
  const state = read('apps/macos/Tono/Services/AppState+NativeUpdate.swift')
  const download = read('apps/macos/Tono/Services/NativeUpdateDownload.swift')
  const catalog = JSON.parse(read('apps/macos/Tono/Localizable.xcstrings'))
  assert.match(updater, /String\(localized: "Update now"\)/)
  assert.match(updater, /String\(localized: "Later"\)/)
  assert.doesNotMatch(updater, /A previous update is pending/)
  assert.doesNotMatch(state, /Update Disconnect was not verified/)
  assert.doesNotMatch(state, /This attempt cannot be retried before installation recovery/)
  assert.doesNotMatch(state, /Update retirement did not commit/)
  assert.doesNotMatch(state, /Helper did not verify private update staging/)
  assert.doesNotMatch(state, /Helper did not authorize protected update preparation/)
  assert.doesNotMatch(state, /Update consumption is uncertain/)
  assert.doesNotMatch(download, /The update package is unreachable:/)
  assert.doesNotMatch(download, /Update discovery metadata is unreachable:/)
  assert.doesNotMatch(download, /Network protection is still on/)
  assert.doesNotMatch(state, /Network protection is still on/)
  const retire = state.slice(state.indexOf('func retireDisconnectedNativeUpdate'))
  const releasedAt = retire.indexOf('isProtectionBlocked = false')
  const thrownAt = retire.indexOf('retirementUnconfirmed')
  assert.ok(releasedAt !== -1 && thrownAt > releasedAt, 'retire failure is thrown after protection is published as released')
  const copy = download.slice(download.indexOf('enum Copy'), download.indexOf('static let catalogKeys'))
  const localized = [...copy.matchAll(/String\(localized: "((?:\\.|[^"\\])*)"\)/g)].map((match) => match[1])
  const catalogKeys = download.slice(
    download.indexOf('static let catalogKeys'),
    download.indexOf(']\n        }', download.indexOf('static let catalogKeys')),
  )
  for (const sentence of localized) {
    assert.ok(catalogKeys.includes(JSON.stringify(sentence)), `catalogKeys missing ${sentence}`)
  }
  for (const sentence of sentences) {
    const entry = catalog.strings[sentence]
    const value = entry?.localizations?.['zh-Hans']?.stringUnit?.value
    assert.equal(typeof value, 'string', `missing zh-Hans for ${sentence}`)
    assert.notEqual(value, sentence)
    assert.doesNotMatch(value, /Helper|system_dns|CORE_|edSignature/)
  }
  const retirement = catalog.strings[sentences[3]].localizations['zh-Hans'].stringUnit.value
  assert.doesNotMatch(retirement, /网络保护还在|保护还在/)
  assert.match(retirement, /已经恢复/)
})
