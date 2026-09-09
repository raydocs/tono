import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
} from '../../env';

export async function auditResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
): Promise<Response | null> {
  if (resource === 'audit' && m === 'GET') {
    // Plain newest-100 without params, exactly as before; the filters exist so
    // an operator can follow one target or actor back past the first page
    // instead of the log stopping at whatever happened most recently.
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get('limit');
    let limit = 100;
    if (rawLimit !== null) {
      limit = Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid limit');
      }
    }
    const rawBefore = params.get('before');
    let before: number | null = null;
    if (rawBefore !== null) {
      before = Number(rawBefore);
      if (!Number.isSafeInteger(before) || before <= 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid before');
      }
    }
    // A second is not unique — a PATCH that resets usage and changes a field
    // writes two rows in the same one — so paging on the timestamp alone drops
    // whichever of them did not fit on the page. `beforeId` carries the rest of
    // the cursor; `before` on its own still means what it always did.
    const rawBeforeId = params.get('beforeId');
    let beforeId: string | null = null;
    if (rawBeforeId !== null) {
      if (before === null || !/^.{1,100}$/.test(rawBeforeId)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid beforeId');
      }
      beforeId = rawBeforeId;
    }
    const targetId = params.get('targetId');
    const actorEmail = params.get('actorEmail');
    // The two equality filters are spliced in rather than guarded by a bound
    // flag: one plan is compiled for every binding, and `? = 0 OR target_id = ?`
    // can never reach an index on `target_id`, so following one customer back
    // through the log would read all of it.
    const filters = [
      ...(targetId === null ? [] : ['AND target_id = ?']),
      ...(actorEmail === null ? [] : ['AND actor_email = ?']),
    ].join('\n         ');
    const q = await e.DB.prepare(
      `SELECT * FROM ops_audit
       WHERE (? = 0 OR at < ? OR (? = 1 AND at = ? AND id < ?))
         ${filters}
       ORDER BY at DESC, id DESC LIMIT ?`,
    ).bind(...[
      before === null ? 0 : 1, before ?? 0,
      beforeId === null ? 0 : 1, before ?? 0, beforeId ?? '',
      ...(targetId === null ? [] : [targetId]),
      ...(actorEmail === null ? [] : [actorEmail]),
      limit + 1,
    ]).all<Row>();
    const hasMore = q.results.length > limit;
    const rows = hasMore ? q.results.slice(0, limit) : q.results;
    const last = rows.length ? rows[rows.length - 1] : null;
    const actorTypes = new Set(['access_admin', 'token_admin', 'collector', 'exit_node', 'system']);
    return Response.json({
      entries: rows.map((row) => {
        const actorType = row.actor_type == null || row.actor_type === '' ? null : String(row.actor_type);
        return {
          id: String(row.id),
          at: Number(row.at),
          actorEmail: String(row.actor_email),
          actorType: actorType && actorTypes.has(actorType) ? actorType : null,
          actorRole: row.actor_role == null || row.actor_role === '' ? null : String(row.actor_role),
          action: String(row.action),
          targetType: String(row.target_type),
          targetId: row.target_id == null ? null : String(row.target_id),
          summary: String(row.summary),
          requestId: row.request_id == null || row.request_id === '' ? null : String(row.request_id),
        };
      }),
      hasMore,
      nextBefore: hasMore && last ? Number(last.at) : null,
      nextBeforeId: hasMore && last ? String(last.id) : null,
    });
  }
  return null;
}
