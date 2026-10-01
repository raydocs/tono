import {
  activityProcessFamily,
  classifyActivityRoute,
} from '@/pages/tono/activity-model'

/**
 * Local-only tally of AI apps' home-broadband bytes per local day. It is
 * traffic, never a quota: nothing here reads a provider token or asks a
 * provider anything, and the tally never leaves this machine.
 *
 * Claude Desktop and the Claude CLI share Claude.exe on Windows, so they are
 * one row (see `activityProcessFamily`).
 */
export const AI_TRAFFIC_FAMILIES = [
  'Claude',
  'ChatGPT',
  'Cursor',
  'Grok',
] as const
export type AiTrafficFamily = (typeof AI_TRAFFIC_FAMILIES)[number]

export const AI_TRAFFIC_DAYS = 7

/** Local day (`YYYY-MM-DD`) → family → bytes. */
export type AiTrafficDays = Record<
  string,
  Partial<Record<AiTrafficFamily, number>>
>

type AiConnection = Pick<
  IConnectionsItem,
  'id' | 'chains' | 'rule' | 'upload' | 'download' | 'metadata'
>

const isAiFamily = (family: string | undefined): family is AiTrafficFamily =>
  family !== undefined && (AI_TRAFFIC_FAMILIES as readonly string[]).includes(family)

/**
 * Adds the bytes each home-routed AI connection moved since it was last seen.
 * `seen` holds each connection's cumulative bytes; a connection is only ever
 * counted forward, so replaying a frame adds nothing.
 */
export const accumulateAiTraffic = (
  days: AiTrafficDays,
  seen: Map<string, number>,
  connections: readonly AiConnection[],
  day: string,
): AiTrafficDays => {
  let next = days
  for (const connection of connections) {
    const family = activityProcessFamily(
      connection.metadata.process,
      connection.metadata.processPath,
    )
    if (!isAiFamily(family)) continue
    if (classifyActivityRoute(connection) !== 'home') continue
    const bytes = Math.max(0, connection.upload + connection.download)
    const previous = seen.get(connection.id) ?? 0
    seen.set(connection.id, Math.max(previous, bytes))
    const delta = bytes - previous
    if (delta <= 0) continue
    if (next === days) next = { ...days }
    const today = { ...next[day] }
    today[family] = (today[family] ?? 0) + delta
    next[day] = today
  }
  return next
}

/** Keeps the newest `AI_TRAFFIC_DAYS` days. */
export const pruneAiTrafficDays = (days: AiTrafficDays): AiTrafficDays =>
  Object.fromEntries(
    Object.keys(days)
      .sort()
      .slice(-AI_TRAFFIC_DAYS)
      .map((key) => [key, days[key] ?? {}]),
  )

export const aiTrafficDayTotal = (
  day: Partial<Record<AiTrafficFamily, number>> | undefined,
) => Object.values(day ?? {}).reduce((sum, bytes) => sum + (bytes ?? 0), 0)

const STORAGE_PREFIX = 'tono.aiTraffic.v1:'

/** Per-account key so a second account on this PC never sees the first one's tally. */
export const aiTrafficStorageKey = async (email: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.trim().toLowerCase()),
  )
  const hex = [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `${STORAGE_PREFIX}${hex}`
}

export const loadAiTrafficDays = (key: string): AiTrafficDays => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const days: AiTrafficDays = {}
    for (const [day, value] of Object.entries(parsed)) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !value ||
        typeof value !== 'object'
      )
        continue
      const families: Partial<Record<AiTrafficFamily, number>> = {}
      for (const [family, bytes] of Object.entries(value)) {
        if (isAiFamily(family) && typeof bytes === 'number' && bytes > 0) {
          families[family] = bytes
        }
      }
      days[day] = families
    }
    return pruneAiTrafficDays(days)
  } catch {
    return {}
  }
}

export const saveAiTrafficDays = (key: string, days: AiTrafficDays) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(pruneAiTrafficDays(days)))
  } catch {
    /* quota: the tally is best-effort */
  }
}
