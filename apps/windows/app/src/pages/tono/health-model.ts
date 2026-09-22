import type { TonoLocalDiagnosticsReport, TonoStatus } from '@/services/tono'

export type HealthState = 'observed' | 'attention' | 'unknown'
export const HEALTH_CHECK_KEYS = [
  'account',
  'catalog',
  'service',
  'core',
  'dns',
  'tunnel',
  'exit',
] as const

/** Classify only what was read. No intent, TCP latency or old failure implies live health. */
export const healthChecks = (
  report: TonoLocalDiagnosticsReport,
): Record<(typeof HEALTH_CHECK_KEYS)[number], HealthState> => {
  const local = report.localEvidence
  const connected = report.uiState === 'connected'
  return {
    account: report.accountState === 'ready' ? 'observed' : 'attention',
    catalog:
      report.catalogRevision != null && report.selectedServer != null
        ? 'observed'
        : 'attention',
    service: report.serviceProtocol != null ? 'observed' : 'unknown',
    core:
      !local?.reportedCoreVersion || !local.expectedCoreVersion
        ? 'unknown'
        : local.reportedCoreVersion === local.expectedCoreVersion
          ? 'observed'
          : 'attention',
    dns:
      report.dnsEnabled == null
        ? 'unknown'
        : report.dnsLastError
          ? 'attention'
          : connected
            ? report.dnsEnabled
              ? 'observed'
              : 'attention'
            : 'unknown',
    tunnel:
      local?.protectionLive == null || local.protectionWanted == null
        ? 'unknown'
        : local.protectionWanted && local.protectionLive
          ? 'observed'
          : connected || local.protectionWanted
            ? 'attention'
            : 'unknown',
    exit:
      connected &&
      report.steps.some(
        (step) => step.key === 'verifyingTraffic' && step.state === 'completed',
      )
        ? 'observed'
        : 'unknown',
  }
}

export const healthIsCurrent = (
  report: TonoLocalDiagnosticsReport,
  status?: TonoStatus,
) =>
  !!status &&
  report.localEvidence?.accountScope === status.routePreferenceScope &&
  report.localEvidence?.controllerGeneration === status.controllerGeneration &&
  report.uiState === status.uiState &&
  report.accountState === status.accountState &&
  report.selectedServer === status.selectedServer &&
  report.catalogRevision === status.catalogRevision
