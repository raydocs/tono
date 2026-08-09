export type ActivityRoute = 'proxied' | 'direct' | 'rejected' | 'local'

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

const processName = (metadata: IConnectionsItem['metadata']) => {
  const value = metadata.process || metadata.processPath || ''
  // A full executable path can expose the Windows account name and private directory names.
  return limitText(value.split(/[\\/]/).pop() || '', 100)
}

export const classifyActivityRoute = (
  connection: Pick<IConnectionsItem, 'chains' | 'rule'>,
): ActivityRoute => {
  // Mihomo orders chains from terminal outbound to enclosing selector groups. Group/node names
  // are user/catalog data and must not be interpreted as built-in route actions.
  const terminal = connection.chains[0]?.trim()
  if (terminal === 'REJECT' || terminal === 'REJECT-DROP') return 'rejected'
  if (terminal === 'DIRECT') return 'direct'
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

  return {
    id: connection.id,
    process: process || '—',
    target,
    protocol: protocol || '—',
    route,
    rule,
    searchText: `${process} ${target} ${protocol} ${rule}`.toLowerCase(),
  }
}
