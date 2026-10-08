// Live throughput for the sea's water sparkle (decision 077). The dashboard's
// existing traffic subscription writes it; the water renderer reads it once per
// frame. No React state, no second subscription. The feed skips duplicate
// samples, so a steady rate is never stale: the writer clears it with `null`
// when the tunnel stops being live or the dashboard unmounts.
const FULL_SCALE_KIB = 20 * 1024 // 20 MiB/s reads as a full glitter path

let level = 0

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
export const publishSeaTraffic = (bytesPerSecond: number | null) => {
  level =
    bytesPerSecond === null || !Number.isFinite(bytesPerSecond)
      ? 0
      : seaTrafficLevel(bytesPerSecond)
}

export const readSeaTraffic = () => level
