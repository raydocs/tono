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
})

describe('shared Mihomo WebSocket hung-connect recovery', () => {
  it('supersedes a never-settling connect() via the watchdog after CONNECT_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    const neverSettles = new Promise<MihomoWebSocket>(() => {})
    const laterSocket = socket()
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockImplementationOnce(() => neverSettles)
      .mockResolvedValueOnce(laterSocket)
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({ handleMessage: vi.fn(), isMounted: () => true })

    void entry.connectWs()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    // The hung attempt is in flight; exactly one watchdog timer is armed and
    // no socket has been installed yet.
    expect(entry.connecting).toBe(true)
    expect(entry.ws).toBeNull()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    // Advancing well past CONNECT_TIMEOUT_MS lets the watchdog supersede the
    // hung attempt and re-enter connectWs(), whose second connect() resolves.
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 1_000)

    expect(entry.connecting).toBe(false)
    expect(entry.ws).toBe(laterSocket)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not supersede a connect() that settles within CONNECT_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    let resolveConnect!: (ws: MihomoWebSocket) => void
    const first = socket()
    const connect = vi.fn<() => Promise<MihomoWebSocket>>().mockReturnValueOnce(
      new Promise<MihomoWebSocket>((resolve) => {
        resolveConnect = resolve
      }),
    )
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({ handleMessage: vi.fn(), isMounted: () => true })

    void entry.connectWs()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    // Attempt in flight; only the watchdog is pending.
    expect(entry.connecting).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    // Settle the connect long before the watchdog deadline.
    resolveConnect(first)
    await vi.advanceTimersByTimeAsync(0)

    expect(entry.ws).toBe(first)
    expect(entry.connecting).toBe(false)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    // Advancing past CONNECT_TIMEOUT_MS must NOT fire a spurious supersede —
    // the watchdog was cleared in `finally` when connect() settled.
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 5_000)

    expect(connect).toHaveBeenCalledTimes(1)
    expect(entry.ws).toBe(first)
    expect(entry.connecting).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still recovers when an external scheduleReconnect races the watchdog', async () => {
    vi.useFakeTimers()
    const neverSettles = new Promise<MihomoWebSocket>(() => {})
    const laterSocket = socket()
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockImplementationOnce(() => neverSettles)
      .mockResolvedValueOnce(laterSocket)
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({ handleMessage: vi.fn(), isMounted: () => true })

    void entry.connectWs()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1_000)

    // An external caller (e.g. a 'Websocket error' frame handler on a live
    // socket) requests a reconnect while the first attempt is hung but not yet
    // stale. This arms a reconnect timer that, combined with the watchdog,
    // must converge on a single fresh attempt — never a double connect.
    await entry.scheduleReconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(connect).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 10_000)

    expect(entry.ws).toBe(laterSocket)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(entry.connecting).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not fire the watchdog after the entry is torn down', async () => {
    vi.useFakeTimers()
    const neverSettles = new Promise<MihomoWebSocket>(() => {})
    const connect = vi
      .fn<() => Promise<MihomoWebSocket>>()
      .mockImplementationOnce(() => neverSettles)
    const entry = createSharedSubscriptionEntry(connect)
    entry.owners.add({ handleMessage: vi.fn(), isMounted: () => true })

    void entry.connectWs()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(1)

    // Tear down the entry the way the React effect cleanup does on unmount:
    // mark closed and clear the reconnect timer. The watchdog must remain
    // inert (its `!entry.closed` guard) rather than re-enter connectWs().
    entry.closed = true
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer)
      entry.reconnectTimer = null
    }

    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 5_000)

    expect(connect).toHaveBeenCalledTimes(1)
    expect(entry.ws).toBeNull()
    expect(entry.connecting).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
