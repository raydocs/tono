import { beforeEach, describe, expect, it, vi } from 'vitest'

import { subscribeTonoEvents } from './events'

const listen = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/event', () => ({ listen }))

/** A `listen` whose registrations only resolve when the test says so. */
const deferredListen = () => {
  const resolvers: Array<() => void> = []
  listen.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(() => resolve(() => {}))
      }),
  )
  return {
    registrations: resolvers,
    settleAll: () => resolvers.forEach((resolve) => resolve()),
  }
}

/** Let every already-resolved promise in the chain run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  listen.mockReset()
})

describe('subscribeTonoEvents', () => {
  it('ignores events for a disposed subscription while registration is pending', async () => {
    const { settleAll } = deferredListen()
    const oldNotice = vi.fn()
    const currentNotice = vi.fn()
    const teardown = subscribeTonoEvents({
      'tono://notice-message': oldNotice,
    })
    const oldCallback = listen.mock.calls[0][1]
    const liveEvent = { payload: ['info', 'before teardown'] }
    oldCallback(liveEvent)
    expect(oldNotice).toHaveBeenCalledExactlyOnceWith(liveEvent.payload)
    oldNotice.mockClear()

    teardown()
    const teardownCurrent = subscribeTonoEvents({
      'tono://notice-message': currentNotice,
    })
    const currentCallback = listen.mock.calls[1][1]
    const lateEvent = { payload: ['error', 'connection failed'] }
    oldCallback(lateEvent)
    currentCallback(lateEvent)

    settleAll()
    await flush()
    teardownCurrent()

    expect(oldNotice).not.toHaveBeenCalled()
    expect(currentNotice).toHaveBeenCalledExactlyOnceWith(lateEvent.payload)
  })

  it('reports subscribed only once every listener is live', async () => {
    const { registrations, settleAll } = deferredListen()
    const onSubscribed = vi.fn()

    subscribeTonoEvents(
      {
        'verge://run-state-changed': () => {},
        'verge://notice-message': () => {},
      },
      onSubscribed,
    )

    expect(registrations).toHaveLength(2)
    registrations[0]?.()
    await flush()
    expect(onSubscribed).not.toHaveBeenCalled()

    settleAll()
    await flush()
    expect(onSubscribed).toHaveBeenCalledTimes(1)
  })

  it('does not report subscribed after teardown', async () => {
    // Registration outliving the caller is the whole reason this is tracked here; resyncing
    // for a subscription that no longer exists would fetch into a cache nobody reads.
    const { settleAll } = deferredListen()
    const onSubscribed = vi.fn()

    const teardown = subscribeTonoEvents(
      { 'verge://run-state-changed': () => {} },
      onSubscribed,
    )
    teardown()

    settleAll()
    await flush()
    expect(onSubscribed).not.toHaveBeenCalled()
  })

  it('still reports subscribed when a listener fails to register', async () => {
    // A resync is most needed when a subscription is missing, not least.
    listen.mockRejectedValue(new Error('no such event'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onSubscribed = vi.fn()

    subscribeTonoEvents({ 'verge://run-state-changed': () => {} }, onSubscribed)

    await vi.waitFor(() => expect(onSubscribed).toHaveBeenCalledTimes(1))
  })

  it('delivers event payloads to the matching handler', async () => {
    const handlers = new Map<string, (payload: unknown) => void>()
    listen.mockImplementation(
      (name: string, handler: (event: unknown) => void) => {
        handlers.set(name, (payload) => handler({ payload }))
        return Promise.resolve(() => {})
      },
    )
    const onRunState = vi.fn()
    const onNotice = vi.fn()

    subscribeTonoEvents({
      'verge://run-state-changed': onRunState,
      'verge://notice-message': onNotice,
    })

    handlers.get('verge://run-state-changed')?.({ mode: 'Sidecar' })

    expect(onRunState).toHaveBeenCalledWith({ mode: 'Sidecar' })
    expect(onNotice).not.toHaveBeenCalled()
  })
})
