import { nowSec } from './clock';

/**
 * Committed fixtures are written against a fixed `clock`; the console renders
 * relative times off `nowSec()`. Shifting every timestamp by the difference is
 * what keeps "3 分钟前" saying three minutes a year after the file was written.
 *
 * The two sets below are the reason this is not a regex on key names. Most
 * epochs on the wire are seconds, but a connection event's `atMs` and
 * `receivedAt` are milliseconds, and shifting those by seconds moves them by
 * about a day and a half — a timeline that quietly reorders itself.
 */
const MS_KEYS = new Set(['atMs', 'receivedAt']);

/**
 * Keys whose value is an aligned bucket, and the size of the bucket.
 *
 * The shift is `now - clock`, which is almost never a whole number of hours,
 * so a plain addition moves every `hourAt` 43 minutes off the hour and the
 * 7x24 strip ends up spanning eight ragged calendar days. Snapping the result
 * back to its own grid keeps the buckets buckets; it costs under half a
 * bucket of accuracy, on a value that is a bucket label rather than a
 * measurement.
 */
const SNAP_KEYS: Record<string, number> = {
  hourAt: 3_600,
  dayAt: 86_400,
};

const SEC_KEYS = new Set([
  'at',
  'asOfSec',
  'connectedSince',
  'notBefore',
  'snoozedUntil',
  'leasedUntil',
  // The quota cycle's two ends. They are epochs like the rest and have to
  // travel with them, or a node's 本周期 reads two years before its own
  // 预计耗尽日.
  'cycleStart',
  'cycleEnd',
]);

function isSecondsKey(key: string): boolean {
  return SEC_KEYS.has(key) || (key.endsWith('At') && !MS_KEYS.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shift(value: unknown, key: string, seconds: number): unknown {
  if (Array.isArray(value)) return value.map((item) => shift(item, '', seconds));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [name, nested] of Object.entries(value)) out[name] = shift(nested, name, seconds);
    return out;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  if (MS_KEYS.has(key)) return value + seconds * 1_000;
  if (!isSecondsKey(key)) return value;
  const shifted = value + seconds;
  const bucket = SNAP_KEYS[key];
  return bucket ? Math.round(shifted / bucket) * bucket : shifted;
}

/** Move a whole fixture body from its recorded clock to now. */
export function materializeOps<T>(body: T, clock: number): T {
  return shift(body, '', nowSec() - clock) as T;
}
