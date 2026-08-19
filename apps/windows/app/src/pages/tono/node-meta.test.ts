import { describe, expect, it } from 'vitest'

import { nodeCityParts, nodeCityTitleKey, nodeCode, nodeRegion } from './node-meta'

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

describe('nodeCode', () => {
  it('uses a stable region code, including for renamed legacy wire names', () => {
    expect(nodeCode('Los Angeles · Sunset')).toBe('US')
    expect(nodeCode('Salt Lake City · Summit')).toBe('US')
    expect(nodeCode('Buffalo · Niagara')).toBe('US')
    expect(nodeCode('Tokyo · Sakura')).toBe('JP')
    // Legacy wire names pick up their display city.
    expect(nodeCode('US-VLESS-Reality')).toBe('US')
    expect(nodeCode('JP-VLESS-Reality')).toBe('JP')
    // Unknown cities fall back to an explicit region token, then GL.
    expect(nodeCode('US West 01')).toBe('US')
    expect(nodeCode('jp-west')).toBe('JP')
    expect(nodeCode('Paris · Seine')).toBe('GL')
  })
})

describe('nodeCityParts', () => {
  it('splits the city users think in from the line codename', () => {
    expect(nodeCityParts('Los Angeles · Sunset')).toEqual({
      city: 'Los Angeles',
      codename: 'Sunset',
    })
    expect(nodeCityParts('Tokyo · Sakura')).toEqual({
      city: 'Tokyo',
      codename: 'Sakura',
    })
    expect(nodeCityParts('US-VLESS-Reality')).toEqual({
      city: 'Los Angeles',
      codename: 'Grove',
    })
    expect(nodeCityTitleKey('Tokyo · Sakura')).toBe('tono.cities.tokyo')
    expect(nodeCityTitleKey('Paris · Seine')).toBeNull()
  })
})
