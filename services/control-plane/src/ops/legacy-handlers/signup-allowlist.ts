import {
  type Env,
  type Row,
} from '../../env';
import {
  writeOpsAudit,
} from '../../product-account';
import {
  body,
  email,
} from '../../request';

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
