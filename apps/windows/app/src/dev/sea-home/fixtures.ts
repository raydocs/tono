import { useSyncExternalStore } from 'react'

import type {
  TonoConnectProgress,
  TonoStatus,
  TonoUiState,
} from '../../services/tono'

// Retain the product's formatters/classifiers. This file replaces IO, never UI decisions.
export * from '../../services/tono'
export * from '../../services/states'
const params = new URLSearchParams(location.search)
const scenario = params.get('scenario') ?? 'idle'
const listeners = new Set<(status: TonoStatus) => void>()
const storeListeners = new Set<() => void>()
const initial: TonoUiState =
  scenario === 'unknown' || scenario === 'connected'
    ? 'connected'
    : ['protectedOffline', 'protectedUnknown', 'previous'].includes(scenario)
      ? 'protectedOffline'
      : scenario === 'connecting'
        ? 'connecting'
        : scenario === 'disconnecting'
          ? 'disconnecting'
          : 'notConnected'
let status: TonoStatus = {
  accountState:
    params.get('account') === 'signedOut'
      ? 'signedOut'
      : params.get('account') === 'suspended'
        ? 'suspended'
        : params.get('account') === 'error'
          ? 'error'
          : 'ready',
  uiState: initial,
  stage: initial === 'connecting' ? 'startingTunnel' : null,
  stageLabel: null,
  selectedServer: params.has('noLine')
    ? null
    : params.has('long')
      ? 'Los Angeles · An exceptionally long residential route name for overflow testing'
      : 'Tokyo · Sakura',
  protectionBlocked: initial === 'protectedOffline',
  killSwitch:
    (initial === 'connected' && scenario !== 'unknown') ||
    initial === 'protectedOffline'
      ? {
          wanted: true,
          live: scenario !== 'protectedUnknown',
          tunnel_permit_rendered: scenario === 'previous',
          mode: 'locked',
          endpoints: [],
          last_error: null,
        }
      : null,
  catalogRevision: 54,
  catalogRequiresChoice: params.has('choice'),
  controllerGeneration: 8,
  routePreferenceScope: 'preview:home',
  updateIncomplete: params.has('update'),
  exitDelayMs: 83,
  exitOrg: 'Example exit organization',
  exitLocation: 'Tokyo, Japan',
  claudeHomeActive: true,
}
const primaryName = status.selectedServer ?? 'Tokyo · Sakura'
const scheduledAt = params.has('scheduled')
  ? Date.now() +
    1000 * Math.max(1, Math.min(120, Number(params.get('scheduled')) || 15))
  : null
let attemptedAt = Date.now()
let failed = scenario === 'failed' || scenario === 'protectedOffline'
let transaction = 0
const calls: string[] = []
const push = (next: Partial<TonoStatus>) => {
  status = { ...status, ...next }
  for (const listener of listeners) listener(status)
  for (const listener of storeListeners) listener()
}
const subscribe = (listener: () => void) => {
  storeListeners.add(listener)
  return () => {
    storeListeners.delete(listener)
  }
}
window.addEventListener('preview-home-state', (event) => {
  const next = (event as CustomEvent<Partial<TonoStatus>>).detail
  failed =
    next.uiState === 'protectedOffline' ||
    (next.uiState === 'notConnected' && next.stage === 'failed')
  attemptedAt = Date.now()
  push(next)
})
window.addEventListener('preview-home-failed', () => {
  failed = true
  push({
    uiState: 'notConnected',
    stage: 'failed',
    protectionBlocked: false,
    killSwitch: null,
  })
})
export const useThemeMode = () =>
  useSyncExternalStore(subscribe, () =>
    params.get('theme') === 'light' ? 'light' : 'dark',
  )
