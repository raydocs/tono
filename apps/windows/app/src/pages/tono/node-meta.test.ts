import { describe, expect, it } from 'vitest'

import { nodeRegion } from './node-meta'

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
