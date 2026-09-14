// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { MihomoWebSocket } from 'tono-plugin-core-api'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { connectMock } = vi.hoisted(() => ({
  connectMock: vi.fn<() => Promise<MihomoWebSocket>>(),
}))

vi.mock('tono-plugin-core-api', () => ({
  MihomoWebSocket: {
    connect_connections: () => connectMock(),
  },
}))

import {
  CONNECT_TIMEOUT_MS,
  useConnectionData,
} from './use-connection-data'

const socket = (close = vi.fn(async () => {})) =>
  ({
    addListener: vi.fn(),
    close,
  }) as unknown as MihomoWebSocket

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  connectMock.mockReset()
})

describe('Activity connections WebSocket recovery', () => {
  it('abandons a hung connect_connections after CONNECT_TIMEOUT_MS and reconnects', async () => {
    vi.useFakeTimers()
    const first = socket()
    const second = socket()
    let resolveFirst!: (ws: MihomoWebSocket) => void
    connectMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(second)

    const { result, unmount } = renderHook(() =>
      useConnectionData({ enabled: true, generation: 1 }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(connectMock).toHaveBeenCalledTimes(1)
    expect(result.current.response.live).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS)
    })
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(connectMock).toHaveBeenCalledTimes(2)
    expect(second.addListener).toHaveBeenCalledOnce()

    const listener = vi.mocked(second.addListener).mock.calls[0][0]
    await act(async () => {
      listener({
        type: 'Text',
        data: JSON.stringify({
          uploadTotal: 1,
          downloadTotal: 2,
          connections: [],
        }),
      })
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(result.current.response.live).toBe(true)

    resolveFirst(first)
    await act(async () => {
      await Promise.resolve()
    })
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.close).not.toHaveBeenCalled()
    unmount()
  })
})
