/**
 * The arithmetic every chart in the console shares: mapping a domain onto
 * pixels, and choosing tick values a reader can add up in their head.
 *
 * Kept free of React and of the DOM so it can be tested on its own; the
 * components that draw with it live next to it.
 */

/** A straight map from `[d0, d1]` onto `[r0, r1]`; a zero-width domain maps to the middle. */
export function linear(d0: number, d1: number, r0: number, r1: number): (value: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * The low and high of the measured values, ignoring gaps, with a little room
 * above so the peak is not drawn on the frame. A chart of counts or bytes
 * starts at zero unless a value goes below it: a y axis that starts at 41 %
 * turns a two-point wobble into a cliff.
 */
export function extent(values: ReadonlyArray<number | null>, pad = 0.08): [number, number] {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (known.length === 0) return [0, 1];
  const lo = Math.min(0, ...known);
  const hi = Math.max(...known);
  if (hi === lo) return [lo, lo + 1];
  return [lo, hi + (hi - lo) * pad];
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/**
 * Round tick values covering `[lo, hi]`, roughly `count` of them: steps of
 * 1, 2, 2.5 or 5 times a power of ten, so every label is a number a person
 * would have written by hand.
 */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || count < 1) return [lo];
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE_STEPS.find((candidate) => candidate * power >= raw) ?? 10) * power;
  const first = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= hi + step * 1e-9; value += step) {
    ticks.push(Math.round(value / step) * step);
  }
  const last = ticks[ticks.length - 1];
  if (last !== undefined && last < hi) ticks.push(last + step);
  return ticks.map((tick) => Number(tick.toPrecision(12)));
}

/**
 * Round ticks for byte counts. The console spells bytes in powers of 1024,
 * so decimal ticks come out as "18.6 GB, 37.3 GB"; choosing the steps in
 * the unit the label will be printed in gives "10 GB, 20 GB" instead.
 */
export function byteTicks(lo: number, hi: number, count = 4): number[] {
  const unit = hi >= 1024 ? 1024 ** Math.floor(Math.log(hi) / Math.log(1024)) : 1;
  return niceTicks(lo / unit, hi / unit, count).map((tick) => tick * unit);
}

/**
 * Round ticks for a count of minutes: past three hours the label switches to
 * hours, so the steps are chosen in hours too — "8 小时" rather than "500 分钟"
 * printed as a rounded "8 小时" next to a gridline at 8.3.
 */
export function minuteTicks(lo: number, hi: number, count = 4): number[] {
  if (hi < 180) return niceTicks(lo, hi, count);
  return niceTicks(lo / 60, hi / 60, count).map((tick) => tick * 60);
}

export type AxisScale = 'linear' | 'bytes' | 'minutes';

export function axisTicks(scale: AxisScale, lo: number, hi: number, count: number): number[] {
  if (scale === 'bytes') return byteTicks(lo, hi, count);
  if (scale === 'minutes') return minuteTicks(lo, hi, count);
  return niceTicks(lo, hi, count);
}

const WIDE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** Rough rendered width of an 11 px label: CJK and full-width glyphs are square, the rest are mono digits. */
export function labelWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 11 : 6.6;
  return Math.ceil(width);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TIME_STEPS = [
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY,
];

/**
 * Time ticks in epoch seconds on wall-clock boundaries — 03:00, 06:00, midnight —
 * in the offset the reader is in, not UTC, because a tick at 07:00 labelled
 * "07:00" is the only kind anyone reads without stopping.
 */
export function timeTicks(lo: number, hi: number, count = 5, offsetSec = localOffsetSec(lo)): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || count < 1) return [];
  const raw = (hi - lo) / count;
  const step = TIME_STEPS.find((candidate) => candidate >= raw) ?? TIME_STEPS[TIME_STEPS.length - 1] ?? raw;
  const first = Math.ceil((lo + offsetSec) / step) * step - offsetSec;
  const ticks: number[] = [];
  for (let at = first; at <= hi; at += step) ticks.push(at);
  return ticks;
}

function localOffsetSec(atSec: number): number {
  return -new Date(atSec * 1_000).getTimezoneOffset() * MINUTE;
}

/** The index in a sorted list closest to `value`, for snapping a pointer to a column. */
export function nearestIndex(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? Infinity) <= value) lo = mid;
    else hi = mid;
  }
  return Math.abs((sorted[hi] ?? Infinity) - value) < Math.abs((sorted[lo] ?? Infinity) - value) ? hi : lo;
}

/**
 * Split a run of points at every gap. A stretch nobody measured is a break in
 * the line, never a dip to zero and never a straight line across the hole.
 */
/** A run is never empty, so `run[0]` is always a point. */
export type Run<T> = [T, ...T[]];

export function splitRuns<T>(points: readonly T[], isGap: (point: T) => boolean): Run<T>[] {
  const runs: Run<T>[] = [];
  let run: Run<T> | null = null;
  for (const point of points) {
    if (isGap(point)) {
      if (run) runs.push(run);
      run = null;
    } else if (run) {
      run.push(point);
    } else {
      run = [point];
    }
  }
  if (run) runs.push(run);
  return runs;
}

/**
 * Six categorical colours, defined per palette in `src/styles/charts.css`.
 * A seventh series on one chart is a table asking to be drawn as a chart.
 */
export const SERIES_COUNT = 6;

export function seriesColor(index: number): string {
  return `var(--series-${(index % SERIES_COUNT) + 1})`;
}
