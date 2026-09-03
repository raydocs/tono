/** Convert a millisecond epoch to unix seconds. Delay sample times are ms; heartbeats are seconds. */
export function msEpochToSec(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.floor(value / 1000);
}
