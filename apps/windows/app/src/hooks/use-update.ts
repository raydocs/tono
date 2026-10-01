import { useEffect } from 'react'

import { setCacheData, useQuery } from '@/services/query-client'
import { checkUpdateSafe } from '@/services/update'

import { useTonoPreferences } from './use-tono-preferences'

const LAST_CHECK_KEY = 'last_check_update'

// SWR skips every polling tick while its cache holds an error, and its own retries stop
// after `retry`. A failed check is rechecked on this separate timer so that one bad moment
// (say, login before the network is up) cannot end discovery for the life of the App.
const UPDATE_RECHECK_AFTER_ERROR_MS = 60 * 60 * 1000

export const readLastCheckTime = (): number | null => {
  const stored = localStorage.getItem(LAST_CHECK_KEY)
  if (!stored) return null
  const ts = parseInt(stored, 10)
  return isNaN(ts) ? null : ts
}

export const updateLastCheckTime = (timestamp?: number): number => {
  const now = timestamp ?? Date.now()
  localStorage.setItem(LAST_CHECK_KEY, now.toString())
  setCacheData([LAST_CHECK_KEY], now)
  return now
}

// --- useUpdate hook ---

export const useUpdate = (enabled: boolean = true) => {
  const { preferences } = useTonoPreferences()
  const { auto_check_update } = preferences || {}

  // Determine if we should check for updates
  // If enabled is explicitly false, don't check
  // Otherwise, respect the auto_check_update setting (or default to true if null/undefined for manual triggers)
  const autoCheck = auto_check_update !== false
  const shouldCheck = enabled && autoCheck

  const {
    data: updateInfo,
    error: checkError,
    mutate: revalidateCheck,
    refetch: checkUpdate,
    isFetching: isValidating,
  } = useQuery({
    queryKey: ['checkUpdate'],
    queryFn: async () => {
      const result = await checkUpdateSafe()
      updateLastCheckTime()
      return result
    },
    // #589: the key stays live with automatic checks off, so a manual check (refetch) really
    // asks and the update dialog, which reads this same query, sees its answer. Only the
    // automatic triggers follow the preference.
    enabled,
    revalidateOnMount: autoCheck,
    retry: 2,
    staleTime: 60 * 60 * 1000,
    refetchInterval: autoCheck ? 24 * 60 * 60 * 1000 : 0,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: autoCheck,
  })

  // Keyed on whether an error is cached, not on which one: the native command rejects with a
  // String, so the next failed cycle caches an identical value that would not re-run this effect.
  // The interval keeps rechecking until a check succeeds, which lets SWR's daily poll resume.
  const hasCheckError = checkError !== undefined
  useEffect(() => {
    if (!shouldCheck || !hasCheckError) return undefined
    const timer = window.setInterval(() => {
      void revalidateCheck()
    }, UPDATE_RECHECK_AFTER_ERROR_MS)
    return () => window.clearInterval(timer)
  }, [shouldCheck, hasCheckError, revalidateCheck])

  // Shared last check timestamp
  const { data: lastCheckUpdate } = useQuery({
    queryKey: [LAST_CHECK_KEY],
    queryFn: readLastCheckTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    updateInfo,
    checkUpdate,
    loading: isValidating,
    lastCheckUpdate: lastCheckUpdate ?? null,
  }
}
