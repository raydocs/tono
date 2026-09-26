import { ApiError } from '../../errors';
import { type Env, type Row } from '../../env';
import { publicHomeBinding } from '../../home';

export async function getOpsUserHomeBinding(e: Env, mt: RegExpMatchArray): Promise<Response> {
  const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  const row = await e.DB.prepare(
    `SELECT
       user_home_bindings.user_id,
       users.email,
       user_home_bindings.home_exit_id,
       user_home_bindings.default_proxy_name,
       home_exits.proxy_name,
       home_exits.display_name,
       home_exits.kind,
       home_exits.socks5_host,
       home_exits.socks5_port,
       home_exits.egress_ipv4,
       home_exits.status AS home_status,
       user_home_bindings.created_at,
       user_home_bindings.updated_at
     FROM user_home_bindings
     JOIN users ON users.id = user_home_bindings.user_id
     JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
     WHERE user_home_bindings.user_id = ?`,
  ).bind(mt[1]).first<Row>();
  return Response.json({ binding: row ? publicHomeBinding(row) : null });
}
