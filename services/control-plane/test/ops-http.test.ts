// Cursors, limits and ETags. These are the shared conventions, so a bug here
// is a bug on every ops endpoint at once: paging that drops rows, or polling
// that never gets a 304 and pays for the whole page every fifteen seconds.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  encodeCursor,
  jsonWithEtag,
  listEnvelope,
  notModified,
  parseCursor,
  parseLimit,
  parseSince,
  weakEtag,
} from '../src/ops/http';

const withHeader = (value: string | null) =>
  new Request('https://api.example.com/api/v1/ops/nodes', {
    headers: value === null ? {} : { 'if-none-match': value },
  });

describe('cursors', () => {
  it('round-trips a numeric sort key and a uuid', () => {
    const cursor = encodeCursor(1_757_000_000, '0f9d5c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f');
    expect(parseCursor(cursor)).toEqual({
      sortKey: '1757000000',
      id: '0f9d5c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    });
  });

  // Node names are the row ids on the fleet endpoints and they are Chinese, so
  // the cursor has to survive multi-byte text intact.
  it('round-trips a Chinese node name', () => {
    const cursor = encodeCursor('洛杉矶', '洛杉矶 CN2 GIA');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseCursor(cursor)).toEqual({ sortKey: '洛杉矶', id: '洛杉矶 CN2 GIA' });
  });

  it('keeps colons inside the id', () => {
    expect(parseCursor(encodeCursor(1, 'a:b:c'))).toEqual({ sortKey: '1', id: 'a:b:c' });
  });

  it('treats an absent cursor as the first page', () => {
    expect(parseCursor(null)).toBeNull();
    expect(parseCursor(undefined)).toBeNull();
    expect(parseCursor('')).toBeNull();
  });

  // A cursor that silently restarts at page one is indistinguishable from a
  // list that lost its tail, so junk is a 400 rather than a fresh first page.
  it.each([
    ['not base64url', 'not base64!'],
    ['valid base64url with no separator', btoa('nocolonhere').replace(/=+$/, '')],
    ['valid base64url that is not utf-8', 'gA'],
    ['an empty sort key', btoa(':abc').replace(/=+$/, '')],
  ])('refuses %s', (_name, raw) => {
    expect(() => parseCursor(raw)).toThrow(ApiError);
    try {
      parseCursor(raw);
    } catch (error) {
      expect((error as ApiError).status).toBe(400);
    }
  });

  it('refuses to encode a sort key carrying the separator', () => {
    expect(() => encodeCursor('a:b', 'id')).toThrow(ApiError);
  });
});

describe('parseLimit', () => {
  it('falls back to the default', () => {
    expect(parseLimit(null, { default: 50, max: 500 })).toBe(50);
    expect(parseLimit('', { default: 50, max: 500 })).toBe(50);
  });

  it('clamps to the maximum instead of refusing', () => {
    expect(parseLimit('5000', { default: 50, max: 500 })).toBe(500);
  });

  it('clamps zero up to one', () => {
    expect(parseLimit('0', { default: 50, max: 500 })).toBe(1);
  });

  it('keeps a value inside the bounds', () => {
    expect(parseLimit('120', { default: 50, max: 500 })).toBe(120);
  });

  it.each(['abc', '-1', '1.5', '1e3'])('refuses %s', (raw) => {
    expect(() => parseLimit(raw, { default: 50, max: 500 })).toThrow(ApiError);
  });
});

describe('parseSince', () => {
  it('reads epoch seconds', () => {
    expect(parseSince('1757000000')).toBe(1_757_000_000);
  });

  it('is null when absent', () => {
    expect(parseSince(null)).toBeNull();
  });

  it.each(['yesterday', '-5', '1757000000000000'])('refuses %s', (raw) => {
    expect(() => parseSince(raw)).toThrow(ApiError);
  });
});

describe('listEnvelope', () => {
  it('omits total rather than nulling it', () => {
    const envelope = listEnvelope([1, 2], null, 1_757_000_000);
    expect('total' in envelope).toBe(false);
  });

  it('carries a total when the endpoint counted', () => {
    expect(listEnvelope([1], 'abc', 1_757_000_000, 9).total).toBe(9);
  });
});

describe('weak ETags', () => {
  it('is stable for the same version tuple', () => {
    expect(weakEtag([1_757_000_000, 42])).toBe(weakEtag([1_757_000_000, 42]));
  });

  it('changes when either half of the tuple changes', () => {
    const base = weakEtag([1_757_000_000, 42]);
    expect(weakEtag([1_757_000_001, 42])).not.toBe(base);
    expect(weakEtag([1_757_000_000, 43])).not.toBe(base);
  });

  it('marks a never-updated table without colliding with a zero', () => {
    expect(weakEtag([null, 0])).not.toBe(weakEtag([0, 0]));
  });

  // A node name in the tuple must not be able to close the quoted string or
  // split the comma-separated If-None-Match list.
  it('encodes parts that would break the header', () => {
    const etag = weakEtag(['a"b,c', 1]);
    expect(etag.slice(3, -1)).not.toMatch(/["',]/);
  });

  it('is announced as weak', () => {
    expect(weakEtag([1, 2]).startsWith('W/"')).toBe(true);
  });
});

describe('notModified', () => {
  const etag = weakEtag([1_757_000_000, 42]);

  it('is null without an If-None-Match', () => {
    expect(notModified(withHeader(null), etag)).toBeNull();
  });

  it('matches the exact tag', async () => {
    const response = notModified(withHeader(etag), etag);
    expect(response?.status).toBe(304);
    expect(response?.headers.get('etag')).toBe(etag);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(await response?.text()).toBe('');
  });

  // Weak comparison: a client that dropped the W/ prefix still holds the same
  // version, and refusing it would cost a full page for nothing.
  it('matches with the W/ prefix stripped', () => {
    expect(notModified(withHeader(etag.slice(2)), etag)?.status).toBe(304);
  });

  it('matches one tag inside a list', () => {
    const header = `${weakEtag([1, 1])}, ${etag}, W/"other"`;
    expect(notModified(withHeader(header), etag)?.status).toBe(304);
  });

  it('matches the wildcard', () => {
    expect(notModified(withHeader('*'), etag)?.status).toBe(304);
  });

  it('is null for a different version', () => {
    expect(notModified(withHeader(weakEtag([1_757_000_001, 42])), etag)).toBeNull();
  });

  it('is null for a prefix of the tag', () => {
    expect(notModified(withHeader('W/"1757000000"'), etag)).toBeNull();
  });
});

describe('jsonWithEtag', () => {
  it('never lets an ops page into a disk cache', async () => {
    const etag = weakEtag([1, 2]);
    const response = jsonWithEtag({ items: [] }, etag, { 'x-tono-range': '7d' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBe(etag);
    expect(response.headers.get('x-tono-range')).toBe('7d');
    expect(await response.json()).toEqual({ items: [] });
  });

  // An extra header must never be able to undo the two this function exists
  // to set.
  it('keeps its own headers ahead of the extras', () => {
    const response = jsonWithEtag({}, weakEtag([1]), { 'cache-control': 'public, max-age=600' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
