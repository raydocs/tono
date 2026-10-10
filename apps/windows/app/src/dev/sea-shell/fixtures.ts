/* eslint-disable @eslint-react/no-unnecessary-use-prefix -- Stateless adapters retain the production hook names; this dev-only entry has no native hook effects. */
import { createTheme } from '@mui/material'

import type {
  TonoDiagnosticsReport,
  TonoLocalDiagnosticsReport,
} from '../../services/tono'
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
export { useI18n } from '../../hooks/use-i18n'
export {
  useTonoPreferences,
  readGeneralSave,
  tonoGeneralSaveQueryKey,
  type GeneralSave,
} from '../../hooks/use-tono-preferences'
let generalPreferences: TonoPreferences = {
  language: params.get('lang') === 'zh' ? 'zh' : 'en',
  theme_mode: 'dark',
  enable_auto_launch: false,
  auto_check_update: false,
}
let generalReadFailed = false
let generalSaveFailed = false
export const getTonoPreferences = async () => {
  await privacyDelay('generalReadDelay')
  if (params.has('generalReadError') && !generalReadFailed) {
    generalReadFailed = true
    throw new Error('Synthetic settings read failure')
  }
  return { ...generalPreferences }
}
export const patchTonoPreferences = async (value: Partial<TonoPreferences>) => {
  generalPreferences = { ...generalPreferences, ...value }
  await privacyDelay('generalSaveDelay')
  if (params.has('generalSaveError') && !generalSaveFailed) {
    generalSaveFailed = true
    throw new Error('Synthetic settings lost reply; value may be saved')
  }
}
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
let auditChoice = false
let telemetryChoice = false
let networkChoice = false
let privacyReadFailed = false
let privacySaveFailed = false
const privacyDelay = (name: string) =>
  new Promise<void>((resolve) =>
    setTimeout(
      resolve,
      Math.max(0, Math.min(30000, Number(params.get(name)) || 0)),
    ),
  )
export const tonoAuditEnabled = async () => auditChoice
export const tonoSetAuditEnabled = async (value: boolean) => {
  auditChoice = value
}
export const tonoAuditLogPath = async () => ({
  path: 'C:\\Tono-preview\\audit.log',
  exists: false,
  bytes: 0,
})
export const tonoInternalBuild = async () => false
export const tonoPeriodicTelemetryEnabled = async () => telemetryChoice
export const tonoSetPeriodicTelemetryEnabled = async (value: boolean) => {
  telemetryChoice = value
}
// Privacy feedback uses only synthetic local state; no native consent or upload.
export const tonoNetworkLogUploadEnabled = async () => {
  await privacyDelay('privacyReadDelay')
  if (params.has('privacyReadError') && !privacyReadFailed) {
    privacyReadFailed = true
    throw new Error('Synthetic saved-choice read failure')
  }
  return networkChoice
}
export const tonoSetNetworkLogUploadEnabled = async (value: boolean) => {
  await privacyDelay('privacySaveDelay')
  if (params.has('privacySaveError') && !privacySaveFailed) {
    privacySaveFailed = true
    throw new Error('Synthetic persistence refusal')
  }
  networkChoice = value
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

export const tonoDiagnosticsReport =
  async (): Promise<TonoDiagnosticsReport> => {
    if (params.has('diagnosticError'))
      throw new Error('Synthetic diagnostics unavailable')
    const status = await simulatedStatus()
    return {
      schemaVersion: 1,
      reportedAtMs: Date.now(),
      appVersion: '0.0.75',
      osVersion: 'Synthetic Windows preview',
      osArch: 'x86_64',
      serviceProtocol: 'SYNTHETIC',
      serviceBuild: 'RENDER-ONLY',
      uiState: status.uiState,
      accountState: status.accountState,
      selectedServer: status.selectedServer,
      catalogRevision: status.catalogRevision,
      killSwitchMode: status.killSwitch?.mode ?? null,
      killSwitchWanted: status.killSwitch?.wanted ?? null,
      killSwitchLive: status.killSwitch?.live ?? null,
      killSwitchLastError: null,
      dnsEnabled: null,
      dnsLastError: null,
      failedStage: null,
      error: null,
      retryAttempt: 0,
      totalElapsedMs: null,
      steps: [],
      virtualAdapters: [],
      auditLogPath: 'C:\\Tono-preview\\audit.log',
      serviceLogPath: 'C:\\Tono-preview\\service.log',
    }
  }
export const tonoLocalDiagnosticsReport =
  async (): Promise<TonoLocalDiagnosticsReport> => {
    const report = await tonoDiagnosticsReport(),
      status = await simulatedStatus()
    return {
      ...report,
      localEvidence: {
        status: 'collected',
        coreLog: {
          status: 'synthetic-not-read',
          inspectedLines: 0,
          truncated: false,
          observations: [],
        },
        buildProvenance: 'development',
        appBuild: 'SYNTHETIC-RENDER-ONLY',
        accountScope: status.routePreferenceScope,
        connectionGeneration: 8,
        controllerGeneration: status.controllerGeneration ?? 8,
        failureAtMs: null,
        protectionLive: report.killSwitchLive,
        protectionWanted: report.killSwitchWanted,
        expectedCoreVersion: null,
        reportedCoreVersion: null,
      },
    }
  }
export const tonoPrepareSupportReport = async () => ({
  previewId: 'synthetic-no-upload',
  report: await tonoDiagnosticsReport(),
})
export const tonoUploadDiagnostics = async () => {
  throw new Error('Synthetic preview: no upload')
}
