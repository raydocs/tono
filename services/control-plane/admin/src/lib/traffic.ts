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

export type RatePoint = { t: number; dt: number; inBps: number | null; outBps: number | null };

export function seriesRates(
  points: Array<{ t: number; netIn: number | null; netOut: number | null }>,
  resolutionSeconds: number,
): RatePoint[] {
  const maxGap = Math.max(resolutionSeconds * 3, resolutionSeconds + 1);
  const out: RatePoint[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const dt = next.t - prev.t;
    out.push({
      t: next.t,
      dt,
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

export function nodeRateSeries(
  points: Array<{ t: number; netIn: number | null; netOut: number | null }>,
  resolutionSeconds: number,
): RatePoint[] {
  return seriesRates(points, resolutionSeconds);
}

export function aggregateFleetRates(
  series: Record<string, RatePoint[]>,
  expectedNodes: number,
): Array<RatePoint & { contributing: number; expected: number }> {
  const byTime = new Map<number, { inSum: number; outSum: number; inN: number; outN: number; contributing: number; dt: number }>();
  for (const points of Object.values(series)) {
    const seen = new Set<number>();
    for (const point of points) {
      if (seen.has(point.t)) continue;
      seen.add(point.t);
      const bucket = byTime.get(point.t) ?? { inSum: 0, outSum: 0, inN: 0, outN: 0, contributing: 0, dt: point.dt };
      bucket.contributing += 1;
      bucket.dt = point.dt;
      if (point.inBps != null) {
        bucket.inSum += point.inBps;
        bucket.inN += 1;
      }
      if (point.outBps != null) {
        bucket.outSum += point.outBps;
        bucket.outN += 1;
      }
      byTime.set(point.t, bucket);
    }
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, bucket]) => ({
      t,
      dt: bucket.dt,
      inBps: bucket.inN ? bucket.inSum : null,
      outBps: bucket.outN ? bucket.outSum : null,
      contributing: bucket.contributing,
      expected: expectedNodes,
    }));
}

export function rangeTransfer(points: RatePoint[]): { inBytes: number | null; outBytes: number | null } {
  let inBytes = 0;
  let outBytes = 0;
  let inAny = false;
  let outAny = false;
  for (const point of points) {
    if (!(point.dt > 0)) continue;
    if (point.inBps != null) {
      inBytes += point.inBps * point.dt;
      inAny = true;
    }
    if (point.outBps != null) {
      outBytes += point.outBps * point.dt;
      outAny = true;
    }
  }
  return { inBytes: inAny ? inBytes : null, outBytes: outAny ? outBytes : null };
}

export function latestValidRate(points: RatePoint[]): RatePoint | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    if (point.inBps != null || point.outBps != null) return point;
  }
  return null;
}

export function coverageByBucket(
  points: Array<{ contributing: number; expected: number }>,
): { present: number; expected: number; ratio: number | null } {
  if (points.length === 0) return { present: 0, expected: 0, ratio: null };
  const expected = points[0].expected;
  const present = Math.max(0, ...points.map((point) => point.contributing));
  return { present, expected, ratio: expected > 0 ? present / expected : null };
}
