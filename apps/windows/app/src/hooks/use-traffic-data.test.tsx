// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => ({ message: (_data: string) => {} }))
vi.mock('./use-traffic-monitor', () => ({
  useTrafficMonitorEnhanced: () => ({ graphData: { appendData: vi.fn() } }),
}))
vi.mock('./use-mihomo-ws-subscription', () => ({
  useMihomoWsSubscription: ({
    setupHandlers,
  }: {
    setupHandlers: (args: {
      next: () => void
      scheduleReconnect: () => Promise<void>
    }) => {
      handleMessage: (data: string) => void
    }
  }) => {
    handlers.message = setupHandlers({
      next: vi.fn(),
      scheduleReconnect: vi.fn(async () => {}),
    }).handleMessage
    return { response: {}, refresh: vi.fn() }
  },
}))

import { useTrafficData } from './use-traffic-data'

afterEach(cleanup)

it('resets live on controller or enabled changes and waits for a new frame', () => {
  const { result, rerender } = renderHook(useTrafficData, {
    initialProps: { enabled: true, generation: 1 },
  })
  const receive = () =>
    act(() => handlers.message('{"up":1,"down":2,"upTotal":3,"downTotal":4}'))
  expect(result.current.live).toBe(false)
  receive()
  expect(result.current.live).toBe(true)
  rerender({ enabled: true, generation: 2 })
  expect(result.current.live).toBe(false)
  receive()
  expect(result.current.live).toBe(true)
  rerender({ enabled: false, generation: 2 })
  expect(result.current.live).toBe(false)
  rerender({ enabled: true, generation: 2 })
  expect(result.current.live).toBe(false)
  receive()
  expect(result.current.live).toBe(true)
})
