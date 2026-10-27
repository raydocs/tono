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

import { CONNECT_TIMEOUT_MS, useConnectionData } from './use-connection-data'

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

  it('keeps publishing frames at the throttle rate after the wall clock moves back', async () => {
    vi.useFakeTimers()
    const live = socket()
    connectMock.mockResolvedValueOnce(live)

    const { result, unmount } = renderHook(() =>
      useConnectionData({ enabled: true, generation: 2 }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    const listener = vi.mocked(live.addListener).mock.calls[0][0]
    const frame = (uploadTotal: number) => ({
      type: 'Text' as const,
      data: JSON.stringify({ uploadTotal, downloadTotal: 0, connections: [] }),
    })

    await act(async () => {
      listener(frame(1))
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(result.current.response.data.uploadTotal).toBe(1)

    // A clock correction two hours back must not turn the 500 ms throttle into a two-hour wait.
    vi.setSystemTime(Date.now() - 2 * 60 * 60 * 1000)
    await act(async () => {
      listener(frame(2))
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(result.current.response.data.uploadTotal).toBe(2)
    unmount()
  })
})

it('retires live Activity evidence and queued frames after a transport failure', async () => {
  vi.useFakeTimers()
  const live = socket()
  connectMock.mockResolvedValueOnce(live)
  const { result } = renderHook(() =>
    useConnectionData({ enabled: true, generation: 3 }),
  )
  await act(async () => {
    await Promise.resolve()
  })
  expect(live.addListener).toHaveBeenCalledOnce()
  const listener = vi.mocked(live.addListener).mock.calls[0]![0]
  const frame = (uploadTotal: number) => ({
    type: 'Text' as const,
    data: JSON.stringify({ uploadTotal, downloadTotal: 0, connections: [] }),
  })
  await act(async () => {
    listener(frame(1))
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(result.current.response.live).toBe(true)
  await act(async () => {
    listener(frame(2))
    listener(frame(3))
    listener({
      type: 'Text',
      data: 'Websocket error: connection reset without closing handshake',
    })
  })
  expect(result.current.response.live).toBe(false)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(result.current.response.live).toBe(false)
})

it('moves Activity to a fresh socket when a reconnect mints a new controller', async () => {
  // The socket captured the old controller's loopback port and secret. Keeping it after a
  // reconnect left Activity retrying against a dead controller while the app read Connected.
  vi.useFakeTimers()
  const before = socket()
  const after = socket()
  connectMock.mockResolvedValueOnce(before).mockResolvedValueOnce(after)
  const frame = (uploadTotal: number) => ({
    type: 'Text' as const,
    data: JSON.stringify({ uploadTotal, downloadTotal: 0, connections: [] }),
  })
  const { result, rerender } = renderHook(
    ({ generation }) => useConnectionData({ enabled: true, generation }),
    { initialProps: { generation: 10 } },
  )
  await act(async () => {
    await Promise.resolve()
  })
  const oldListener = vi.mocked(before.addListener).mock.calls[0]![0]
  await act(async () => {
    oldListener(frame(1))
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(result.current.response.live).toBe(true)

  rerender({ generation: 11 })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(result.current.response.live).toBe(false)
  expect(before.close).toHaveBeenCalledOnce()
  expect(connectMock).toHaveBeenCalledTimes(2)

  await act(async () => {
    oldListener(frame(2))
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(result.current.response.live).toBe(false)

  const newListener = vi.mocked(after.addListener).mock.calls[0]![0]
  await act(async () => {
    newListener(frame(3))
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(result.current.response.live).toBe(true)
  expect(result.current.response.data.uploadTotal).toBe(3)
})
