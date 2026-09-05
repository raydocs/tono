import { invoke } from '@tauri-apps/api/core'

export async function getTonoPreferences() {
  return invoke<TonoPreferences>('get_tono_preferences')
}

export async function patchTonoPreferences(payload: TonoPreferences) {
  return invoke<void>('patch_tono_preferences', { payload })
}

/** @deprecated use getTonoPreferences */
export async function getVergeConfig() {
  return getTonoPreferences()
}

/** @deprecated use patchTonoPreferences */
export async function patchVergeConfig(payload: TonoPreferences) {
  return patchTonoPreferences(payload)
}

export async function openWindowsDnsSettings() {
  return invoke<void>('open_windows_dns_settings')
}

export async function restartApp() {
  return invoke<void>('restart_app')
}

export async function prepareUpdate(nextVersion: string) {
  return invoke<void>('tono_prepare_update', { nextVersion })
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
