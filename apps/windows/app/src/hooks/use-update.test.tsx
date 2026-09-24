// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UpdateOffer } from '@/services/update'

const { checkUpdateSafeMock } = vi.hoisted(() => ({
  checkUpdateSafeMock: vi.fn<() => Promise<UpdateOffer | null>>(),
}))

vi.mock('@/services/update', () => ({
  checkUpdateSafe: checkUpdateSafeMock,
}))

vi.mock('./use-tono-preferences', () => ({
  useTonoPreferences: () => ({ preferences: { auto_check_update: true } }),
}))

import { useUpdate } from './use-update'

const freshSWR = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  checkUpdateSafeMock.mockReset()
  localStorage.clear()
})

describe('useUpdate discovery schedule', () => {
  it('keeps checking after the first check and both retries fail', async () => {
    vi.useFakeTimers()
    const offer: UpdateOffer = { version: '0.0.74', manifestSha256: 'ab'.repeat(32) }
    checkUpdateSafeMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(offer)

    const { result } = renderHook(() => useUpdate(true), { wrapper: freshSWR })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 60 * 1000)
    })

    expect(checkUpdateSafeMock.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(result.current.updateInfo).toEqual(offer)
  })
})
