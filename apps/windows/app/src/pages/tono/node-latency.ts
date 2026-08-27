import delayManager from '@/services/delay'
import { TONO_COLORS } from '@/tono-ui/theme'

export type LatencyKind = 'tcp' | 'exit' | 'cached'

/** TCP connect to :443 — no TLS. */
export const TCP_SLOW_MS = 400
/** HTTPS generate_204 through Reality. A healthy Japan exit's warm sample
 * is commonly 400–900ms; green has to cover that or Tokyo looks warned. */
export const EXIT_SLOW_MS = 1500
const TCP_GOOD_MS = 200
const EXIT_GOOD_MS = 1000

/** Delay capsule colors. Exit measurements use wider bands than TCP. */
export const latencyColor = (delay: number, kind: LatencyKind = 'exit') => {
  const good = kind === 'tcp' ? TCP_GOOD_MS : EXIT_GOOD_MS
  const slow = kind === 'tcp' ? TCP_SLOW_MS : EXIT_SLOW_MS
  return delay < good
    ? TONO_COLORS.latencyGood
    : delay < slow
      ? TONO_COLORS.protectedOffline
      : TONO_COLORS.error
}

export const latencyLabelKey = (
  kind: LatencyKind,
  delay: number,
):
  | 'tono.nodes.tcpLatency'
  | 'tono.nodes.tcpLatencySlow'
  | 'tono.nodes.exitLatency'
  | 'tono.nodes.exitLatencySlow'
  | 'tono.nodes.cachedLatency' => {
  if (kind === 'tcp') {
    return delay >= TCP_SLOW_MS ? 'tono.nodes.tcpLatencySlow' : 'tono.nodes.tcpLatency'
  }
  if (kind === 'exit') {
    return delay >= EXIT_SLOW_MS ? 'tono.nodes.exitLatencySlow' : 'tono.nodes.exitLatency'
  }
  return 'tono.nodes.cachedLatency'
}

/** Spoken page-open time: 816 → "0.8". Keep one decimal so the badge is not "打开 816ms". */
export const formatLatencySeconds = (ms: number) => (ms / 1000).toFixed(1)

export const latencyLabelVars = (ms: number) => ({
  latency: ms,
  seconds: formatLatencySeconds(ms),
})

/** Best-effort latency for a node: the delay manager's GLOBAL-group history. */
export const readNodeLatency = (name: string): number | null => {
  try {
    const update = delayManager.getDelayUpdate(name, 'GLOBAL')
    const delay = update?.delay ?? -1
    return delay > 0 && delay < 1e6 ? delay : null
  } catch {
    return null
  }
}
