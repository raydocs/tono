/* eslint-disable @eslint-react/no-unnecessary-use-prefix -- Stateless adapters retain the production hook names; this dev-only entry has no native hook effects. */
import { createTheme } from '@mui/material'
import i18n from 'i18next'

import { tonoStatus as simulatedStatus } from '../sea-home/fixtures'

// Existing product UI/status push, synthetic IO only. This separate entry cannot contact a device.
export * from '../sea-home/fixtures'
export * from '../../services/cmds'
// Avoid ambiguous re-exports; both ports share these simulated adapters.
export {
  tonoEncryptedDnsOverrides,
  openWindowsDnsSettings,
} from '../sea-home/fixtures'
const params = new URLSearchParams(location.search)
const theme = createTheme({
  palette: {
    mode:
      params.get('appearance') === 'old' && params.get('theme') === 'light'
        ? 'light'
        : 'dark',
  },
})
export const useCustomTheme = () => ({ theme })
export const useLoadingOverlay = () => {}
export const useLayoutEvents = () => {}
export const useI18n = () => ({
  currentLanguage: i18n.language,
  supportedLanguages: ['zh', 'en'],
  switchLanguage: async () => {},
  isLoading: false,
  t: i18n.t,
})
export const useTonoPreferences = () => ({
  preferences: {
    language: params.get('lang') === 'zh' ? 'zh' : 'en',
    theme_mode: 'dark',
    enable_auto_launch: false,
    auto_check_update: false,
  },
  patchPreferences: async () => {},
  mutatePreferences: () => {},
})
export const useUpdate = () => ({
  updateInfo: null,
  checkUpdate: async () => null,
  loading: false,
  lastCheckUpdate: null,
})
let decorated = true
const currentWindow = {
  isDecorated: async () => decorated,
  setDecorations: async (value: boolean) => {
    decorated = value
  },
  startResizeDragging: async () => {},
}
const noop = async () => {}
export const useWindowControls = () => ({
  currentWindow,
  maximized: false,
  minimize: noop,
  toggleMaximize: noop,
  close: noop,
  toggleFullscreen: noop,
})
export const useWindowDecorations = () => ({
  decorated: true,
  refreshDecorated: noop,
  toggleDecorations: noop,
})
export const tonoServicePrerequisites = async () => ({
  serviceRegistered: true,
  serviceRunning: true,
  bfeRunning: true,
})
export const tonoDevices = async () => [
  {
    id: 'synthetic-device',
    name: 'Preview Computer',
    current: true,
    createdAt: 1790000000,
  },
  {
    id: 'synthetic-other-device',
    name: 'Example Laptop',
    current: false,
    createdAt: 1790000000,
  },
]
export const tonoAuditEnabled = async () => false
export const tonoAuditLogPath = async () => ({
  path: 'C:\\Tono-preview\\audit.log',
  exists: false,
  bytes: 0,
})
export const tonoInternalBuild = async () => false
export const tonoPeriodicTelemetryEnabled = async () => false
export const tonoNetworkLogUploadEnabled = async () => false
export const tonoDiagnosticsReport = async () => {
  throw new Error('Synthetic preview: no machine diagnostics')
}
export const tonoCheckTerminalEnv = async () => ({ variables: [], sources: [] })
export const tonoCancelServerTests = async () => {}
export const tonoRefreshCatalog = async () => {}
export const tonoTestCurrentServer = async () => 83
export const tonoTestAvailableServers = async () => []

