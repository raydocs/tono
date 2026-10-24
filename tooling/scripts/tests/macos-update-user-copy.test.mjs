import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)

const read = (path) => readFileSync(new URL(path, root), 'utf8')

const sentences = [
  'A previous update did not finish. Tono kept the record. You can try again later, or ask a family member for help.',
  'Tono could not confirm that ordinary internet is back. Try again. If it still fails, ask a family member for help.',
  'This update cannot be tried again yet. Wait until recovery finishes, or ask a family member for help.',
  'Tono could not close the update record. Try again. Network protection is still on.',
  'The update package did not pass the check, so nothing was installed. Try again later.',
  'The update was not allowed to install, so nothing was replaced. Try again later.',
  'Tono cannot tell whether the update finished. Leave protection on and do not tap repeatedly. Ask a family member to look.',
  'The update could not be downloaded. Check the network, then try again.',
  'Update information could not be read. Check the network, then try again.',
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
  assert.doesNotMatch(download, /system_dns\[/)
  assert.doesNotMatch(download, /The update package is unreachable:/)
  for (const sentence of sentences) {
    const entry = catalog.strings[sentence]
    const value = entry?.localizations?.['zh-Hans']?.stringUnit?.value
    assert.equal(typeof value, 'string', `missing zh-Hans for ${sentence}`)
    assert.notEqual(value, sentence)
    assert.doesNotMatch(value, /Helper|system_dns|CORE_|edSignature/)
  }
})
