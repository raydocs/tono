import type { TonoStatus } from '@/services/tono'

import { hasLiveProtection } from './protection-evidence'
import type { SeaPhase } from './SeaScene'

/**
 * Presentation only: live native evidence wins over a connected FSM label.
 * `releasedFailure` is a not-connected attempt that ended with an error.
 */
export const seaPresentation = (
  status?: TonoStatus,
  releasedFailure = false,
) => {
  const state = status?.uiState ?? 'notConnected'
  const unconfirmed =
    (state === 'connected' || state === 'protectedOffline') &&
    !hasLiveProtection(status)
  const phase: SeaPhase =
    state === 'connected' && !unconfirmed
      ? 'connected'
      : state === 'connecting'
        ? 'connecting'
        : state === 'protectedOffline' ||
            unconfirmed ||
            (state === 'notConnected' && releasedFailure)
          ? 'failed'
          : 'idle'
  const titleKey = unconfirmed
    ? 'tono.pill.title.protectionUnknown'
    : state === 'notConnected'
      ? releasedFailure
        ? 'tono.home.title.failed'
        : 'tono.home.title.idle'
      : state === 'connecting'
        ? 'tono.home.title.connecting'
        : state === 'disconnecting'
          ? 'tono.home.title.disconnecting'
          : state === 'protectedOffline'
            ? 'tono.pill.title.protectedOffline'
            : 'tono.pill.title.connected'
  return {
    phase,
    titleKey,
    tone:
      phase === 'connected' ? 'warm' : phase === 'failed' ? 'ember' : 'cool',
  }
}
