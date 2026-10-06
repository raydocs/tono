import { useEffect, useState } from 'react'

import type { TonoConnectProgress, TonoStatus } from '@/services/tono'
import { hasLiveProtection } from '@/tono-ui/protection-evidence'
import { whileVisible } from '@/tono-ui/while-visible'

export const HOME_CONNECT_TIMES = {
  slow: 8_000,
  switchLine: 20_000,
  tick: 1_000,
  minute: 60_000,
} as const
// Presentation receipts only, not a second connection state machine. A fresh controller
// generation cannot inherit an old duration; restarting the GUI starts with "just connected".
let protectedReceipt: { owner: string; since: number } | null = null

export const useHomeTiming = (
  status: TonoStatus | undefined,
  progress: TonoConnectProgress | undefined,
) => {
  const statusKnown = status != null
  const state = status?.uiState ?? 'notConnected'
  const protectedNow = state === 'connected' && hasLiveProtection(status)
  const owner = `${status?.routePreferenceScope ?? ''}:${status?.controllerGeneration ?? ''}`
  const attempt = `${owner}:${progress?.retryAttempt ?? 0}`
  const [elapsed, setElapsed] = useState({ attempt: '', ms: 0 })
  const [duration, setDuration] = useState({ owner: '', minutes: 0 })
  const recordedElapsed = Math.max(0, progress?.totalElapsedMs ?? 0)
  useEffect(() => {
    if (state !== 'connecting') return
    const start = Date.now() - recordedElapsed
    const tick = () =>
      setElapsed({ attempt, ms: Math.max(0, Date.now() - start) })
    return whileVisible(tick, HOME_CONNECT_TIMES.tick)
  }, [state, attempt, recordedElapsed])
  useEffect(() => {
    if (!protectedNow) {
      if (!statusKnown) return
      protectedReceipt = null
      return
    }
    if (protectedReceipt?.owner !== owner)
      protectedReceipt = { owner, since: Date.now() }
    const since = protectedReceipt.since
    const tick = () =>
      setDuration({
        owner,
        minutes: Math.max(
          0,
          Math.floor((Date.now() - since) / HOME_CONNECT_TIMES.minute),
        ),
      })
    return whileVisible(tick, HOME_CONNECT_TIMES.minute)
  }, [protectedNow, owner, statusKnown])
  return {
    elapsed:
      state === 'connecting'
        ? Math.max(
            recordedElapsed,
            elapsed.attempt === attempt ? elapsed.ms : 0,
          )
        : 0,
    minutes: protectedNow && duration.owner === owner ? duration.minutes : 0,
  }
}

/** Same deadline semantics for the home sentence and the retained progress record. */
export const useRetryCountdown = (deadline: number | null | undefined) => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (deadline == null) return
    return whileVisible(() => setNow(Date.now()), 1000)
  }, [deadline])
  return deadline == null
    ? null
    : Math.max(0, Math.ceil((deadline - now) / 1000))
}
