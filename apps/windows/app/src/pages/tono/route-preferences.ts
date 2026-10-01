import type { TonoRoutePreferences, TonoServer } from '@/services/tono'

import { catalogBaseName, hy2UdpIsVendorBlocked, nodeCode } from './node-meta'

export const RECENT_ROUTE_MAX_AGE_MS = 86_400_000
export const ENDPOINT_MAX_AGE_MS = 120_000
export const MAX_FAVORITES = 24

export interface EndpointEvidence {
  scope: string | null
  revision: number | null
  atMs: number
  latencies: Record<string, number>
  failures: Record<string, 'timeout' | 'failed'>
}

const fresh = (atMs: number, now: number, ttl: number) =>
  Number.isFinite(atMs) && atMs > 0 && now >= atMs && now - atMs < ttl

export const preferencesMatch = (
  preferences: TonoRoutePreferences | undefined,
  scope: string | null | undefined,
  revision: number | null | undefined,
): preferences is TonoRoutePreferences =>
  !!scope &&
  preferences?.scope === scope &&
  preferences.catalogRevision === revision

export const endpointEvidenceMatches = (
  evidence: EndpointEvidence,
  scope: string | null | undefined,
  revision: number | null | undefined,
  now: number,
) =>
  !!scope &&
  evidence.scope === scope &&
  evidence.revision === revision &&
  fresh(evidence.atMs, now, ENDPOINT_MAX_AGE_MS)

export const recentRoutes = (
  preferences: TonoRoutePreferences,
  servers: readonly TonoServer[],
  now: number,
) =>
  preferences.recent
    .filter(
      (entry) =>
        fresh(entry.verifiedAtMs, now, RECENT_ROUTE_MAX_AGE_MS) &&
        servers.some(
          (server) =>
            server.name === entry.name &&
            server.available &&
            !hy2UdpIsVendorBlocked(server.name),
        ),
    )
    .slice(0, 8)

export interface RouteRecommendation {
  name: string
  reason: 'recent' | 'tcp'
  atMs: number
}

/** Only fresh evidence can propose a route; preference alone is not reachability.
 * History is exact transport + catalog revision, while favorites share the hy2 base identity.
 * Fixed region is a constraint: no quiet fallback to a different region.
 */
export const recommendRoute = (
  servers: readonly TonoServer[],
  preferences: TonoRoutePreferences | undefined,
  scope: string | null | undefined,
  revision: number | null | undefined,
  evidence: EndpointEvidence,
  now: number,
): RouteRecommendation | null => {
  if (!preferencesMatch(preferences, scope, revision)) return null
  const endpointsCurrent = endpointEvidenceMatches(
    evidence,
    scope,
    revision,
    now,
  )
  const recent = recentRoutes(preferences, servers, now).filter(
    (entry) => entry.revision === revision,
  )
  const candidates = servers.flatMap((server) => {
    if (
      !server.available ||
      hy2UdpIsVendorBlocked(server.name) ||
      (preferences.fixedRegion &&
        nodeCode(server.name) !== preferences.fixedRegion) ||
      (endpointsCurrent && evidence.failures[server.name])
    )
      return []
    const verified = recent.find((entry) => entry.name === server.name)
    const tcp = endpointsCurrent ? evidence.latencies[server.name] : undefined
    const reachable = tcp !== undefined && Number.isFinite(tcp) && tcp > 0
    if (!verified && !reachable) return []
    return [
      {
        name: server.name,
        reason: verified ? ('recent' as const) : ('tcp' as const),
        atMs: verified?.verifiedAtMs ?? evidence.atMs,
        favorite: preferences.favorites.includes(catalogBaseName(server.name)),
        latency: reachable ? tcp : Number.POSITIVE_INFINITY,
      },
    ]
  })
  candidates.sort(
    (a, b) =>
      Number(b.reason === 'recent') - Number(a.reason === 'recent') ||
      Number(b.favorite) - Number(a.favorite) ||
      b.atMs - a.atMs ||
      a.latency - b.latency ||
      a.name.localeCompare(b.name),
  )
  return candidates[0] ?? null
}
