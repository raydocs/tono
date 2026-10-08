// Live throughput for the sea's water sparkle (decision 077). The dashboard's
// existing traffic subscription writes it; the water renderer reads it once per
// frame. No React state, no second subscription.
const FULL_SCALE_KIB = 20 * 1024 // 20 MiB/s reads as a full glitter path
const STALE_MS = 4000

let level = 0
let at = Number.NEGATIVE_INFINITY

/** Log scale, 0–1: a page load is visible, a large download saturates. */
export const seaTrafficLevel = (bytesPerSecond: number) =>
  Math.min(
    1,
    Math.max(
      0,
      Math.log10(1 + Math.max(0, bytesPerSecond) / 1024) /
        Math.log10(1 + FULL_SCALE_KIB),
    ),
  )

/** `null` when there is no live tunnel throughput (not connected, no frame yet). */
export const publishSeaTraffic = (
  bytesPerSecond: number | null,
  now = performance.now(),
) => {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) {
    level = 0
    at = Number.NEGATIVE_INFINITY
    return
  }
  level = seaTrafficLevel(bytesPerSecond)
  at = now
}

/** A writer that stopped (page left, socket dropped) reads as a calm sea. */
export const readSeaTraffic = (now = performance.now()) =>
  now - at > STALE_MS ? 0 : level
