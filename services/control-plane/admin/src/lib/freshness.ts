import { msEpochToSec } from './time';

export const HEARTBEAT_FRESH_SECONDS = 40 * 60;
const MEASUREMENT_FUTURE_SKEW_SECONDS = 5 * 60;

/** True when this sample is within the 40-minute freshness window. */
export function measurementFresh(
  atMs: number | null | undefined,
  heartbeatSec: number,
  nowSec: number,
): boolean {
  if (atMs != null && Number.isFinite(atMs)) {
    const atSec = msEpochToSec(atMs);
    if (atSec == null) return false;
    const age = nowSec - atSec;
    // The Worker caps client samples at receipt time. Keep this guard as
    // defense-in-depth for fixtures and old payloads that bypassed that cap.
    return age >= -MEASUREMENT_FUTURE_SKEW_SECONDS && age <= HEARTBEAT_FRESH_SECONDS;
  }
  // Older heartbeats only carried lastSeenAt. A missing measurement timestamp
  // therefore inherits heartbeat freshness instead of counting as current forever
  // or being dropped as unusable.
  return nowSec - heartbeatSec <= HEARTBEAT_FRESH_SECONDS;
}
