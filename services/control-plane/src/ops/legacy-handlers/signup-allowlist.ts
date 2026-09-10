import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
} from '../../env';
import {
  optionalNotes,
  writeOpsAudit,
} from '../../product-account';
import {
  body,
  email,
  rejectUnexpectedKeys,
} from '../../request';
import { assertFunnelRow } from '../contract';
import { optionalWechatId } from './users';
import { decodeName, entityJson, weakEtag } from '../handlers/common';

export async function getOpsSignupAllowlist(e: Env): Promise<Response> {
  const q = await e.DB.prepare(
    'SELECT email, created_at FROM signup_allowlist ORDER BY created_at DESC, email ASC',
  ).all<Row>();
  return Response.json({
    entries: q.results.map((entry) => ({
      email: String(entry.email),
      createdAt: Number(entry.created_at),
    })),
  });
}

export async function deleteOpsSignupAllowlist(req: Request, e: Env, actor: { email: string }): Promise<Response> {
  const b = await body(req, 4 * 1024);
  const address = email(b.email);
  const deleted = await e.DB.prepare('DELETE FROM signup_allowlist WHERE email = ?').bind(address).run();
  if (deleted.meta.changes) {
    await writeOpsAudit(e, actor.email, 'allowlist.remove', 'signup_allowlist', address, address);
  }
  return new Response(null, { status: 204 });
}

export async function patchOpsSignupAllowlist(
  req: Request,
  e: Env,
  actor: { email: string },
  mt: RegExpMatchArray,
): Promise<Response> {
  const address = email(decodeName(mt[1], 'email'));
  const b = await body(req, 4 * 1024);
  rejectUnexpectedKeys(b, ['wechatId', 'contact', 'notes']);
  const existing = await e.DB.prepare(
    'SELECT email, created_at, wechat_id, contact, notes FROM signup_allowlist WHERE email = ?',
  ).bind(address).first<Row>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Allowlist entry not found');
  const registered = await e.DB.prepare('SELECT id FROM users WHERE email = ?').bind(address).first<Row>();
  if (registered) throw new ApiError(409, 'ALREADY_REGISTERED', 'User already registered');
  await e.DB.prepare(
    `UPDATE signup_allowlist SET
       wechat_id = CASE WHEN ? THEN ? ELSE wechat_id END,
       contact = CASE WHEN ? THEN ? ELSE contact END,
       notes = CASE WHEN ? THEN ? ELSE notes END
     WHERE email = ?`,
  ).bind(
    b.wechatId !== undefined, b.wechatId === undefined ? null : optionalWechatId(b.wechatId),
    b.contact !== undefined, b.contact === undefined ? null : optionalNotes(b.contact, 'contact', 200),
    b.notes !== undefined, b.notes === undefined ? null : optionalNotes(b.notes),
    address,
  ).run();
  const row = await e.DB.prepare(
    'SELECT email, created_at, wechat_id, contact, notes FROM signup_allowlist WHERE email = ?',
  ).bind(address).first<Row>();
  const dto = {
    key: `invite:${address}`,
    userId: null,
    email: String(row?.email ?? address),
    wechatId: row?.wechat_id == null || row.wechat_id === '' ? null : String(row.wechat_id),
    contact: row?.contact == null || row.contact === '' ? null : String(row.contact),
    notes: row?.notes == null || row.notes === '' ? null : String(row.notes),
    stage: 'invited' as const,
    stageSinceAt: Number(row?.created_at ?? existing.created_at),
    lastSeenAt: null,
  };
  await writeOpsAudit(e, actor.email, 'allowlist.profile', 'signup_allowlist', address, address);
  return entityJson(e, req, dto, weakEtag([address, dto.stageSinceAt, dto.wechatId, dto.contact, dto.notes]), assertFunnelRow);
}
