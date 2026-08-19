import { useCallback } from 'react'

import { getTonoPreferences, patchTonoPreferences } from '@/services/cmds'
import { getPreloadConfig, setPreloadConfig } from '@/services/preload'
import { getCacheData, setCacheData, useQuery } from '@/services/query-client'

export const tonoPreferencesQueryKey = ['getTonoPreferences'] as const

export const useTonoPreferences = () => {
  const initial = getPreloadConfig()

  const { data: preferences, refetch } = useQuery({
    queryKey: [...tonoPreferencesQueryKey],
    queryFn: async () => {
      const config = await getTonoPreferences()
      setPreloadConfig(config)
      return config
    },
    initialData: initial ?? undefined,
    revalidateOnMount: initial ? false : undefined,
    staleTime: 5000,
  })

  const mutatePreferences = (
    updaterOrData?:
      | TonoPreferences
      | ((prev: TonoPreferences | undefined) => TonoPreferences | undefined)
      | undefined,
  ) => {
    if (updaterOrData === undefined) {
      void refetch()
      return
    }
    if (typeof updaterOrData === 'function') {
      const prev = getCacheData<TonoPreferences>(tonoPreferencesQueryKey)
      setCacheData(tonoPreferencesQueryKey, updaterOrData(prev))
    } else {
      setCacheData(tonoPreferencesQueryKey, updaterOrData)
    }
  }

  const patchPreferences = useCallback(
    async (value: Partial<TonoPreferences>) => {
      await patchTonoPreferences(value)
      await refetch()
    },
    [refetch],
  )

  return {
    preferences,
    mutatePreferences,
    patchPreferences,
  }
}
