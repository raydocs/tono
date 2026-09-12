import { useEffect } from 'react'

import { runStateQueryKey } from '@/hooks/use-system-state'
import type { RunState } from '@/services/cmds'
import { subscribeTonoEvents } from '@/services/events'
import { revalidateQueries, setCacheDataAsync } from '@/services/query-client'

export const useLayoutEvents = (
  handleNotice: (payload: [string, string]) => void,
) => {
  useEffect(() => {
    const revalidateKeys = (keys: readonly string[]) => {
      void revalidateQueries(keys.map((key) => [key]))
    }
    const refreshCore = () => {
      revalidateKeys([
        'getProxyView',
        'getVersion',
        'getCoreConfig',
        'getRuntimeInfo',
        'getCoreMode',
        'getRuntimeConfig',
        'getRules',
        'getRuleProviders',
      ])
    }
    const refreshPreferences = () => {
      revalidateKeys([
        'getTonoPreferences',
        'getSystemProxy',
        'getAutotemProxy',
      ])
    }
    const applyRunState = (payload: RunState) => {
      void setCacheDataAsync<RunState>(runStateQueryKey, payload)
    }

    return subscribeTonoEvents(
      {
        'tono://refresh-core-config': refreshCore,
        'tono://refresh-preferences': refreshPreferences,
        // The Run State is pushed, not polled: every transition carries the new snapshot, so it
        // is written straight into the cache instead of triggering a fetch.
        'tono://run-state-changed': applyRunState,
        'tono://notice-message': handleNotice,
      },
      // The Run State is the one thing here that arrives *only* by event, so it is the one
      // thing a missed event leaves stale — until the next transition, which during startup can
      // be a long time. Re-read once the listener is live, so the gap between the first read
      // and the subscription cannot outlive the subscription.
      () => revalidateKeys(['getRuntimeState']),
    )
  }, [handleNotice])
}
