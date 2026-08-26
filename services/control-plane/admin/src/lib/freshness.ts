import { msEpochToSec } from './time';

export const HEARTBEAT_FRESH_SECONDS = 40 * 60;

/** True when this sample is within the 40-minute freshness window. */
export function measurementFresh(
  atMs: number | null | undefined,
  heartbeatSec: number,
  nowSec: number,
): boolean {
  if (atMs != null && Number.isFinite(atMs)) {
    const atSec = msEpochToSec(atMs);
    if (atSec == null) return false;
    return nowSec - atSec <= HEARTBEAT_FRESH_SECONDS;
  }
  // Older heartbeats only carried lastSeenAt. A missing measurement timestamp
  // therefore inherits heartbeat freshness instead of counting as current forever
  // or being dropped as unusable.
  return nowSec - heartbeatSec <= HEARTBEAT_FRESH_SECONDS;
}
