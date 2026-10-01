import {
  idleSelectShouldConnect,
  isSupersededConnectRejection,
  tonoConnect,
  tonoStatus,
} from './tono'

/**
 * A selection acknowledgement does not reserve Connect admission. Another window
 * can win even after a fresh idle read. Ignore only that Connect refusal, then
 * let the caller refresh/close its picker; selection and real failures propagate.
 * This does not claim the selected node has connected or retry a rejected start.
 */
export async function connectIfIdleAfterSelection(): Promise<void> {
  if (!idleSelectShouldConnect((await tonoStatus()).uiState)) return
  try {
    await tonoConnect()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '')
    if (
      message !== 'already connected' &&
      !isSupersededConnectRejection(error)
    ) {
      throw error
    }
  }
}
