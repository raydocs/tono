import { navigationItems } from '@/pages/_navigation-meta'
import { TonoIcon } from '@/tono-ui/TonoIcon'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import type {
  TonoDiagnosticsReport,
  TonoLocalDiagnosticsReport,
  TonoRoutePreferences,
  TonoStatus,
} from '../../src/services/tono'

// Keep production formatters/classifiers; replace only the native IO boundary.
export * from '../../src/services/tono'
export {
  UpdateStateProvider,
  useUpdateState,
  useSetUpdateState,
} from '../../src/services/states'

const params = new URLSearchParams(location.search)
const scenario = params.get('scenario')
const status: TonoStatus = {
  accountState: 'ready',
  uiState:
    scenario === 'recovery' ||
    scenario === 'stopped' ||
    scenario === 'update-recovery'
      ? 'protectedOffline'
      : location.hash.includes('servers') || scenario === 'service'
        ? 'notConnected'
        : 'connected',
  stage: null,
  stageLabel: null,
  selectedServer: 'Tokyo · Sakura',
  protectionBlocked: false,
  killSwitch: null,
  catalogRevision: 54,
  catalogRequiresChoice: false,
  controllerGeneration: 8,
  routePreferenceScope: 'preview:7',
  updateIncomplete: scenario === 'update-recovery',
}

export const tonoStatusQueryKey = ['tonoStatus'] as const
export const tonoAccountQueryKey = ['tonoAccount'] as const
export const tonoDevicesQueryKey = ['tonoDevices'] as const
export const tonoServersQueryKey = ['tonoServers'] as const
export const tonoConnectProgressQueryKey = ['tonoConnectProgress'] as const

export const useThemeMode = () =>
  new URLSearchParams(location.search).get('theme') || 'light'
export const useTonoStatus = () => ({
  status: params.has('account')
    ? { ...status, accountState: params.get('account') }
    : status,
  mutateTonoStatus: async () => {},
})
export const useTrafficData = () => ({
  response: { data: undefined },
  live: false,
  refreshGetClashTraffic: async () => {},
})
export const tonoEncryptedDnsOverrides = async () => false
export const openWindowsDnsSettings = async () => {}
export const useUpdate = () => ({
  updateInfo: { version: '0.0.73', manifestSha256: 'a'.repeat(64) },
})
export const installUpdate = async (
  manifest: string,
  progress: (event: DownloadEvent) => void,
) => {
  document.body.dataset.updateManifest = manifest
  document.body.dataset.updateCalls = String(
    Number(document.body.dataset.updateCalls || 0) + 1,
  )
  progress({ event: 'Started', data: { contentLength: 1000 } })
  progress({ event: 'Progress', data: { chunkLength: 250 } })
  // Controlled native-I/O failure only. The production dialog/state/notice renderers run unchanged.
  await new Promise<void>((resolve) =>
    window.addEventListener('preview-refuse-update', () => resolve(), {
      once: true,
    }),
  )
  throw new Error(
    'Service refused the update; evidence and protection retained (simulated).',
  )
}
const wait = () =>
  new Promise((resolve) =>
    setTimeout(
      resolve,
      new URLSearchParams(location.search).has('slow') ? 3000 : 700,
    ),
  )
export const tonoSignInStart = async () => {
  await wait()
  return { expiresIn: 600 }
}
export const tonoSignInVerify = async (_email: string, code: string) => {
  await wait()
  if (code !== '123456')
    throw new Error(
      'That code did not work. Check the latest email and try again.',
    )
  return { suspended: false }
}
export const tonoDisconnect = async () => {}
export const tonoRetryRestore = async () => {}
export const tonoStatus = async () => status
export const subscribeTonoStatus = () => () => {}
export const tonoConnect = async () => {}
export const tonoRetryNow = async () => {}
export const tonoRepairService = async () => {
  await wait()
}
export const tonoCloseConnection = async () => {}
export const tonoCloseAllConnections = async () => {}
export const tonoCancelServerTests = async () => {}
export const tonoTestAvailableServers = async () => []
export const tonoTestCurrentServer = async () => 83
export const tonoSelectServer = async (name: string) => {
  status.selectedServer = name
}
export const tonoServers = async () => [
  {
    name: 'Tokyo · Sakura',
    server: '192.0.2.1',
    port: 443,
    selected: status.selectedServer === 'Tokyo · Sakura',
    available: true,
  },
  {
    name: 'Buffalo · Niagara',
    server: '192.0.2.2',
    port: 443,
    selected: status.selectedServer === 'Buffalo · Niagara',
    available: true,
  },
  {
    name: 'Buffalo · Niagara · hy2',
    server: '192.0.2.2',
    port: 443,
    selected: false,
    available: true,
  },
]
export const tonoCatalogStatus = async () => ({
  revision: 54,
  nodeCount: 3,
  lastSyncedAtMs: Date.now() - 60_000,
  error: null,
})
export const tonoRefreshCatalog = tonoCatalogStatus
let preferences: TonoRoutePreferences = {
  scope: 'preview:7',
  catalogRevision: 54,
  favorites: scenario === 'empty' ? [] : ['Buffalo · Niagara'],
  recent:
    scenario === 'empty'
      ? []
      : [
          {
            name: 'Buffalo · Niagara',
            revision: 54,
            verifiedAtMs: Date.now() - 60_000,
          },
        ],
  fixedRegion: scenario === 'empty' ? null : 'US',
}
export const tonoRoutePreferences = async () => preferences
export const tonoUpdateRoutePreferences = async (
  _scope: string,
  _revision: number,
  favorites: string[],
  fixedRegion: string | null,
) => {
  preferences = { ...preferences, favorites, fixedRegion }
  return preferences
}

