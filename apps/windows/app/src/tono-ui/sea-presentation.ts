import type { TonoStatus } from '@/services/tono'

import { hasLiveProtection } from './protection-evidence'
import type { SeaPhase } from './SeaScene'

/** Presentation only: live native evidence wins over a connected FSM label. */
export const seaPresentation = (status?: TonoStatus) => {
  const state = status?.uiState ?? 'notConnected'
  const unconfirmed =
    (state === 'connected' || state === 'protectedOffline') &&
    !hasLiveProtection(status)
  const phase: SeaPhase =
    state === 'connected' && !unconfirmed
      ? 'connected'
      : state === 'connecting'
        ? 'connecting'
        : state === 'protectedOffline' || unconfirmed
          ? 'failed'
          : 'idle'
  const titleKey = unconfirmed
    ? 'tono.pill.title.protectionUnknown'
    : state === 'notConnected'
      ? 'tono.home.title.idle'
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
