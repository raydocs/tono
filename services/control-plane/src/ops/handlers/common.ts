import { type Env, type Row, id, now } from '../../env';
import { ApiError } from '../../errors';
import { writeOpsAudit } from '../../product-account';
import {
  encodeCursor,
  jsonWithEtag,
  listEnvelope,
  notModified,
  parseCursor,
  parseLimit,
  parseSince,
  type Cursor,
} from '../http';
import {
  RANGE_KEYS,
  type Platform,
  type RangeKey,
  type SourceId,
  PLATFORMS,
  type Measured,
} from '../contract';
import { assertList } from '../contract';

export const PAGE = { default: 50, max: 200 };
export const TOKEN_FRESH_SEC = 15 * 60;
export const HEARTBEAT_FRESH_SEC = 40 * 60;

export type Actor = { email: string };

export function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export function contractStrict(e: Env): boolean {
  return (e as Env & { OPS_CONTRACT_STRICT?: string }).OPS_CONTRACT_STRICT === '1';
}

export function check(e: Env, run: () => void): void {
  if (contractStrict(e)) run();
}

export function nullText(value: unknown): string | null {
  if (value == null || value === '') return null;
  const text = String(value);
  return text.length ? text : null;
}

export function nullInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function nullNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function asPlatform(value: unknown): Platform | null {
  const text = nullText(value);
  if (text && (PLATFORMS as readonly string[]).includes(text)) return text as Platform;
  return null;
}

export function measured<T>(value: T, asOfSec: number | null, source: SourceId): Measured<T> {
  return { value, asOfSec: asOfSec != null && asOfSec > 0 ? asOfSec : null, source };
}

export function parseRange(raw: string | null | undefined): RangeKey {
  if (raw == null || raw === '') return '24h';
  if (!(RANGE_KEYS as readonly string[]).includes(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid range');
  }
  return raw as RangeKey;
}

export function rangeSeconds(range: RangeKey): number {
  if (range === '24h') return 86_400;
  if (range === '7d') return 7 * 86_400;
  if (range === '30d') return 30 * 86_400;
  return 90 * 86_400;
}

export function parseListed(raw: string | null): boolean | null {
  if (raw == null || raw === '') return null;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid listed');
}

export function decodeName(raw: string, label = 'name'): string {
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
  }
  if (!name || name.length > 200 || /[\r\n\0]/.test(name)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
  }
  return name;
}

export function jsonNoStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export function pageParams(url: URL): { cursor: Cursor | null; limit: number; since: number | null } {
  return {
    cursor: parseCursor(url.searchParams.get('cursor')),
    limit: parseLimit(url.searchParams.get('limit'), PAGE),
    since: parseSince(url.searchParams.get('since')),
  };
}

export function listJson<T>(
  e: Env,
  req: Request,
  items: T[],
  nextCursor: string | null,
  updatedAt: number,
  etag: string,
  itemChecker: (value: unknown, path?: string) => T,
  total?: number,
): Response {
  const hit = notModified(req, etag);
  if (hit) return hit;
  const body = listEnvelope(items, nextCursor, updatedAt, total);
  check(e, () => {
    assertList(body, itemChecker);
  });
  return jsonWithEtag(body, etag);
}

export function entityJson<T>(
  e: Env,
  req: Request,
  body: T,
  etag: string,
  assert: (value: unknown) => T,
): Response {
  const hit = notModified(req, etag);
  if (hit) return hit;
  check(e, () => {
    assert(body);
  });
  return jsonWithEtag(body, etag);
}

export async function auditWrite(
  e: Env,
  actorEmail: string,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
): Promise<void> {
  await writeOpsAudit(e, actorEmail, action, targetType, targetId, summary);
  try {
    await e.DB.prepare(
      `UPDATE ops_audit
       SET actor_type = 'owner', actor_role = 'owner'
       WHERE id = (
         SELECT id FROM ops_audit
         WHERE actor_email = ? AND action = ?
         ORDER BY at DESC, id DESC
         LIMIT 1
       )`,
    ).bind(actorEmail.slice(0, 254), action.slice(0, 80)).run();
  } catch {
    // actor_type/actor_role may be absent mid-migration; the insert still landed.
  }
}

export function nextPageCursor<T>(
  page: T[],
  limit: number,
  sortKey: (row: T) => string | number,
  idOf: (row: T) => string,
): { items: T[]; nextCursor: string | null } {
  const hasMore = page.length > limit;
  const items = hasMore ? page.slice(0, limit) : page;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(sortKey(last), idOf(last)) : null,
  };
}

export function afterCursor(
  cursor: Cursor | null,
  sortKey: string,
  id: string,
  direction: 'asc' | 'desc',
): boolean {
  if (!cursor) return true;
  if (direction === 'asc') {
    return sortKey > cursor.sortKey || (sortKey === cursor.sortKey && id > cursor.id);
  }
  return sortKey < cursor.sortKey || (sortKey === cursor.sortKey && id < cursor.id);
}

export { encodeCursor, parseCursor, parseLimit, parseSince, jsonWithEtag, notModified, weakEtag } from '../http';
export { now, id };
export type { Env, Row, Cursor };
