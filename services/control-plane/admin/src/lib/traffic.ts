/**
 * Komari network counters are cumulative bytes, not live rates.
 * `netIn` ← totalDown, `netOut` ← totalUp. Do not label them as current speed.
 */

export type TrafficAccounting = 'sum' | 'max' | 'min' | 'up' | 'down';

export function parseTrafficLimitType(value: string | null | undefined): {
  accounting: TrafficAccounting;
  assumed: boolean;
} {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw === 'sum') return { accounting: 'sum', assumed: false };
  if (raw === 'max') return { accounting: 'max', assumed: false };
  if (raw === 'min') return { accounting: 'min', assumed: false };
  if (raw === 'up' || raw === 'upload' || raw === 'out') return { accounting: 'up', assumed: false };
  if (raw === 'down' || raw === 'download' || raw === 'in') return { accounting: 'down', assumed: false };
  // Komari default is sum. Unknown strings must not silently invent another rule.
  return { accounting: 'sum', assumed: true };
}

export function accountedBytes(
  netIn: number | null | undefined,
  netOut: number | null | undefined,
  accounting: TrafficAccounting,
): number | null {
  if (accounting === 'up') return netOut ?? null;
  if (accounting === 'down') return netIn ?? null;
  if (netIn == null && netOut == null) return null;
  const inn = netIn ?? 0;
  const out = netOut ?? 0;
  if (accounting === 'max') return Math.max(inn, out);
  if (accounting === 'min') return Math.min(inn, out);
  return inn + out;
}

/**
 * Bytes per second between two cumulative samples. Returns null on reset,
 * missing values, non-positive dt, or a gap wider than maxGapSeconds.
 */
export function counterDeltaBps(
  prev: { t: number; value: number | null },
  next: { t: number; value: number | null },
  maxGapSeconds: number,
): number | null {
  if (prev.value == null || next.value == null) return null;
  const dt = next.t - prev.t;
  if (!(dt > 0) || dt > maxGapSeconds) return null;
  if (next.value < prev.value) return null;
  return (next.value - prev.value) / dt;
}

export function seriesRates(
  points: Array<{ t: number; netIn: number | null; netOut: number | null }>,
  resolutionSeconds: number,
): Array<{ t: number; inBps: number | null; outBps: number | null }> {
  const maxGap = Math.max(resolutionSeconds * 3, resolutionSeconds + 1);
  const out: Array<{ t: number; inBps: number | null; outBps: number | null }> = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    out.push({
      t: next.t,
      inBps: counterDeltaBps(
        { t: prev.t, value: prev.netIn },
        { t: next.t, value: next.netIn },
        maxGap,
      ),
      outBps: counterDeltaBps(
        { t: prev.t, value: prev.netOut },
        { t: next.t, value: next.netOut },
        maxGap,
      ),
    });
  }
  return out;
}