export const tonoStatus = async () => status
export const subscribeTonoStatus = (listener: (status: TonoStatus) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const tonoConnect = async () => {
  calls.push('connect')
  document.body.dataset.calls = JSON.stringify(calls)
  failed = false
  attemptedAt = Date.now()
  const token = ++transaction
  push({
    uiState: 'connecting',
    stage: 'preparing',
    controllerGeneration: status.controllerGeneration + 1,
  })
  if (params.has('slow')) return
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (token !== transaction) return
  push({ stage: 'startingTunnel' })
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (token !== transaction) return
  push({ stage: 'verifyingTraffic' })
  await new Promise((resolve) => setTimeout(resolve, 600))
  if (token !== transaction) return
  push({
    uiState: 'connected',
    stage: null,
    killSwitch: {
      wanted: true,
      live: true,
      mode: 'locked',
      endpoints: [],
      last_error: null,
    },
  })
}
export const tonoDisconnect = async () => {
  calls.push('disconnect')
  document.body.dataset.calls = JSON.stringify(calls)
  ++transaction
  push({ uiState: 'disconnecting', stage: null })
  await new Promise((resolve) => setTimeout(resolve, 600))
  push({ uiState: 'notConnected', killSwitch: null, protectionBlocked: false })
}
export const tonoRetryNow = tonoConnect
export const tonoRetryRestore = tonoDisconnect
export const tonoSelectServer = async (name: string) => {
  calls.push(`select:${name}`)
  document.body.dataset.calls = JSON.stringify(calls)
  push({ selectedServer: name })
}
export const tonoServers = async () =>
  [primaryName, 'Buffalo · Niagara', 'Singapore · Harbor'].map((name) => ({
    name,
    server: '192.0.2.1',
    port: 443,
    available: true,
    selected: status.selectedServer === name,
  }))
export const tonoCatalogStatus = async () => ({
  revision: 54,
  nodeCount: 3,
  lastSyncedAtMs: Date.now(),
  error: null,
})
export const tonoRoutePreferences = async () => ({
  scope: 'preview:home',
  catalogRevision: 54,
  favorites: ['Buffalo · Niagara', 'Singapore · Harbor'],
  recent: [
    { name: primaryName, revision: 54, verifiedAtMs: Date.now() - 5000 },
  ],
  fixedRegion: null,
})
export const tonoConnectProgress = async (): Promise<TonoConnectProgress> => ({
  steps:
    status.uiState === 'connecting'
      ? [
          {
            key: status.stage ?? 'preparing',
            label: '',
            state: 'current',
            elapsedMs: Date.now() - attemptedAt,
          },
        ]
      : failed
        ? [
            {
              key: 'verifyingTraffic',
              label: '',
              state: 'failed',
              elapsedMs: 3100,
            },
          ]
        : [],
  totalElapsedMs:
    status.uiState === 'connecting'
      ? Date.now() - attemptedAt
      : failed
        ? 9100
        : null,
  failedStage: failed ? 'verifyingTraffic' : null,
  error: failed
    ? 'TONO_NODE_OR_CORE_UNREACHABLE: tunnel probe timed out'
    : null,
  retryAttempt: scenario === 'protectedOffline' ? 1 : 0,
  nextRetryAtMs: status.uiState === 'protectedOffline' ? scheduledAt : null,
})
export const tonoEncryptedDnsOverrides = async () => params.has('dns')
export const openWindowsDnsSettings = async () => {}
export const tonoAccount = async () => ({
  email: 'home-preview@example.test',
  suspended: false,
  deviceLimit: 3,
})
export const useTrafficData = () => {
  const current = useSyncExternalStore(subscribe, () => status)
  return {
    response: {
      data:
        current.uiState === 'connected' && !params.has('reading')
          ? {
              up: 320000,
              down: 2400000,
              upTotal: 10000000,
              downTotal: 1200000000,
            }
          : undefined,
    },
    live: current.uiState === 'connected' && !params.has('reading'),
    refreshGetClashTraffic: () => {},
  }
}
const emptyConnections = { activeConnections: [], closedConnections: [] }
export const useConnectionData = () => ({
  response: { data: useSyncExternalStore(subscribe, () => emptyConnections) },
  live: true,
  refreshGetClashConnection: () => {},
})

// The status hook imports visibility relatively; simulate only its native window API.
export const getCurrentWindow = () => ({
  isVisible: async () => true,
  onFocusChanged: async () => () => {},
  listen: async () => () => {},
})
