import {
  type Env,
  type Row,
} from '../../env';

export const OPS_USERS_PAGE_LIMIT = 2000;

/**
 * The console's customer roster, one page per query.
 *
 * This used to fetch up to 2000 users and then expand three `IN (?,?,…)`
 * lists with one placeholder per user; the joins now ride along in the same
 * statement. `total`/`hasMore`/`nextCursor` exist because the old LIMIT 2000
 * truncated silently — the 2001st customer simply did not appear anywhere.
 */
export async function operationsUsers(
  e: Env,
  page?: { cursor?: { createdAt: number; id: string } | null; limit?: number | null },
) {
  const limit = Math.min(Math.max(page?.limit ?? OPS_USERS_PAGE_LIMIT, 1), OPS_USERS_PAGE_LIMIT);
  const cursor = page?.cursor ?? null;
  const [rows, totals] = await Promise.all([
    e.DB.prepare(
      `WITH page AS (
         SELECT * FROM users
         WHERE ? = 0 OR created_at < ? OR (created_at = ? AND id < ?)
         ORDER BY created_at DESC, id DESC
         LIMIT ?
       )
       SELECT
         page.*,
         home_exits.id AS home_exit_id,
         home_exits.proxy_name AS home_proxy_name,
         home_exits.display_name AS home_display_name,
         home_exits.egress_ipv4 AS home_egress_ipv4,
         home_exits.kind AS home_kind,
         home_exits.socks5_host AS home_socks5_host,
         home_exits.socks5_port AS home_socks5_port,
         home_exits.status AS home_status,
         user_home_bindings.default_proxy_name AS home_default_proxy_name,
         assigned.account_ref AS product_account_ref,
         assigned.status AS product_status,
         assigned.opened_at AS product_opened_at,
         (SELECT COUNT(*) FROM product_account_events
          WHERE type = 'replaced' AND user_id = page.id) AS replace_count,
         EXISTS(SELECT 1 FROM exit_credentials WHERE user_id = page.id) AS has_exit_identity
       FROM page
       LEFT JOIN user_home_bindings ON user_home_bindings.user_id = page.id
       LEFT JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       LEFT JOIN product_accounts assigned
         ON assigned.user_id = page.id AND assigned.status = 'assigned'
       ORDER BY page.created_at DESC, page.id DESC`,
    ).bind(
      cursor ? 1 : 0,
      cursor?.createdAt ?? 0,
      cursor?.createdAt ?? 0,
      cursor?.id ?? '',
      limit + 1,
    ).all<Row>(),
    e.DB.prepare('SELECT COUNT(*) AS total FROM users').first<Row>(),
  ]);
  const hasMore = rows.results.length > limit;
  const pageRows = hasMore ? rows.results.slice(0, limit) : rows.results;
  const last = pageRows[pageRows.length - 1];
  const users = pageRows.map((row) => ({
    ...publicUser(row),
    hasExitIdentity: Number(row.has_exit_identity) === 1,
    homeBinding: row.home_exit_id
      ? {
        homeExitId: String(row.home_exit_id),
        proxyName: String(row.home_proxy_name),
        displayName: String(row.home_display_name),
        egressIpv4: row.home_egress_ipv4 == null ? undefined : String(row.home_egress_ipv4),
        kind: row.home_kind == null ? undefined : String(row.home_kind),
        socks5Host: row.home_socks5_host == null ? undefined : String(row.home_socks5_host),
        socks5Port: row.home_socks5_port == null ? undefined : Number(row.home_socks5_port),
        defaultProxyName: row.home_default_proxy_name == null || row.home_default_proxy_name === ''
          ? undefined
          : String(row.home_default_proxy_name),
        status: String(row.home_status),
      }
      : null,
    product: {
      accountRef: row.product_account_ref == null ? null : String(row.product_account_ref),
      status: row.product_status == null ? null : String(row.product_status),
      openedAt: row.product_opened_at == null ? null : Number(row.product_opened_at),
      replaceCount: Number(row.replace_count ?? 0),
      incomplete: row.product_account_ref == null,
    },
  }));
  return {
    users,
    total: Number(totals?.total ?? 0),
    hasMore,
    nextCursor: hasMore && last ? `${Number(last.created_at)}:${String(last.id)}` : null,
  };
}

export const publicUser = (u: Row) => ({
  id: u.id,
  email: u.email,
  name: u.name ?? undefined,
  plan: u.plan ?? undefined,
  notes: u.notes == null || u.notes === '' ? undefined : String(u.notes),
  contact: u.contact == null || u.contact === '' ? undefined : String(u.contact),
  firstEntitledAt: u.first_entitled_at == null ? undefined : Number(u.first_entitled_at),
  deviceLimit: Number(u.device_limit ?? 2),
  quotaBytes: u.quota_bytes,
  usageBytes: Number(u.usage_bytes ?? 0),
  expiresAt: u.expires_at ?? undefined,
  suspended: u.status !== 'active',
  status: u.status,
  createdAt: u.created_at,
});