// Catalog cardinality/long-name fixtures, never a production catalog.
export const tonoServers = async () => {
  const status = await simulatedStatus()
  const count = Math.max(1, Math.min(40, Number(params.get('count')) || 3))
  const first = status.selectedServer ?? 'Tokyo · Sakura'
  const names = [
    first,
    'Buffalo · Niagara',
    'Singapore · Harbor',
    ...Array.from(
      { length: 37 },
      (_, index) => `Los Angeles · Preview ${index + 4}`,
    ),
  ].slice(0, count)
  return names.map((name, index) => ({
    name:
      params.has('long') && index > 0
        ? `${name} · A deliberately long synthetic server label for layout verification`
        : name,
    server: '192.0.2.1',
    port: 443,
    available: !params.has('unavailable') || index !== count - 1,
    selected: name === status.selectedServer,
  }))
}
export const tonoCatalogStatus = async () => ({
  revision: 54,
  nodeCount: (await tonoServers()).length,
  lastSyncedAtMs: Date.now(),
  error: null,
})
let preference = {
  scope: 'preview:home',
  catalogRevision: 54,
  favorites: ['Buffalo · Niagara', 'Singapore · Harbor'],
  recent: [] as { name: string; revision: number; verifiedAtMs: number }[],
  fixedRegion: null as string | null,
}
export const tonoRoutePreferences = async () => ({
  ...preference,
  recent: [
    {
      name: (await simulatedStatus()).selectedServer ?? 'Tokyo · Sakura',
      revision: 54,
      verifiedAtMs: Date.now() - 5000,
    },
  ],
})
export const tonoUpdateRoutePreferences = async (
  scope: string,
  revision: number,
  favorites: string[],
  fixedRegion: string | null,
) => {
  if (scope !== preference.scope || revision !== preference.catalogRevision)
    throw new Error('Synthetic stale preference')
  preference = { ...preference, favorites, fixedRegion }
  return tonoRoutePreferences()
}

// Sign-in fixture uses no credentials or network; only synthetic status events.
export const tonoSignInStart = async () => {
  window.dispatchEvent(
    new CustomEvent('preview-home-state', {
      detail: { accountState: 'authenticating' },
    }),
  )
  return { challengeId: 'synthetic', expiresIn: 600, message: '' }
}
export const tonoSignInVerify = async () => {
  if (params.has('badCode'))
    throw new Error('TONO_AUTH_INVALID_CODE: Synthetic rejected code')
  const suspended = params.has('paused')
  window.dispatchEvent(
    new CustomEvent('preview-home-state', {
      detail: { accountState: suspended ? 'suspended' : 'ready' },
    }),
  )
  return { email: 'preview@example.test', suspended, deviceLimit: 3 }
}

// Populated, privacy-safe activity/account fixtures; no native feed or account IO.
export const tonoAccount = async () => ({
  email: params.has('long')
    ? 'a-deliberately-long-synthetic-account@example.test'
    : 'home-preview@example.test',
  suspended: false,
  deviceLimit: 3,
  plan: 'Pro',
  quotaBytes: 100 * 1024 ** 3,
  usageBytes: 12 * 1024 ** 3,
  expiresAt: 1790000000,
})
const activityConnections: IConnectionsItem[] = params.has('empty')
  ? []
  : Array.from({ length: 27 }, (_, index) => ({
      id: `synthetic-flow-${index}`,
      metadata: {
        network: index % 2 ? 'udp' : 'tcp',
        type: 'HTTPS',
        host: `flow-${index}.example.test`,
        sourceIP: '192.0.2.2',
        sourcePort: '50000',
        destinationIP: '192.0.2.1',
        destinationPort: '443',
        remoteDestination: '',
        process: index < 23 ? 'Example Browser.exe' : 'Example Mail.exe',
        processPath: '',
      },
      upload: 0,
      download: 0,
      start: '2026-10-06T00:00:00Z',
      chains:
        index % 4 === 0
          ? ['DIRECT']
          : index % 4 === 1
            ? ['REJECT-DROP']
            : index % 4 === 2
              ? ['Tono-Home-Residential']
              : ['Tokyo · Sakura', 'Tono-Exit'],
      rule: 'DOMAIN-SUFFIX',
      rulePayload: 'example.test',
    }))
export const useConnectionData = () => ({
  response: {
    data: {
      activeConnections: params.has('reading') ? [] : activityConnections,
      closedConnections: [],
    },
    live: !params.has('reading'),
  },
  refreshGetClashConnection: () => {},
})
export const tonoCloseConnection = async () => {}
export const tonoCloseAllConnections = async () => {}
export const tonoRevokeDevice = async () => {}
