/**
 * The wire conventions every `/api/v1/ops/*` list and read endpoint shares:
 * cursors, limits, `?since=`, the list envelope, and weak ETags.
 *
 * These live apart from the handlers because they are the half the console
 * depends on being identical everywhere. A cursor that means something
 * different on two endpoints, or an ETag that is only computed on some, turns
 * into paging that silently skips rows and polling that never gets a 304.
 *
 * Like `./contract`, this imports nothing but the shared `errors` module.
 */

import { ApiError } from '../errors';

/** Opaque to the console; `sortKey:id` to us. */
export interface Cursor {
  sortKey: string;
  id: string;
}

const CURSOR_TOKEN = /^[A-Za-z0-9_-]{1,512}$/;
// The sort key is ours (a timestamp, a name, a score) and must not contain the
// separator; the id is a UUID or a node name (Chinese names included), so it
// may be any non-control text, colons and all, after the first one.
const CURSOR_BODY = /^([^:\u0000-\u001f]{1,120}):([^\u0000-\u001f]{1,200})$/;

const invalidCursor = () => new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');

/**
 * Decode a paging cursor, or null when the caller sent none.
 *
 * Junk is a 400, never a silently ignored cursor: a mistyped cursor that
 * quietly restarts from page one looks exactly like a list that lost its
 * tail, and that is not a bug anyone finds by reading the page.
 */
export function parseCursor(raw: string | null | undefined): Cursor | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (!CURSOR_TOKEN.test(raw)) throw invalidCursor();
  let decoded: string;
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (raw.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidCursor();
  }
  const match = CURSOR_BODY.exec(decoded);
  if (!match) throw invalidCursor();
  return { sortKey: match[1], id: match[2] };
}

export function encodeCursor(sortKey: string | number, id: string): string {
  const key = String(sortKey);
  if (key.includes(':') || !CURSOR_BODY.test(`${key}:${id}`)) {
    // Our own bug, not the caller's: a sort key carrying the separator would
    // decode into a different row than it encoded.
    throw new ApiError(500, 'INTERNAL_ERROR', 'Invalid cursor parts');
  }
  const bytes = new TextEncoder().encode(`${key}:${id}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A page size. Missing means the default; oversized is clamped rather than
 * refused, because a console asking for too much is asking for "all of it".
 * Non-numeric is still a 400 — that is a bug, not an appetite.
 */
export function parseLimit(raw: string | null | undefined, bounds: { default: number; max: number }): number {
  if (raw === null || raw === undefined || raw === '') return bounds.default;
  if (!/^\d{1,9}$/.test(raw)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid limit');
  return Math.min(Math.max(Number(raw), 1), bounds.max);
}

/** `?since=` in epoch seconds, for cheap polling. */
export function parseSince(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (!/^\d{1,10}$/.test(raw)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid since');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid since');
  return value;
}

export interface ListEnvelope<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
  updatedAt: number;
}

/**
 * The one list shape. `total` is omitted, not nulled, when an endpoint cannot
 * count cheaply — the console shows "N 项" only when it was actually counted.
 */
export function listEnvelope<T>(
  items: T[],
  nextCursor: string | null,
  updatedAt: number,
  total?: number,
): ListEnvelope<T> {
  const envelope: ListEnvelope<T> = { items, nextCursor, updatedAt };
  if (total !== undefined) envelope.total = total;
  return envelope;
}

/**
 * A weak validator built from a version tuple — typically
 * `[MAX(updated_at), COUNT(*)]`.
 *
 * Weak because the bytes are not guaranteed identical (key order, a rounded
 * float), only the meaning; that is exactly what `If-None-Match` compares.
 * Parts are percent-encoded so a node name can never close the quoted string.
 */
export function weakEtag(parts: (string | number | null)[]): string {
  const body = parts
    .map((part) => (part === null ? '-' : encodeURIComponent(String(part))))
    .join(':');
  return `W/"${body}"`;
}

// Trim before stripping: list members arrive as `, W/"…"`, and a leading space
// would otherwise hide the prefix and make every tag past the first one miss.
const bareTag = (tag: string) => {
  const trimmed = tag.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
};

/**
 * A 304 when the client already has this version, else null.
 *
 * Call it before any other query: the whole point of the version tuple is that
 * a poll that has not changed costs one cheap statement instead of the page.
 */
export function notModified(req: Request, etag: string): Response | null {
  const header = req.headers.get('if-none-match');
  if (!header) return null;
  const wanted = bareTag(etag);
  const matched = header === '*'
    || header.split(',').some((candidate) => bareTag(candidate) === wanted);
  if (!matched) return null;
  return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-store' } });
}

/**
 * `no-store` and an ETag together are deliberate: the console must never serve
 * an ops page from disk cache, but it should still be able to ask "changed?"
 * and get a 304.
 */
export function jsonWithEtag(
  body: unknown,
  etag: string,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(body, {
    headers: { ...extraHeaders, etag, 'cache-control': 'no-store' },
  });
}
