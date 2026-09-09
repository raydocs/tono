export type Measured<T> = {
  value: T;
  asOfSec: number | null;
  source: string;
};

export function measured<T>(value: T, asOfSec: number | null, source: string): Measured<T> {
  return { value, asOfSec, source };
}

export function absent(source: string): Measured<null> {
  return { value: null, asOfSec: null, source };
}

export function isPresent<T>(row: Measured<T | null>): row is Measured<T> {
  return row.value !== null && row.value !== undefined;
}

/**
 * A short run of samples behind a metric — seven days of daily bytes, say.
 * `null` entries are gaps in the measurement, not zeroes.
 */
export type MetricSeries = {
  points: Array<number | null>;
  source: string;
  /**
   * The day the last point covers; every earlier point steps back one day.
   * Without it a bar can say how much but not when, and "20 GB" on an
   * unnamed day is the kind of number this console exists to stop printing.
   */
  lastDaySec?: number | null;
};
