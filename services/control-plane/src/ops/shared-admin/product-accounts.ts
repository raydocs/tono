import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
  now,
  id,
  str,
} from '../../env';
import {
  optionalIpv4,
} from '../../home';
import {
  PRODUCT_CLAUDE,
  accountRefField,
  optionalNotes,
  httpsUrlField,
  optionalUnix,
  optionalByteCount,
  optionalMoney,
  optionalCurrency,
  optionalBillingCycle,
  publicProductAccount,
  publicProductEvent,
  publicNodeProfile,
  writeOpsAudit,
  recordProductEvent,
  createAssignedProductAccount,
  banProductAccount,
  replaceProductAccount,
} from '../../product-account';
import { rejectUnexpectedKeys, body } from '../../request';

export async function productAccountsResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
  if (resource === 'product-accounts' && m === 'GET') {
    const status = new URL(req.url).searchParams.get('status');
    if (status !== null && !['pooled', 'assigned', 'banned', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const q = status
      ? await e.DB.prepare(
        `SELECT product_accounts.*, users.email
         FROM product_accounts
         LEFT JOIN users ON users.id = product_accounts.user_id
         WHERE product_accounts.status = ?
         ORDER BY product_accounts.updated_at DESC`,
      ).bind(status).all<Row>()
      : await e.DB.prepare(
        `SELECT product_accounts.*, users.email
         FROM product_accounts
         LEFT JOIN users ON users.id = product_accounts.user_id
         ORDER BY product_accounts.updated_at DESC
         LIMIT 500`,
      ).all<Row>();
    return Response.json({ accounts: q.results.map(publicProductAccount) });
  }
  if (resource === 'product-accounts' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['accountRef', 'userId', 'openedAt', 'notes']);
    const accountRef = accountRefField(b.accountRef);
    const notes = optionalNotes(b.notes);
    const openedAt = optionalUnix(b.openedAt, 'openedAt') ?? now();
    if (b.userId !== undefined && b.userId !== null && b.userId !== '') {
      const userId = str(b.userId, 'userId', 1, 100);
      const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<Row>();
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
      const row = await createAssignedProductAccount(e, userId, accountRef, openedAt, notes, actorEmail);
      return Response.json({ account: publicProductAccount(row) }, { status: 201 });
    }
    const existing = await e.DB.prepare(
      'SELECT id FROM product_accounts WHERE account_ref = ?',
    ).bind(accountRef).first<Row>();
    if (existing) throw new ApiError(409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
    const accountId = id();
    const t = now();
    await e.DB.prepare(
      `INSERT INTO product_accounts(
         id, user_id, product, account_ref, status, opened_at, closed_at, close_reason, notes, created_at, updated_at
       ) VALUES(?, NULL, ?, ?, 'pooled', NULL, NULL, NULL, ?, ?, ?)`,
    ).bind(accountId, PRODUCT_CLAUDE, accountRef, notes, t, t).run();
    await recordProductEvent(e, accountId, null, 'opened', 'pooled');
    await writeOpsAudit(e, actorEmail, 'product.pool', 'product_account', accountId, `pooled ${accountRef}`);
    const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
    return Response.json({ account: publicProductAccount(row!) }, { status: 201 });
  }
  mt = resource.match(/^product-accounts\/([^/]+)\/ban$/);
  if (mt && m === 'POST') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['detail']);
    const row = await banProductAccount(e, mt[1], optionalNotes(b.detail, 'detail', 1000), actorEmail);
    return Response.json({ account: publicProductAccount(row) });
  }
  mt = resource.match(/^product-accounts\/([^/]+)\/replace$/);
  if (mt && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['accountRef', 'notes']);
    const result = await replaceProductAccount(
      e, mt[1], accountRefField(b.accountRef), optionalNotes(b.notes), actorEmail,
    );
    return Response.json({
      previous: publicProductAccount(result.previous),
      account: publicProductAccount(result.current),
    });
  }
  mt = resource.match(/^product-accounts\/([^/]+)$/);
  if (mt && m === 'GET') {
    const row = await e.DB.prepare(
      `SELECT product_accounts.*, users.email
       FROM product_accounts
       LEFT JOIN users ON users.id = product_accounts.user_id
       WHERE product_accounts.id = ?`,
    ).bind(mt[1]).first<Row>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
    const events = await e.DB.prepare(
      'SELECT * FROM product_account_events WHERE account_id = ? ORDER BY at DESC LIMIT 50',
    ).bind(mt[1]).all<Row>();
    return Response.json({ account: publicProductAccount(row), events: events.results.map(publicProductEvent) });
  }

  if (resource === 'node-profiles' && m === 'GET') {
    const q = await e.DB.prepare(
      'SELECT * FROM ops_node_profiles ORDER BY status ASC, catalog_name ASC',
    ).all<Row>();
    return Response.json({ profiles: q.results.map(publicNodeProfile) });
  }
  if (resource === 'node-profiles' && m === 'POST') {
    const b = await body(req, 16 * 1024);
    rejectUnexpectedKeys(b, [
      'catalogName', 'publicIp', 'provider', 'billingUrl',
      'price', 'currency', 'billingCycle',
      'trafficQuotaBytes', 'trafficUsedBytes', 'trafficCycleStart', 'trafficCycleEnd',
      'cycleNetIn', 'cycleNetOut', 'renewsAt', 'notes', 'status',
    ]);
    const catalogName = str(b.catalogName, 'catalogName', 1, 200).trim();
    const publicIp = b.publicIp === undefined || b.publicIp === null || b.publicIp === ''
      ? null
      : optionalIpv4(b.publicIp, 'publicIp');
    const provider = optionalNotes(b.provider, 'provider', 80);
    const billingUrl = httpsUrlField(b.billingUrl, 'billingUrl');
    const profileId = id();
    const t = now();
    const status = b.status === undefined ? 'active' : str(b.status, 'status', 1, 20);
    if (!['active', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    try {
      await e.DB.prepare(
        `INSERT INTO ops_node_profiles(
           id, catalog_name, public_ip, provider, billing_url,
           price, currency, billing_cycle,
           traffic_quota_bytes, traffic_used_bytes, traffic_cycle_start, traffic_cycle_end,
           cycle_net_in, cycle_net_out, renews_at, notes, status, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        profileId, catalogName, publicIp, provider, billingUrl,
        optionalMoney(b.price, 'price'), optionalCurrency(b.currency), optionalBillingCycle(b.billingCycle),
        optionalByteCount(b.trafficQuotaBytes, 'trafficQuotaBytes'),
        optionalByteCount(b.trafficUsedBytes, 'trafficUsedBytes'),
        optionalUnix(b.trafficCycleStart, 'trafficCycleStart'),
        optionalUnix(b.trafficCycleEnd, 'trafficCycleEnd'),
        optionalByteCount(b.cycleNetIn, 'cycleNetIn'),
        optionalByteCount(b.cycleNetOut, 'cycleNetOut'),
        optionalUnix(b.renewsAt, 'renewsAt'),
        optionalNotes(b.notes),
        status, t, t,
      ).run();
    } catch {
      throw new ApiError(409, 'NODE_PROFILE_EXISTS', 'A profile with this catalog name already exists');
    }
    await writeOpsAudit(e, actorEmail, 'node.create', 'node_profile', profileId, catalogName);
    const row = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(profileId).first<Row>();
    return Response.json({ profile: publicNodeProfile(row!) }, { status: 201 });
  }
  mt = resource.match(/^node-profiles\/([^/]+)$/);
  if (mt && m === 'PUT') {
    const b = await body(req, 16 * 1024);
    rejectUnexpectedKeys(b, [
      'catalogName', 'publicIp', 'provider', 'billingUrl',
      'price', 'currency', 'billingCycle',
      'trafficQuotaBytes', 'trafficUsedBytes', 'trafficCycleStart', 'trafficCycleEnd',
      'cycleNetIn', 'cycleNetOut', 'renewsAt', 'notes', 'status',
    ]);
    const existing = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Node profile not found');
    const catalogName = b.catalogName === undefined
      ? String(existing.catalog_name)
      : str(b.catalogName, 'catalogName', 1, 200).trim();
    const status = b.status === undefined ? String(existing.status) : str(b.status, 'status', 1, 20);
    if (!['active', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    try {
      await e.DB.prepare(
        `UPDATE ops_node_profiles SET
           catalog_name = ?, public_ip = ?, provider = ?, billing_url = ?,
           price = ?, currency = ?, billing_cycle = ?,
           traffic_quota_bytes = ?, traffic_used_bytes = ?,
           traffic_cycle_start = ?, traffic_cycle_end = ?,
           cycle_net_in = ?, cycle_net_out = ?, renews_at = ?,
           notes = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        catalogName,
        b.publicIp === undefined
          ? (existing.public_ip == null ? null : String(existing.public_ip))
          : (b.publicIp === null || b.publicIp === '' ? null : optionalIpv4(b.publicIp, 'publicIp')),
        b.provider === undefined
          ? (existing.provider == null ? null : String(existing.provider))
          : optionalNotes(b.provider, 'provider', 80),
        b.billingUrl === undefined
          ? (existing.billing_url == null ? null : String(existing.billing_url))
          : httpsUrlField(b.billingUrl, 'billingUrl'),
        b.price === undefined
          ? (existing.price == null ? null : Number(existing.price))
          : optionalMoney(b.price, 'price'),
        b.currency === undefined
          ? (existing.currency == null ? null : String(existing.currency))
          : optionalCurrency(b.currency),
        b.billingCycle === undefined
          ? (existing.billing_cycle == null ? null : Number(existing.billing_cycle))
          : optionalBillingCycle(b.billingCycle),
        b.trafficQuotaBytes === undefined
          ? (existing.traffic_quota_bytes == null ? null : Number(existing.traffic_quota_bytes))
          : optionalByteCount(b.trafficQuotaBytes, 'trafficQuotaBytes'),
        b.trafficUsedBytes === undefined
          ? (existing.traffic_used_bytes == null ? null : Number(existing.traffic_used_bytes))
          : optionalByteCount(b.trafficUsedBytes, 'trafficUsedBytes'),
        b.trafficCycleStart === undefined
          ? (existing.traffic_cycle_start == null ? null : Number(existing.traffic_cycle_start))
          : optionalUnix(b.trafficCycleStart, 'trafficCycleStart'),
        b.trafficCycleEnd === undefined
          ? (existing.traffic_cycle_end == null ? null : Number(existing.traffic_cycle_end))
          : optionalUnix(b.trafficCycleEnd, 'trafficCycleEnd'),
        b.cycleNetIn === undefined
          ? (existing.cycle_net_in == null ? null : Number(existing.cycle_net_in))
          : optionalByteCount(b.cycleNetIn, 'cycleNetIn'),
        b.cycleNetOut === undefined
          ? (existing.cycle_net_out == null ? null : Number(existing.cycle_net_out))
          : optionalByteCount(b.cycleNetOut, 'cycleNetOut'),
        b.renewsAt === undefined
          ? (existing.renews_at == null ? null : Number(existing.renews_at))
          : optionalUnix(b.renewsAt, 'renewsAt'),
        b.notes === undefined
          ? (existing.notes == null ? null : String(existing.notes))
          : optionalNotes(b.notes),
        status,
        now(),
        mt[1],
      ).run();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, 'NODE_PROFILE_EXISTS', 'A profile with this catalog name already exists');
    }
    await writeOpsAudit(e, actorEmail, 'node.update', 'node_profile', mt[1], catalogName);
    const row = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(mt[1]).first<Row>();
    return Response.json({ profile: publicNodeProfile(row!) });
  }
  return null;
}
