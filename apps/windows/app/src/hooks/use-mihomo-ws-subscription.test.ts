import type { MihomoWebSocket } from 'tono-plugin-core-api'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CONNECT_TIMEOUT_MS,
  createSharedSubscriptionEntry,
} from './use-mihomo-ws-subscription'

const socket = (close = vi.fn(async () => {})) =>
  ({
    addListener: vi.fn(),
    close,
  }) as unknown as MihomoWebSocket

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('shared Mihomo WebSocket recovery', () => {
  it('ignores stale frames while a reconnect close handshake is pending', async () => {
    vi.useFakeTimers()
    let finishClose!: () => void
    const first = socket(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishClose = resolve
          }),
      ),
    )
    const second = socket()
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const entry = createSharedSubscriptionEntry(connect)
    const handleMessage = vi.fn((data: string) => {
      if (data.startsWith('Websocket error')) void entry.scheduleReconnect()
    })
    entry.owners.add({ handleMessage, isMounted: () => true })
    await entry.connectWs()
    const listener = vi.mocked(first.addListener).mock.calls[0][0]
    const reconnect = entry.scheduleReconnect()

    listener({ type: 'Text', data: 'Websocket error: connection closed' })
    listener({ type: 'Text', data: '{"up":123,"down":456}' })
    await Promise.resolve()
    const staleCalls = handleMessage.mock.calls.length
    const prematureTimers = vi.getTimerCount()

    finishClose()
    await reconnect
    await vi.runOnlyPendingTimersAsync()

    expect(staleCalls).toBe(0)
    expect(prematureTimers).toBe(0)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(entry.ws).toBe(second)
    vi.mocked(second.addListener).mock.calls[0][0]({
      type: 'Text',
      data: 'fresh',
    })
    expect(handleMessage).toHaveBeenCalledExactlyOnceWith('fresh')
  })

  it('closes, clears and reconnects when onConnected throws', async () => {
    vi.useFakeTimers()
    const first = socket()
    const second = socket()
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const onConnected = vi
      .fn()
      .mockRejectedValueOnce(new Error('snapshot failed'))
      .mockResolvedValueOnce(undefined)
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({
      handleMessage: vi.fn(),
      onConnected,
      isMounted: () => true,
    })

    await entry.connectWs()

    expect(first.addListener).toHaveBeenCalledOnce()
    expect(first.close).toHaveBeenCalledOnce()
    expect(entry.ws).toBeNull()
    expect(entry.reconnectTimer).not.toBeNull()

    await vi.runOnlyPendingTimersAsync()

    expect(connect).toHaveBeenCalledTimes(2)
    expect(second.addListener).toHaveBeenCalledOnce()
    expect(entry.ws).toBe(second)
  })

  it('still reconnects when onConnected fails after the connect watchdog deadline', async () => {
    vi.useFakeTimers()
    const first = socket()
    const second = socket()
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    let rejectConnected!: (error: Error) => void
    const onConnected = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectConnected = reject
          }),
      )
      .mockResolvedValueOnce(undefined)
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({
      handleMessage: vi.fn(),
      onConnected,
      isMounted: () => true,
    })

    const pending = entry.connectWs()
    await vi.advanceTimersByTimeAsync(0)
    expect(entry.ws).toBe(first)
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS)
    rejectConnected(new Error('snapshot failed'))
    await pending

    expect(first.close).toHaveBeenCalledOnce()
    expect(entry.ws).toBeNull()
    expect(entry.reconnectTimer).not.toBeNull()

    await vi.runOnlyPendingTimersAsync()

    expect(connect).toHaveBeenCalledTimes(2)
    expect(entry.ws).toBe(second)
  })

  it('still reconnects when the stale socket close handshake fails', async () => {
    vi.useFakeTimers()
    const first = socket(
      vi.fn(async () => Promise.reject(new Error('close failed'))),
    )
    const second = socket()
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({
      handleMessage: vi.fn(),
      isMounted: () => true,
    })
    await entry.connectWs()

    await expect(entry.scheduleReconnect()).resolves.toBeUndefined()
    await vi.runOnlyPendingTimersAsync()

    expect(connect).toHaveBeenCalledTimes(2)
    expect(entry.ws).toBe(second)
  })

  it('abandons a hung connect after CONNECT_TIMEOUT_MS and reconnects', async () => {
    vi.useFakeTimers()
    const first = socket()
    const second = socket()
    let resolveFirst!: (ws: MihomoWebSocket) => void
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(second)
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({
      handleMessage: vi.fn(),
      isMounted: () => true,
    })

    const hung = entry.connectWs()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(entry.ws).toBeNull()

    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS - 1)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(entry.connecting).toBe(true)

    // The watchdog starts the replacement immediately at its deadline.
    await vi.advanceTimersByTimeAsync(1)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(entry.connecting).toBe(false)
    expect(entry.ws).toBe(second)

    resolveFirst(first)
    await hung
    expect(first.close).toHaveBeenCalledOnce()
    expect(entry.ws).toBe(second)
    expect(second.close).not.toHaveBeenCalled()
  })

  it('keeps retrying a refused controller with growing delays and resets once it answers', async () => {
    // Core restarting across a network switch: the controller refuses for a while, then answers.
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // zero jitter
    const first = socket()
    const second = socket()
    const refused = () => Promise.reject(new Error('connection refused'))
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockImplementationOnce(refused)
      .mockImplementationOnce(refused)
      .mockImplementationOnce(refused)
      .mockImplementationOnce(refused)
      .mockImplementationOnce(refused)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({ handleMessage: vi.fn(), isMounted: () => true })

    const expectNextAttemptAfter = async (delayMs: number) => {
      const calls = connect.mock.calls.length
      await vi.advanceTimersByTimeAsync(delayMs - 1)
      expect(connect).toHaveBeenCalledTimes(calls)
      await vi.advanceTimersByTimeAsync(1)
      expect(connect).toHaveBeenCalledTimes(calls + 1)
    }

    await entry.connectWs()
    expect(entry.ws).toBeNull()
    for (const delayMs of [1000, 2000, 5000, 10000, 10000]) {
      await expectNextAttemptAfter(delayMs)
    }
    expect(entry.ws).toBe(first)
    expect(entry.reconnectTimer).toBeNull()

    // The next drop starts from the shortest delay, not the outage's 10s ceiling.
    await entry.scheduleReconnect()
    await expectNextAttemptAfter(1000)
    expect(entry.ws).toBe(second)
  })
})
