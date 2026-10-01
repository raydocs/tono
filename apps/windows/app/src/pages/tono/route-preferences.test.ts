import { expect, it } from 'vitest'

import type { TonoRoutePreferences, TonoServer } from '@/services/tono'

import {
  ENDPOINT_MAX_AGE_MS,
  RECENT_ROUTE_MAX_AGE_MS,
  recommendRoute,
  type EndpointEvidence,
} from './route-preferences'

const now = 1_790_000_000_000
const server = (name: string, available = true): TonoServer => ({
  name,
  available,
  server: 'example.test',
  port: 443,
  selected: false,
})
const preferences: TonoRoutePreferences = {
  scope: 'owner-a:7',
  catalogRevision: 54,
  favorites: ['Tokyo · Dawn'],
  fixedRegion: null,
  recent: [
    { name: 'Buffalo · Niagara', revision: 54, verifiedAtMs: now - 60_000 },
  ],
}
const evidence: EndpointEvidence = {
  scope: 'owner-a:7',
  revision: 54,
  atMs: now - 1_000,
  latencies: {
    'Tokyo · Dawn': 8,
    'US unavailable': 1,
    retired: 2,
    'US failed': 3,
    'Buffalo · Niagara': 180,
  },
  failures: { 'US failed': 'failed' },
}

it('prefers verified recent success over fastest TCP and never proposes failed, unavailable, retired or wrong-region exits', () => {
  const servers = [
    server('US unavailable', false),
    server('US failed'),
    server('Tokyo · Dawn'),
    server('Buffalo · Niagara'),
  ]
  expect(
    recommendRoute(servers, preferences, preferences.scope, 54, evidence, now),
  ).toMatchObject({ name: 'Buffalo · Niagara', reason: 'recent' })
  const noRecent = { ...preferences, recent: [], fixedRegion: 'US' }
  expect(
    recommendRoute(servers, noRecent, preferences.scope, 54, evidence, now),
  ).toMatchObject({ name: 'Buffalo · Niagara', reason: 'tcp' })
  expect(
    recommendRoute(
      servers,
      { ...preferences, fixedRegion: 'SG' },
      preferences.scope,
      54,
      evidence,
      now,
    ),
  ).toBeNull()
  // A verified base transport never lends success to its hy2 sibling.
  expect(
    recommendRoute(
      [server('Buffalo · Niagara · hy2')],
      preferences,
      preferences.scope,
      54,
      evidence,
      now,
    ),
  ).toBeNull()
})

it('rejects stale, future, cross-account and cross-revision evidence rather than treating preferences as successful connections', () => {
  const servers = [server('Buffalo · Niagara')]
  expect(
    recommendRoute(servers, preferences, 'owner-b:8', 54, evidence, now),
  ).toBeNull()
  expect(
    recommendRoute(
      servers,
      { ...preferences, catalogRevision: 55 },
      preferences.scope,
      55,
      evidence,
      now,
    ),
  ).toBeNull()
  const stale = {
    ...preferences,
    recent: [
      { ...preferences.recent[0], verifiedAtMs: now - RECENT_ROUTE_MAX_AGE_MS },
    ],
  }
  const staleTcp = { ...evidence, atMs: now - ENDPOINT_MAX_AGE_MS }
  expect(
    recommendRoute(servers, stale, preferences.scope, 54, staleTcp, now),
  ).toBeNull()
  expect(
    recommendRoute(
      servers,
      {
        ...stale,
        recent: [
          {
            ...preferences.recent[0],
            verifiedAtMs: now - RECENT_ROUTE_MAX_AGE_MS + 1,
          },
        ],
      },
      preferences.scope,
      54,
      staleTcp,
      now,
    )?.reason,
  ).toBe('recent')
  expect(
    recommendRoute(
      servers,
      { ...preferences, recent: [] },
      preferences.scope,
      54,
      { ...evidence, atMs: now + 1 },
      now,
    ),
  ).toBeNull()
  expect(
    recommendRoute(
      servers,
      { ...preferences, recent: [] },
      preferences.scope,
      54,
      { ...evidence, scope: 'owner-b:8' },
      now,
    ),
  ).toBeNull()
  expect(
    recommendRoute(
      servers,
      { ...preferences, recent: [] },
      preferences.scope,
      54,
      { ...staleTcp, atMs: now - ENDPOINT_MAX_AGE_MS + 1 },
      now,
    )?.reason,
  ).toBe('tcp')
})
