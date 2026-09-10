import { count, list, record, send, text } from './settings-legacy';

/**
 * 注册白名单, on the wire.
 *
 * The same passthrough treatment `settings-legacy.ts` gives the catalogue and
 * the rules: three endpoints that predate the typed contract, a hand-written
 * shape per response, and a guard that refuses anything else. It sits in its
 * own file rather than beside them only because that one is at its line
 * budget; the request helper and the four guards are imported from it, so
 * there is still exactly one place these calls are made from.
 *
 * The delete carries a body, which is why it cannot go through `api.ts`: the
 * address is in the JSON rather than in the path, and `deleteJson` sends none.
 */

/** One line of `GET signup-allowlist`, newest first the way the hub sorts it. */
export type AllowedEmail = {
  email: string;
  createdAt: number;
};

function readEntry(value: unknown): AllowedEmail {
  const row = record(value);
  return { email: text(row.email), createdAt: count(row.createdAt) };
}

function readEntries(value: unknown): AllowedEmail[] {
  return list(record(value).entries).map(readEntry);
}

/**
 * What `POST signup-allowlist` answers.
 *
 * `created` is false when the address was already on the list — the hub
 * inserts or ignores rather than refusing, and 201 and 200 are the two
 * answers. The section says which of the two happened instead of showing the
 * same confirmation for both, because "already there" is the answer that
 * stops an operator hunting for why a customer still cannot sign up.
 */
export type AllowlistAdded = AllowedEmail & { created: boolean };

function readAdded(value: unknown): AllowlistAdded {
  const row = record(value);
  return { ...readEntry(row), created: row.created === true };
}

const nothing = () => null;

export const allowlistApi = {
  entries: (signal?: AbortSignal) =>
    send('GET', 'signup-allowlist', undefined, readEntries, signal),
  add: (email: string) =>
    send('POST', 'signup-allowlist', { email }, readAdded),
  remove: (email: string) =>
    send('DELETE', 'signup-allowlist', { email }, nothing),
};

/**
 * Is this an address at all, decided here rather than by the input's own
 * `type=email`.
 *
 * The hub's `email()` lowercases and requires one `@` with something either
 * side; a browser that has been told to validate would let the form submit
 * whatever its own rules allow and leave the operator reading a 400 from the
 * far end. One rule, checked before the request goes out, and the same words
 * whichever browser is in front of it.
 */
export function isEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
}
