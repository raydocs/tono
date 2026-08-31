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

/**
 * Renewal dates are calendar days on the operator's clock, but `new Date('2026-09-01')`
 * parses as UTC midnight and `toISOString()` renders back in UTC — west of
 * Greenwich the same stored second reads as the previous day. These two keep a
 * `<input type="date">` round-trip in local time.
 */

/** Unix seconds → the yyyy-mm-dd a date box should show, in local time. */
export function localDateInputValue(sec: number | null | undefined): string {
  if (sec == null) return '';
  const date = new Date(sec * 1_000);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A date box → unix seconds at local midnight. Empty clears; anything unparseable refuses. */
export function unixFromLocalDate(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return 'invalid';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return 'invalid';
  const seconds = Math.floor(date.getTime() / 1_000);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 'invalid';
}

/** Whole calendar days from today (local) to `sec`; negative when already past. */
export function calendarDaysUntil(sec: number, nowSec: number): number {
  const today = new Date(nowSec * 1_000);
  today.setHours(0, 0, 0, 0);
  const target = new Date(sec * 1_000);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
