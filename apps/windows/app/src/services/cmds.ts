import { invoke } from '@tauri-apps/api/core'

export async function getVergeConfig() {
  return invoke<IVergeConfig>('get_verge_config')
}

export async function patchVergeConfig(payload: IVergeConfig) {
  return invoke<void>('patch_verge_config', { payload })
}

export async function restartApp() {
  return invoke<void>('restart_app')
}

// 获取当前运行模式
export type RunningMode = 'Service' | 'Sidecar' | 'NotRunning'

type ServiceHealth =
  | 'unknown'
  | 'ready'
  | 'notInstalled'
  | 'versionMismatch'
  | 'unavailable'

type PendingServiceAction =
  | 'install'
  | 'uninstall'
  | 'reinstall'
  | 'forceReinstall'

/**
 * How the core is running and what backs it, as one consistent snapshot.
 *
 * The derived answers travel with it — `tunCapable`, `serviceUsable`,
 * `serviceNeedsAttention` — so nothing here is recomputed from the raw fields.
 */
export interface RunState {
  mode: RunningMode
  service: ServiceHealth
  serviceUnavailableReason: string | null
  pendingAction: PendingServiceAction | null
  sidecarAllowed: boolean
  isAdmin: boolean
  opInFlight: boolean
  serviceUsable: boolean
  tunCapable: boolean
  serviceNeedsAttention: boolean
}

export const getRuntimeState = async () => {
  return invoke<RunState>('get_runtime_state')
}