const report = (): TonoDiagnosticsReport => ({
  schemaVersion: 1,
  reportedAtMs: Date.now(),
  appVersion: '0.0.73',
  osVersion: 'Windows 11 (preview fixture)',
  osArch: 'x86_64',
  serviceProtocol: scenario === 'service' ? null : '1.14',
  serviceBuild: scenario === 'service' ? null : '0.0.73',
  uiState: status.uiState,
  accountState: 'ready',
  selectedServer: status.selectedServer,
  catalogRevision: 54,
  killSwitchMode: 'locked',
  killSwitchWanted: true,
  killSwitchLive: true,
  killSwitchLastError: null,
  dnsEnabled: scenario === 'service' ? null : true,
  dnsLastError: null,
  failedStage: null,
  error: null,
  retryAttempt: 0,
  totalElapsedMs: 3210,
  steps: [{ key: 'verifyingTraffic', state: 'completed', elapsedMs: 1050 }],
  virtualAdapters: [],
  auditLogPath: '%USERPROFILE%/Tono/logs/traffic-audit.jsonl',
  serviceLogPath: 'C:\\ProgramData\\Tono\\logs\\tono-service.log',
})
export const tonoDiagnosticsReport = async () => report()
export const tonoLocalDiagnosticsReport =
  async (): Promise<TonoLocalDiagnosticsReport> => {
    await wait()
    if (scenario === 'error') throw new Error('fixture unavailable')
    return {
      ...report(),
      localEvidence: {
        status: 'collected',
        accountScope: 'preview:7',
        buildProvenance: 'candidate',
        appBuild: null,
        expectedCoreVersion: '1.19.30',
        reportedCoreVersion: scenario === 'mismatch' ? '1.18.0' : null,
        protectionLive:
          scenario === 'unknown' || scenario === 'service' ? null : true,
        protectionWanted: true,
        connectionGeneration: 5,
        controllerGeneration: 8,
        failureAtMs: null,
        coreLog: {
          status: 'unavailable',
          inspectedLines: 0,
          truncated: false,
          observations: [],
        },
      },
    }
  }
let frozen: TonoDiagnosticsReport | null = null
export const tonoPrepareSupportReport = async () => {
  await wait()
  frozen = report()
  return { previewId: 'preview-fixture', report: frozen }
}
export const tonoUploadDiagnostics = async () => {
  await wait()
  if (!frozen || scenario === 'upload-error')
    throw new Error('TONO_DIAG_UNREACHABLE')
  frozen = null
  return {
    referenceCode: 'TON-DEMO-073',
    receivedAt: Math.floor(Date.now() / 1000),
  }
}
export const tonoAuditLogPath = async () => ({
  path: '%USERPROFILE%/Tono/logs/traffic-audit.jsonl',
  droppedCount: 0,
})
export const tonoCheckTerminalEnv = async () => ({
  hasConflict: false,
  entries: [],
  claudeCodeReady: true,
  canAutoClear: false,
})
export const tonoClearTerminalProxyEnv = async () => {}
export const tonoConnectProgress = async () => ({
  steps: [
    { key: 'verifyingTraffic', label: '', state: 'failed', elapsedMs: 8000 },
  ],
  totalElapsedMs: 9100,
  failedStage: 'verifyingTraffic',
  error: 'TONO_NODE_OR_CORE_UNREACHABLE: tunnel probe timed out',
  retryAttempt: 1,
  nextRetryAtMs: scenario === 'recovery' ? Date.now() + 15_000 : null,
})
const connections = [
  {
    id: 'cloud',
    metadata: {
      process: 'Claude.exe',
      host: 'api.example.test',
      network: 'tcp',
      destinationPort: '443',
    },
    chains:
      scenario === 'selectors'
        ? ['Tono-Exit', 'Tono-Claude-Home']
        : ['Tokyo · Sakura', 'Tono-Exit', 'Tono-Claude-Home'],
    rule: 'DOMAIN-SUFFIX',
    rulePayload: 'example.test',
    upload: 128,
    download: 8192,
  },
  {
    id: 'unknown',
    metadata: {
      process: 'Claude.exe',
      host: 'unknown.example.test',
      network: 'tcp',
      destinationPort: '443',
    },
    chains: scenario === 'selectors' ? ['Tono-Claude-Home'] : [],
    rule: scenario === 'selectors' ? 'MATCH' : '',
    upload: 64,
    download: 256,
  },
  {
    id: 'direct',
    metadata: {
      process: 'WeChat.exe',
      host: 'chat.example.test',
      network: 'tcp',
      destinationPort: '443',
    },
    chains: ['DIRECT'],
    rule: 'PROCESS-NAME',
    rulePayload: 'WeChat.exe',
    upload: 128,
    download: 1024,
  },
]
export const useConnectionData = () => ({
  response: {
    data: {
      activeConnections: connections,
      closedConnections: [],
      uploadTotal: 320,
      downloadTotal: 9472,
    },
    live: true,
  },
  refreshGetClashConnection: async () => {},
})
export const SupportContact = () => <span>Contact Tono support</span>
export const navItems = Object.values(navigationItems).map((item) => ({
  ...item,
  icon: <TonoIcon name="dashboard" size={16} />,
}))
