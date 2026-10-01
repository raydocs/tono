import { DAY, HOUR, NOW } from '@proto/format';
import { beijingHour, diurnal, rng } from './rng';

export type Range = '1h' | '24h' | '7d' | '30d';
export type Point = { at: number; v: number | null };

export const RANGE_STEP: Record<Range, { count: number; step: number }> = {
  '1h': { count: 60, step: 60_000 },
  '24h': { count: 96, step: 15 * 60_000 },
  '7d': { count: 84, step: 2 * HOUR },
  '30d': { count: 60, step: 12 * HOUR },
};

export function timeline(range: Range): number[] {
  const { count, step } = RANGE_STEP[range];
  const end = Math.floor(NOW / step) * step;
  return Array.from({ length: count }, (_, i) => end - (count - 1 - i) * step);
}

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Shape = {
  base: number;
  swing?: number;
  noise?: number;
  min?: number;
  max?: number;
  /** A window (ms ago, from..to) where the value is pushed by `by`. */
  dip?: { from: number; to: number; by: number };
  gaps?: number;
};

/** A deterministic, human-looking series: a daily rhythm, noise and optional incidents. */
export function series(key: string, range: Range, shape: Shape): Point[] {
  const r = rng(hash(`${key}:${range}`));
  let drift = 0;
  return timeline(range).map((at) => {
    if (shape.gaps && r.chance(shape.gaps)) return { at, v: null };
    drift = drift * 0.8 + (r.next() - 0.5) * (shape.noise ?? 0.05);
    let v = shape.base * (1 + (shape.swing ?? 0) * (diurnal(beijingHour(at)) - 0.75)) + drift * shape.base;
    if (shape.dip) {
      const age = NOW - at;
      if (age <= shape.dip.from && age >= shape.dip.to) v += shape.dip.by;
    }
    if (shape.min != null) v = Math.max(shape.min, v);
    if (shape.max != null) v = Math.min(shape.max, v);
    return { at, v };
  });
}

export function sumSeries(list: Point[][]): Point[] {
  if (list.length === 0) return [];
  return list[0].map((p, i) => ({
    at: p.at,
    v: list.reduce((acc, s) => acc + (s[i]?.v ?? 0), 0),
  }));
}

export function last(points: Point[]): number | null {
  for (let i = points.length - 1; i >= 0; i -= 1) if (points[i].v != null) return points[i].v;
  return null;
}

export { DAY, HOUR };
