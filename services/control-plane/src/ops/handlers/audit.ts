import { ACTOR_TYPES, assertAuditEntry, type ActorType, type AuditEntryDto } from '../contract';
import {
  Env,
  Row,
  afterCursor,
  encodeCursor,
  listJson,
  missingTable,
  now,
  nullText,
  pageParams,
  weakEtag,
} from './common';

function asActorType(value: unknown): ActorType {
  const text = nullText(value);
  if (text && (ACTOR_TYPES as readonly string[]).includes(text)) return text as ActorType;
  return 'owner';
}

function entryDto(row: Row): AuditEntryDto {
  return {
    id: String(row.id),
    at: Number(row.at),
    actorEmail: nullText(row.actor_email),
    actorType: asActorType(row.actor_type),
    actorRole: nullText(row.actor_role),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: nullText(row.target_id),
    summary: nullText(row.summary),
    requestId: nullText(row.request_id),
  };
}

export async function getAudit(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const { cursor, limit } = pageParams(url);
  const targetId = url.searchParams.get('targetId');
  const actorEmail = url.searchParams.get('actorEmail');
  const actorType = url.searchParams.get('actorType');
  const action = url.searchParams.get('action');
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT * FROM ops_audit
       WHERE (? = '' OR target_id = ?)
         AND (? = '' OR actor_email = ?)
         AND (? = '' OR actor_type = ?)
         AND (? = '' OR action = ?)
       ORDER BY at DESC, id DESC
       LIMIT 500`,
    ).bind(
      targetId ?? '', targetId ?? '',
      actorEmail ?? '', actorEmail ?? '',
      actorType ?? '', actorType ?? '',
      action ?? '', action ?? '',
    ).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(entryDto).filter((row) => afterCursor(cursor, String(row.at), row.id, 'desc'));
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.at), last.id) : null;
  const updatedAt = sliced[0]?.at ?? now();
  return listJson(
    e, req, sliced, nextCursor, updatedAt,
    weakEtag([updatedAt, items.length, targetId, actorEmail, actorType, action]),
    assertAuditEntry,
  );
}
