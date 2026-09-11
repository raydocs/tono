import { describe, expect, it } from 'vitest'

import {
  backupChannelName,
  catalogBaseName,
  hy2UdpIsVendorBlocked,
  isHy2CatalogName,
  nodeCityLabel,
  nodeCityParts,
  nodeCityTitleKey,
  nodeCode,
  nodeProtocolKey,
  nodeRegion,
  nodeListGroupKey,
  UDP_BACKUP_GROUP,
} from './node-meta'

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
    expect(nodeListGroupKey('Los Angeles · Sunset · hy2')).toBe(UDP_BACKUP_GROUP)
    expect(nodeListGroupKey('Los Angeles · Sunset')).toBe('US')
    expect(nodeListGroupKey('Tokyo · Sakura · hy2')).toBe(UDP_BACKUP_GROUP)
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

  it('folds the hy2 sibling into the basename and labels it as the backup channel', () => {
    expect(catalogBaseName('Tokyo · Sakura · hy2')).toBe('Tokyo · Sakura')
    expect(isHy2CatalogName('Tokyo · Sakura · hy2')).toBe(true)
    expect(isHy2CatalogName('Tokyo · Sakura')).toBe(false)
    expect(nodeCityParts('Tokyo · Sakura · hy2')).toEqual({
      city: 'Tokyo',
      codename: 'Sakura',
    })
    expect(nodeProtocolKey('Tokyo · Sakura · hy2')).toBe(
      'tono.nodes.protocol.backup',
    )
    expect(nodeProtocolKey('Tokyo · Sakura')).toBe('tono.nodes.protocol.cloud')
    expect(nodeProtocolKey('US-VLESS-Reality · hy2')).toBe(
      'tono.nodes.protocol.backup',
    )
    expect(nodeProtocolKey('US-VLESS-Reality')).toBe(
      'tono.nodes.protocol.vlessReality',
    )
    expect(nodeCityLabel('Tokyo · Sakura · hy2', (key) => `t:${key}`)).toBe(
      't:tono.cities.tokyo · Sakura · t:tono.nodes.protocol.backup',
    )
    expect(nodeCityLabel('Tokyo · Sakura', (key) => `t:${key}`)).toBe(
      't:tono.cities.tokyo',
    )
    expect(
      nodeCityLabel('US-VLESS-Reality · hy2', (key) => `t:${key}`),
    ).toBe(
      't:tono.cities.losAngeles · Grove · t:tono.nodes.protocol.backup',
    )
  })
})

describe('backupChannelName', () => {
  it('names the same-city hy2 sibling when that row is in the catalog', () => {
    const names = [
      'Tokyo · Sakura',
      'Tokyo · Sakura · hy2',
      'Los Angeles · Sunset',
    ]
    expect(backupChannelName('Tokyo · Sakura', names)).toBe(
      'Tokyo · Sakura · hy2',
    )
    expect(backupChannelName('Tokyo · Sakura · hy2', names)).toBeNull()
    // No sibling here, but Tokyo hy2 is still a remaining next hand.
    expect(backupChannelName('Los Angeles · Sunset', names)).toBe(
      'Tokyo · Sakura · hy2',
    )
    expect(backupChannelName(null, names)).toBeNull()
    expect(backupChannelName('Tokyo · Sakura', ['Tokyo · Sakura'])).toBeNull()
  })

  it('skips Tokyo hy2 when another city hy2 exists, because Panstar UDP is blocked', () => {
    const names = [
      'Tokyo · Sakura',
      'Tokyo · Sakura · hy2',
      'Los Angeles · Sunset',
      'Los Angeles · Sunset · hy2',
    ]
    expect(backupChannelName('Tokyo · Sakura', names)).toBe(
      'Los Angeles · Sunset · hy2',
    )
    expect(backupChannelName('Los Angeles · Sunset', names)).toBe(
      'Los Angeles · Sunset · hy2',
    )
    expect(backupChannelName('JP-VLESS-Reality', names)).toBe(
      'Los Angeles · Sunset · hy2',
    )
    expect(hy2UdpIsVendorBlocked('Tokyo · Sakura · hy2')).toBe(true)
    expect(hy2UdpIsVendorBlocked('Tokyo · Sakura')).toBe(false)
    expect(hy2UdpIsVendorBlocked('JP-VLESS-Reality · hy2')).toBe(true)
    expect(hy2UdpIsVendorBlocked('Los Angeles · Sunset · hy2')).toBe(false)
  })

  it('falls back to another city hy2 when this city has no sibling', () => {
    const names = [
      'Tokyo · Sakura',
      'Los Angeles · Sunset',
      'Los Angeles · Sunset · hy2',
    ]
    expect(backupChannelName('Tokyo · Sakura', names)).toBe(
      'Los Angeles · Sunset · hy2',
    )
    expect(backupChannelName('Los Angeles · Sunset', names)).toBe(
      'Los Angeles · Sunset · hy2',
    )
  })

  it('offers a different city hy2 after the same-city backup already failed', () => {
    const names = [
      'Tokyo · Sakura · hy2',
      'Los Angeles · Sunset · hy2',
    ]
    expect(backupChannelName('Tokyo · Sakura · hy2', names)).toBe(
      'Los Angeles · Sunset · hy2',
    )
    expect(backupChannelName('Los Angeles · Sunset · hy2', names)).toBe(
      'Tokyo · Sakura · hy2',
    )
  })

  it('matches a flag-prefixed city to the catalog hy2 row even when flags differ', () => {
    expect(
      backupChannelName('🇺🇸 US Reality 01', [
        '🇺🇸 US Reality 01',
        '🇺🇸 US Reality 01 · hy2',
      ]),
    ).toBe('🇺🇸 US Reality 01 · hy2')
    expect(
      backupChannelName('US Reality 01', [
        '🇺🇸 US Reality 01',
        '🇺🇸 US Reality 01 · hy2',
      ]),
    ).toBe('🇺🇸 US Reality 01 · hy2')
    expect(
      backupChannelName('🇺🇸 US Reality 01', [
        'US Reality 01',
        'US Reality 01 · hy2',
      ]),
    ).toBe('US Reality 01 · hy2')
  })
})

describe('region labels', () => {
  it('has a Chinese name for every region code the catalog produces', async () => {
    const zh = (await import('@/locales/zh/tono.json')).default
    const en = (await import('@/locales/en/tono.json')).default
    // The chips render these; a missing entry silently falls back to the raw
    // ISO code, which is what shipped before.
    for (const code of ['us', 'jp', 'udpBackup'] as const) {
      expect(zh.nodes.regions[code]).toBeTruthy()
      expect(zh.nodes.regions[code]).not.toBe(code.toUpperCase())
      expect(en.nodes.regions[code]).toBeTruthy()
    }
  })
})
