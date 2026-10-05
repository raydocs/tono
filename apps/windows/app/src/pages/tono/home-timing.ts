import { useEffect, useState } from 'react'

import type { TonoConnectProgress, TonoStatus } from '@/services/tono'
import { hasLiveProtection } from '@/tono-ui/protection-evidence'

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
    const initial = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, HOME_CONNECT_TIMES.tick)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
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
    const initial = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, HOME_CONNECT_TIMES.minute)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
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
