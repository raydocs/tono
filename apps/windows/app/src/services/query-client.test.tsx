// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, expect, it } from 'vitest'

import { useQuery } from './query-client'

afterEach(cleanup)

// #589: SWR's bound mutate swallows a failed fetch and resolves with the cached data, so a
// manual "Check for updates" read a failed check as "no update" (or as the stale result).
it('reports a failed refetch instead of resolving with the cached data', async () => {
  const failure = new Error('update endpoint unreachable')
  let calls = 0
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  )
  const { result } = renderHook(
    () =>
      useQuery({
        queryKey: ['query-client-test', 'refetch-failure'],
        queryFn: async () => {
          calls += 1
          if (calls === 1) return 'first check'
          throw failure
        },
        retry: false,
      }),
    { wrapper },
  )
  await waitFor(() => expect(result.current.data).toBe('first check'))

  let outcome: { data: string | undefined; error?: unknown } | undefined
  await act(async () => {
    outcome = await result.current.refetch()
  })

  expect(outcome?.error).toBe(failure)
})
