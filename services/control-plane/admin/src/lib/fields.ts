/**
 * Reading a form box back as one of three answers.
 *
 * A box is not a number — it is "leave it alone", "clear it", or "set it to
 * this", and a bare `Number(text)` collapses all three into one. Both edges
 * came out backwards on the server-profile form:
 *
 *   emptied  → `undefined` → `JSON.stringify` drops the member → the server
 *              keeps the old value, so a wrong quota could be typed and never
 *              removed;
 *   mistyped → `NaN` → `JSON.stringify` writes `null` → which is the wire form
 *              of "clear it", so the one input that was certainly an accident
 *              was the one that erased the field.
 *
 * `'invalid'` exists so a caller can refuse to send anything at all. Nothing
 * here reaches the network; it decides what may.
 */
export type Parsed = number | null | 'invalid';

const GIB = 1024 ** 3;

/** Gibibytes as typed → bytes. Empty clears; anything unparseable refuses. */
export function gibibytes(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return 'invalid';
  const bytes = Math.round(value * GIB);
  return Number.isSafeInteger(bytes) ? bytes : 'invalid';
}

/** A date box → unix seconds. Empty clears; anything unparseable refuses. */
export function unixDateTimeLocal(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const ms = new Date(trimmed).getTime();
  if (!Number.isFinite(ms)) return 'invalid';
  const seconds = Math.floor(ms / 1_000);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 'invalid';
}

export function tcpPort(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return 'invalid';
  return value;
}

export function unixDate(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const ms = new Date(trimmed).getTime();
  if (!Number.isFinite(ms)) return 'invalid';
  const seconds = Math.floor(ms / 1_000);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 'invalid';
}
