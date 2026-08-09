/**
 * Tono node presentation metadata: user-facing display names, flag emoji, and
 * the protocol line, derived from the catalog's wire names. The server
 * address itself is never shown — that is Tono's idea of redaction.
 */

const NODE_DISPLAY_NAMES: Record<string, string> = {
  'US-VLESS-Reality': 'Los Angeles · Grove',
  'JP-VLESS-Reality': 'Tokyo · Dawn',
}

export const nodeDisplayName = (wireName: string) =>
  NODE_DISPLAY_NAMES[wireName] ?? wireName

/**
 * Per-city landmark emoji: easier to tell nodes apart at a glance than a row
 * of identical flags. Keyed by the lowercase city segment of the *display*
 * name so legacy wire names (US-VLESS-Reality → Los Angeles · Grove) pick up
 * their city's icon too. Falls back to the region flag, then 🌐.
 */
const CITY_EMOJI: Record<string, string> = {
  'los angeles': '🌴',
  'salt lake city': '🏔️',
  buffalo: '🦬',
  'new york': '🗽',
  'san jose': '💻',
  seattle: '☕',
  chicago: '🌭',
  dallas: '🤠',
  miami: '🏖️',
  tokyo: '🗼',
  osaka: '🏯',
}

export const nodeFlag = (wireName: string) => {
  const emoji = CITY_EMOJI[cityOf(nodeDisplayName(wireName))]
  if (emoji) return emoji
  const region = nodeRegion(wireName)
  if (region === 'us') return '🇺🇸'
  if (region === 'jp') return '🇯🇵'
  return '🌐'
}

export const nodeProtocol = (wireName: string) =>
  /vless/i.test(wireName) ? 'VLESS · Reality' : 'Tono Cloud'

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

/** Keep the UI's groups aligned with the backend's region ranking. */
export const nodeRegion = (wireName: string): NodeRegion => {
  const tokens = wireName.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (tokens.some((token) => token.toLowerCase() === 'us')) return 'us'
  if (tokens.some((token) => token.toLowerCase() === 'jp')) return 'jp'
  return CITY_REGIONS[cityOf(wireName)] ?? 'other'
}
