/** i18n keys for connect FSM stages. Shared by the progress card and the pill. */
export const CONNECT_STAGE_LABEL_KEYS: Record<string, string> = {
  preparing: 'tono.progress.steps.preparing',
  preparingService: 'tono.progress.steps.preparingService',
  startingKillSwitch: 'tono.progress.steps.startingKillSwitch',
  startingTunnel: 'tono.progress.steps.startingTunnel',
  lockingTraffic: 'tono.progress.steps.lockingTraffic',
  applyingCloudPolicy: 'tono.progress.steps.applyingCloudPolicy',
  securingDNS: 'tono.progress.steps.securingDNS',
  checkingExit: 'tono.progress.steps.checkingExit',
  verifyingTraffic: 'tono.progress.steps.verifyingTraffic',
}
