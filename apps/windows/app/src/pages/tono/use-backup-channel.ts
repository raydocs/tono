import { useLockFn } from 'ahooks'

import {
  tonoConnectProgressQueryKey,
  tonoServersQueryKey,
} from '@/hooks/use-tono'
import { useQuery } from '@/services/query-client'
import {
  connectErrorSuggestsBackupChannel,
  tonoConnect,
  tonoConnectProgress,
  tonoRetryNow,
  tonoSelectServer,
  tonoServers,
  type TonoUiState,
} from '@/services/tono'

import { backupChannelName } from './node-meta'

/**
 * Manual-only next hand when TCP is dead: same-city hy2 if the catalog has
 * it, otherwise another city's hy2. Does not auto-switch (G2.8 stays off).
 *
 * Shown in Protected Offline (including a restart that dropped the error),
 * and after a first-connect handshake eof that fully released protection —
 * that path never reaches Protected Offline, so gating only on that state
 * hid the next hand from a China tester who had never connected.
 */
export function useManualBackupChannel(
  selectedServer: string | null | undefined,
  uiState: TonoUiState | undefined,
) {
  const offline = uiState === 'protectedOffline'
  const releasedFailure = uiState === 'notConnected'
  const watching = offline || releasedFailure
  const { data: servers } = useQuery({
    queryKey: tonoServersQueryKey,
    queryFn: tonoServers,
    enabled: watching,
  })
  const { data: progress, isPending: progressPending } = useQuery({
    queryKey: tonoConnectProgressQueryKey,
    queryFn: tonoConnectProgress,
    enabled: watching,
  })
  const hy2Sibling = backupChannelName(
    selectedServer,
    (servers ?? []).map((server) => server.name),
  )
  // Handshake eof is the usual case. After a protected-offline restart the
  // progress record may have no error left; still offer the sibling rather
  // than only Retry TCP. Idle Not Connected must not show the button.
  // DNS / service failures keep their own next hand.
  const errorAllowsBackup = offline
    ? progress?.error == null
      ? !progressPending
      : connectErrorSuggestsBackupChannel(progress.error)
    : connectErrorSuggestsBackupChannel(progress?.error)
  const available = watching && hy2Sibling != null && errorAllowsBackup

  const selectAndRetry = useLockFn(async () => {
    if (!hy2Sibling) return
    await tonoSelectServer(hy2Sibling)
    if (offline) await tonoRetryNow()
    else await tonoConnect()
  })

  return { available, hy2Sibling, selectAndRetry }
}
