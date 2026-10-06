import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const assets = new URL('../src/dev/sea-shell/brand/', import.meta.url)

test('draft ICO and installer bitmaps contain the declared, reviewable source dimensions', () => {
  const ico = readFileSync(new URL('tono-draft.ico', assets))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  assert.equal(ico.readUInt16LE(4), sizes.length)
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16
    assert.equal(ico[entry] || 256, size)
    assert.equal(ico[entry + 1] || 256, size)
    assert.equal(ico.readUInt16LE(entry + 6), 32)
    const length = ico.readUInt32LE(entry + 8),
      offset = ico.readUInt32LE(entry + 12)
    assert.ok(offset >= 6 + sizes.length * 16 && offset + length <= ico.length)
    const png = ico.subarray(offset, offset + length)
    assert.deepEqual(
      png.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
    assert.equal(png.readUInt32BE(16), size)
    assert.equal(png.readUInt32BE(20), size)
    assert.deepEqual(
      png,
      readFileSync(new URL(`icons/tono-${size}.png`, assets)),
    )
    const svg = readFileSync(new URL(`icons/tono-${size}.svg`, assets), 'utf8')
    assert.ok(svg.includes(`viewBox="0 0 ${size} ${size}"`))
  }
  for (const name of ['installer-header', 'installer-sidebar']) {
    const svg = readFileSync(new URL(`${name}.svg`, assets), 'utf8')
    const [, width, height] = svg.match(/width="(\d+)" height="(\d+)"/) ?? []
    assert.ok(width && height)
    const bmp = readFileSync(new URL(`${name}.bmp`, assets))
    assert.equal(bmp.subarray(0, 2).toString(), 'BM')
    assert.equal(bmp.readUInt32LE(2), bmp.length)
    assert.equal(bmp.readInt32LE(18), Number(width))
    assert.equal(bmp.readInt32LE(22), Number(height))
    assert.equal(bmp.readUInt16LE(28), 24)
  }
  const windowsConfig = readFileSync(
    new URL('../src-tauri/tauri.windows.conf.json', import.meta.url),
    'utf8',
  )
  assert.equal(
    JSON.parse(windowsConfig).bundle.windows.nsis.installerIcon,
    'icons/icon.ico',
  )
  assert.ok(!windowsConfig.includes('tono-draft.ico'))
  assert.ok(!windowsConfig.includes('sea-shell/brand'))
})
