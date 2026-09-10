/**
 * Tono node presentation metadata: user-facing display names, compact region
 * codes, and the protocol line, derived from the catalog's wire names. The
 * server address itself is never shown — that is Tono's idea of redaction.
 */

import type { TranslationKey } from '@/types/generated/i18n-keys'

const NODE_DISPLAY_NAMES: Record<string, string> = {
  'US-VLESS-Reality': 'Los Angeles · Grove',
  'JP-VLESS-Reality': 'Tokyo · Dawn',
}

/** Same-node backup transport. Folded into the basename for display. */
export const HY2_NAME_SUFFIX = ' · hy2'

export const isHy2CatalogName = (wireName: string) =>
  wireName.endsWith(HY2_NAME_SUFFIX)

export const catalogBaseName = (wireName: string) =>
  isHy2CatalogName(wireName)
    ? wireName.slice(0, -HY2_NAME_SUFFIX.length)
    : wireName

export const nodeDisplayName = (wireName: string) => {
  const base = catalogBaseName(wireName)
  return NODE_DISPLAY_NAMES[base] ?? base
}

const CITY_CODES: Record<string, string> = {
  'los angeles': 'US',
  'salt lake city': 'US',
  buffalo: 'US',
  'new york': 'US',
  'san jose': 'US',
  seattle: 'US',
  chicago: 'US',
  dallas: 'US',
  miami: 'US',
  tokyo: 'JP',
  osaka: 'JP',
}

const KNOWN_REGION_CODES = new Set([
  'US',
  'JP',
  'SG',
  'HK',
  'TW',
  'CN',
  'KR',
  'GB',
  'DE',
  'FR',
  'CA',
  'AU',
  'IN',
  'RU',
  'BR',
  'NL',
])

/** Stable two-letter mark used in the Windows and macOS server cards. */
export const nodeCode = (wireName: string) => {
  const displayName = nodeDisplayName(wireName)
  const cityCode = CITY_CODES[cityOf(displayName)]
  if (cityCode) return cityCode

  const tokenCode = wireName
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.toUpperCase())
    .find((token) => KNOWN_REGION_CODES.has(token))
  if (tokenCode) return tokenCode

  const region = nodeRegion(wireName)
  if (region === 'us') return 'US'
  if (region === 'jp') return 'JP'
  return 'GL'
}

export const nodeProtocolKey = (wireName: string): TranslationKey =>
  isHy2CatalogName(wireName)
    ? 'tono.nodes.protocol.backup'
    : /vless/i.test(catalogBaseName(wireName))
      ? 'tono.nodes.protocol.vlessReality'
      : 'tono.nodes.protocol.cloud'

/** City the user thinks in, plus 「备用通道」 when this row is the hy2 sibling. */
export const nodeCityLabel = (
  wireName: string,
  t: (key: TranslationKey) => string,
) => {
  const titleKey = nodeCityTitleKey(wireName)
  const city = titleKey ? t(titleKey) : nodeDisplayName(wireName)
  return isHy2CatalogName(wireName)
    ? `${city} · ${t('tono.nodes.protocol.backup')}`
    : city
}

export type NodeRegion = 'us' | 'jp' | 'other'

/**
 * Catalog names are either flag-prefixed tokens ("US-VLESS-Reality") or
 * "City · Codename" ("Tokyo · Sakura"). Cities carry the region when the
 * explicit US/JP token is absent. Keep this map aligned with
 * `region_rank` in src-tauri/src/tono/catalog_sync.rs.
 */
const CITY_REGIONS: Record<string, NodeRegion> = {
  'los angeles': 'us',
  'salt lake city': 'us',
  buffalo: 'us',
  'new york': 'us',
  'san jose': 'us',
  seattle: 'us',
  chicago: 'us',
  dallas: 'us',
  miami: 'us',
  tokyo: 'jp',
  osaka: 'jp',
}

const cityOf = (wireName: string) => wireName.split('·')[0].trim().toLowerCase()

export const nodeCityParts = (wireName: string) => {
  const displayName = nodeDisplayName(wireName)
  const [city, rest] = displayName.split('·')
  return {
    city: (city ?? displayName).trim(),
    codename: rest?.trim() || null,
  }
}

const CITY_TITLE_KEYS: Record<string, TranslationKey> = {
  'los angeles': 'tono.cities.losAngeles',
  'salt lake city': 'tono.cities.saltLakeCity',
  buffalo: 'tono.cities.buffalo',
  'new york': 'tono.cities.newYork',
  'san jose': 'tono.cities.sanJose',
  seattle: 'tono.cities.seattle',
  chicago: 'tono.cities.chicago',
  dallas: 'tono.cities.dallas',
  miami: 'tono.cities.miami',
  tokyo: 'tono.cities.tokyo',
  osaka: 'tono.cities.osaka',
}

export const nodeCityTitleKey = (wireName: string) =>
  CITY_TITLE_KEYS[nodeCityParts(wireName).city.toLowerCase()] ?? null

/** Keep the UI's groups aligned with the backend's region ranking. */
export const nodeRegion = (wireName: string): NodeRegion => {
  const tokens = wireName.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (tokens.some((token) => token.toLowerCase() === 'us')) return 'us'
  if (tokens.some((token) => token.toLowerCase() === 'jp')) return 'jp'
  return CITY_REGIONS[cityOf(wireName)] ?? 'other'
}
