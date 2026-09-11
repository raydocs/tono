import { useLockFn } from 'ahooks'

import {
  tonoConnectProgressQueryKey,
  tonoServersQueryKey,
} from '@/hooks/use-tono'
import { useQuery } from '@/services/query-client'
import {
  connectErrorSuggestsBackupChannel,
  tonoConnectProgress,
  tonoRetryNow,
  tonoSelectServer,
  tonoServers,
  type TonoUiState,
} from '@/services/tono'

import { backupChannelName } from './node-meta'

/**
 * Manual-only next hand after a TCP/handshake failure: the same-city hy2
 * sibling, if the catalog has one. Does not auto-switch (G2.8 stays off).
 */
export function useManualBackupChannel(
  selectedServer: string | null | undefined,
  uiState: TonoUiState | undefined,
) {
  const offline = uiState === 'protectedOffline'
  const { data: servers } = useQuery({
    queryKey: tonoServersQueryKey,
    queryFn: tonoServers,
    enabled: offline,
  })
  const { data: progress } = useQuery({
    queryKey: tonoConnectProgressQueryKey,
    queryFn: tonoConnectProgress,
    enabled: offline,
  })
  const hy2Sibling = backupChannelName(
    selectedServer,
    (servers ?? []).map((server) => server.name),
  )
  const available =
    offline &&
    hy2Sibling != null &&
    connectErrorSuggestsBackupChannel(progress?.error)

  const selectAndRetry = useLockFn(async () => {
    if (!hy2Sibling) return
    await tonoSelectServer(hy2Sibling)
    await tonoRetryNow()
  })

  return { available, hy2Sibling, selectAndRetry }
}
