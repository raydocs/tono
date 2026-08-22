export type ActivityRoute = 'proxied' | 'home' | 'direct' | 'rejected' | 'local'

const HOME_CHAIN_HOPS = new Set(['Tono-Home-Residential', 'Tono-Claude-Home'])

export interface ActivityRow {
  id: string
  process: string
  target: string
  protocol: string
  route: ActivityRoute
  rule: string
  searchText: string
}

const limitText = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value

const stripControlCharacters = (value: string) =>
  [...value]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')

/** Remove URL credentials, query/fragment data, control characters and URL paths. */
export const sanitizeActivityValue = (raw?: string) => {
  let value = stripControlCharacters(raw ?? '').trim()
  if (!value) return ''

  try {
    const parsed = new URL(value)
    value = parsed.hostname
    if (parsed.port) value += `:${parsed.port}`
    return limitText(value, 180)
  } catch {
    // Mihomo normally sends a hostname rather than a URL. Handle malformed or schemeless
    // URL-like values without ever reflecting credentials/query data into the WebView.
  }

  value = value.split(/[?#]/, 1)[0]
  const scheme = value.indexOf('://')
  if (scheme >= 0) value = value.slice(scheme + 3)
  const slash = value.indexOf('/')
  if (slash >= 0) value = value.slice(0, slash)
  const at = value.lastIndexOf('@')
  if (at >= 0) value = value.slice(at + 1)
  return limitText(value.trim(), 180)
}

/** Stable Activity group for native WeChat and its helpers. The UI translates this. */
export const WECHAT_ACTIVITY_PROCESS = 'WeChat'

const WECHAT_PROCESS_STEMS = new Set([
  'wechat',
  'weixin',
  'xwechat',
  'wechatappex',
  'wechatplayer',
  'weixinplay',
  'wechatapp',
  'weixinapp',
  'wechatbrowser',
  'wxplayer',
  'wxocr',
])

const fileStem = (value: string) =>
  (value.split(/[\\/]/).pop() || '')
    .replace(/\.exe$/i, '')
    .trim()
    .toLowerCase()

/** Native WeChat product processes, not WeCom / WeChat Work. */
export const isWeChatActivityProcess = (process?: string, processPath?: string) => {
  const stem = fileStem(process || processPath || '')
  if (!stem) return false
  if (
    stem.includes('work') ||
    stem.includes('wecom') ||
    stem.includes('wxwork')
  ) {
    return false
  }
  if (
    WECHAT_PROCESS_STEMS.has(stem) ||
    stem.startsWith('wechat') ||
    stem.startsWith('weixin') ||
    stem.startsWith('xwechat') ||
    stem.startsWith('wxplayer') ||
    stem.startsWith('wxocr')
  ) {
    return true
  }
  const path = (processPath || '').replace(/\//g, '\\').toLowerCase()
  return (
    path.includes('\\tencent\\wechat\\') ||
    path.includes('\\tencent\\weixin\\') ||
    path.includes('\\tencent\\xwechat\\') ||
    path.includes('\\wechatapp\\')
  )
}

const ACTIVITY_FAMILY_STEMS: Record<string, string> = {
  cursor: 'Cursor',
  code: 'Code',
  claude: 'ClaudeCode',
  chatgpt: 'ChatGPT',
  grok: 'Grok',
  chrome: 'Chrome',
}

export const activityProcessFamily = (
  process?: string,
  processPath?: string,
) => {
  if (isWeChatActivityProcess(process, processPath)) {
    return WECHAT_ACTIVITY_PROCESS
  }
  const stem = fileStem(process || processPath || '')
  if (!stem) return ''
  if (ACTIVITY_FAMILY_STEMS[stem]) return ACTIVITY_FAMILY_STEMS[stem]
  if (stem.startsWith('cursor')) return 'Cursor'
  if (stem.startsWith('code -')) return 'Code'
  const file = (process || processPath || '').split(/[\\/]/).pop() || ''
  return limitText(file, 100)
}

const processName = (metadata: IConnectionsItem['metadata']) => {
  const family = activityProcessFamily(metadata.process, metadata.processPath)
  if (family) return family
  const value = metadata.process || metadata.processPath || ''
  const file = value.split(/[\\/]/).pop() || ''
  // A full executable path can expose the Windows account name and private directory names.
  return limitText(file, 100)
}

export const classifyActivityRoute = (
  connection: Pick<IConnectionsItem, 'chains' | 'rule'>,
): ActivityRoute => {
  // Mihomo orders chains from terminal outbound to enclosing selector groups. Group/node names
  // are user/catalog data and must not be interpreted as built-in route actions. The two
  // Tono direct groups (mirrors DIRECT_GROUP_NAME/WEB_DIRECT_GROUP_NAME in tono-core config.rs)
  // terminate on the physical interface — that IS a direct route, not a proxy hop.
  const hops = connection.chains.map((hop) => hop.trim())
  const terminal = hops[0]
  if (terminal === 'REJECT' || terminal === 'REJECT-DROP') return 'rejected'
  if (
    terminal === 'DIRECT' ||
    terminal === 'Tono-China-Direct' ||
    terminal === 'Tono-China-Web-Direct'
  ) {
    return 'direct'
  }
  if (hops.some((hop) => HOME_CHAIN_HOPS.has(hop))) {
    return 'home'
  }
  return 'proxied'
}

export const toActivityRow = (connection: IConnectionsItem): ActivityRow => {
  const { metadata } = connection
  const process = processName(metadata)
  const host = sanitizeActivityValue(
    metadata.host || metadata.destinationIP || metadata.remoteDestination,
  )
  const port = String(metadata.destinationPort || '')
    .replace(/\D/g, '')
    .slice(0, 5)
  const portSuffix = port && !host.endsWith(`:${port}`) ? `:${port}` : ''
  const target = limitText(host ? `${host}${portSuffix}` : '—', 200)
  const protocol = [metadata.type, metadata.network]
    .map((value) => sanitizeActivityValue(value).toUpperCase())
    .filter(Boolean)
    .join(' · ')
  const ruleName = sanitizeActivityValue(connection.rule)
  const rulePayload = sanitizeActivityValue(connection.rulePayload)
  const rule = limitText(
    rulePayload ? `${ruleName} (${rulePayload})` : ruleName || '—',
    220,
  )
  // Loopback targets (every app's DNS to the core's 127.0.0.1:53 hijack listener,
  // plus anything else local) terminate in DIRECT by design but are not "direct
  // Internet" — showing them as 直连 reads as a leak that does not exist.
  const route = /^127\.|^::1$|^\[::1\]$/.test(host)
    ? ('local' as const)
    : classifyActivityRoute(connection)

  const originalProcess = limitText(
    (metadata.process || metadata.processPath || '').split(/[\\/]/).pop() || '',
    100,
  )
  return {
    id: connection.id,
    process: process || '—',
    target,
    protocol: protocol || '—',
    route,
    rule,
    searchText:
      `${process} ${originalProcess} wechat weixin 微信 ${target} ${protocol} ${rule}`.toLowerCase(),
  }
}

export interface ActivityAppRow {
  process: string
  total: number
  direct: number
  home: number
  proxied: number
  rejected: number
  local: number
  searchText: string
}

export const aggregateActivityApps = (rows: ActivityRow[]): ActivityAppRow[] => {
  const byProcess = new Map<string, ActivityAppRow>()
  for (const row of rows) {
    const current = byProcess.get(row.process) ?? {
      process: row.process,
      total: 0,
      direct: 0,
      home: 0,
      proxied: 0,
      rejected: 0,
      local: 0,
      searchText: row.process.toLowerCase(),
    }
    current.total += 1
    current[row.route] += 1
    byProcess.set(row.process, current)
  }
  return [...byProcess.values()].sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total
    return left.process.localeCompare(right.process)
  })
}
