import { describe, expect, it } from 'vitest'

import { nodeFlag, nodeRegion } from './node-meta'

describe('nodeRegion', () => {
  it('matches US and JP as whole tokens like the verified-catalog sorter', () => {
    expect(nodeRegion('🇺🇸 US Reality 01')).toBe('us')
    expect(nodeRegion('jp-west')).toBe('jp')
    expect(nodeRegion('JPN East')).toBe('other')
    expect(nodeRegion('Rust Server')).toBe('other')
  })

  it('maps catalog city names to their region', () => {
    expect(nodeRegion('Tokyo · Sakura')).toBe('jp')
    expect(nodeRegion('Osaka · Wave')).toBe('jp')
    expect(nodeRegion('Los Angeles · Sunset')).toBe('us')
    expect(nodeRegion('Salt Lake City · Summit')).toBe('us')
    expect(nodeRegion('Buffalo · Niagara')).toBe('us')
    expect(nodeRegion('Paris · Seine')).toBe('other')
  })
})

describe('nodeFlag', () => {
  it('uses the city landmark emoji, including for renamed legacy wire names', () => {
    expect(nodeFlag('Los Angeles · Sunset')).toBe('🌴')
    expect(nodeFlag('Salt Lake City · Summit')).toBe('🏔️')
    expect(nodeFlag('Buffalo · Niagara')).toBe('🦬')
    expect(nodeFlag('Tokyo · Sakura')).toBe('🗼')
    // Legacy wire names pick up their display city.
    expect(nodeFlag('US-VLESS-Reality')).toBe('🌴')
    expect(nodeFlag('JP-VLESS-Reality')).toBe('🗼')
    // Unknown cities fall back to the region flag, then the globe.
    expect(nodeFlag('US West 01')).toBe('🇺🇸')
    expect(nodeFlag('jp-west')).toBe('🇯🇵')
    expect(nodeFlag('Paris · Seine')).toBe('🌐')
  })
})
