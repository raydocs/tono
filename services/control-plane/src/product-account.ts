import { type Env, type Row, now, id, str } from './env';
import { ApiError } from './errors';

export const PRODUCT_CLAUDE = 'claude_20x';

export function accountRefField(value: unknown): string {
  const raw = str(value, 'accountRef', 1, 200).trim();
  if (/[\r\n\0]/.test(raw)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid accountRef');
  return raw.includes('@') ? raw.toLowerCase() : raw;
}

export function optionalNotes(value: unknown, name = 'notes', max = 2000): string | null {
  if (value === undefined || value === null || value === '') return null;
  return str(value, name, 1, max);
}

export function httpsUrlField(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const url = str(value, name, 8, 500).trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${name} must be https`);
  }
  return parsed.toString();
}

export function optionalUnix(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

export function optionalByteCount(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

export function optionalMoney(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value;
}

export function optionalCurrency(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const currency = str(value, 'currency', 1, 8).trim();
  if (!/^[A-Za-z$€£¥￥]{1,8}$/.test(currency)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid currency');
  }
  return currency;
}

export function optionalBillingCycle(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 3_650) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid billingCycle');
  }
  return value as number;
}

export function publicProductAccount(row: Row) {
  return {
    id: String(row.id),
    userId: row.user_id == null ? null : String(row.user_id),
    email: row.email == null ? undefined : String(row.email),
    product: String(row.product),
    accountRef: String(row.account_ref),
    status: String(row.status),
    openedAt: row.opened_at == null ? null : Number(row.opened_at),
    closedAt: row.closed_at == null ? null : Number(row.closed_at),
    closeReason: row.close_reason == null ? null : String(row.close_reason),
    notes: row.notes == null || row.notes === '' ? undefined : String(row.notes),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function publicProductEvent(row: Row) {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    userId: row.user_id == null ? null : String(row.user_id),
    type: String(row.type),
    at: Number(row.at),
    detail: row.detail == null ? undefined : String(row.detail),
    replacedByAccountId: row.replaced_by_account_id == null ? undefined : String(row.replaced_by_account_id),
  };
}

export function publicNodeProfile(row: Row) {
  return {
    id: String(row.id),
    catalogName: String(row.catalog_name),
    publicIp: row.public_ip == null ? undefined : String(row.public_ip),
    provider: row.provider == null ? undefined : String(row.provider),
    billingUrl: row.billing_url == null ? undefined : String(row.billing_url),
    price: row.price == null ? null : Number(row.price),
    currency: row.currency == null ? null : String(row.currency),
    billingCycle: row.billing_cycle == null ? null : Number(row.billing_cycle),
    trafficQuotaBytes: row.traffic_quota_bytes == null ? null : Number(row.traffic_quota_bytes),
    trafficUsedBytes: row.traffic_used_bytes == null ? null : Number(row.traffic_used_bytes),
    trafficCycleStart: row.traffic_cycle_start == null ? null : Number(row.traffic_cycle_start),
    trafficCycleEnd: row.traffic_cycle_end == null ? null : Number(row.traffic_cycle_end),
    cycleNetIn: row.cycle_net_in == null ? null : Number(row.cycle_net_in),
    cycleNetOut: row.cycle_net_out == null ? null : Number(row.cycle_net_out),
    renewsAt: row.renews_at == null ? null : Number(row.renews_at),
    notes: row.notes == null || row.notes === '' ? undefined : String(row.notes),
    status: String(row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export const OPS_ACTOR_TYPES = ['access_admin', 'token_admin', 'collector', 'exit_node', 'system'] as const;
export type OpsActorType = (typeof OPS_ACTOR_TYPES)[number];

export type OpsAuditMeta = {
  actorType?: OpsActorType;
  actorRole?: string;
  requestId?: string | null;
};

function resolveActorType(actorEmail: string | undefined, meta?: OpsAuditMeta): OpsActorType {
  if (meta?.actorType) return meta.actorType;
  const email = (actorEmail || '').toLowerCase();
  if (email === 'system') return 'system';
  if (email === 'collector') return 'collector';
  if (email === 'token-admin') return 'token_admin';
  return 'access_admin';
}

export function opsAuditStatement(
  e: Env,
  actorEmail: string | undefined,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
  onlyIfPreviousStatementChanged = false,
  meta?: OpsAuditMeta,
) {
  return e.DB.prepare(
    `INSERT INTO ops_audit(
       id, at, actor_email, action, target_type, target_id, summary,
       actor_type, actor_role, request_id
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     ${onlyIfPreviousStatementChanged ? 'WHERE changes() > 0' : ''}`,
  ).bind(
    id(),
    now(),
    (actorEmail || 'unknown').slice(0, 254),
    action.slice(0, 80),
    targetType.slice(0, 80),
    targetId,
    summary.slice(0, 500),
    resolveActorType(actorEmail, meta),
    (meta?.actorRole ?? 'owner').slice(0, 40),
    meta?.requestId ?? null,
  );
}

export async function writeOpsAudit(
  e: Env,
  actorEmail: string | undefined,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
  meta?: OpsAuditMeta,
) {
  try {
    await opsAuditStatement(e, actorEmail, action, targetType, targetId, summary, false, meta).run();
  } catch {
    // Audit must never fail the operator action; the table may be mid-migration.
  }
}

export async function markFirstEntitled(e: Env, userId: string, at: number) {
  await e.DB.prepare(
    `UPDATE users
     SET first_entitled_at = COALESCE(first_entitled_at, ?),
         plan = COALESCE(plan, ?),
         updated_at = ?
     WHERE id = ?`,
  ).bind(at, PRODUCT_CLAUDE, at, userId).run();
}

export async function recordProductEvent(
  e: Env,
  accountId: string,
  userId: string | null,
  type: string,
  detail: string | null,
  replacedBy: string | null = null,
) {
  await e.DB.prepare(
    `INSERT INTO product_account_events(
       id, account_id, user_id, type, at, detail, replaced_by_account_id
     ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id(), accountId, userId, type, now(), detail, replacedBy).run();
}

export async function assignedProductForUser(e: Env, userId: string) {
  return e.DB.prepare(
    "SELECT * FROM product_accounts WHERE user_id = ? AND status = 'assigned'",
  ).bind(userId).first<Row>();
}

export async function replaceCountForUser(e: Env, userId: string) {
  const row = await e.DB.prepare(
    "SELECT COUNT(*) total FROM product_account_events WHERE user_id = ? AND type = 'replaced'",
  ).bind(userId).first<Row>();
  return Number(row?.total ?? 0);
}

export async function createAssignedProductAccount(
  e: Env,
  userId: string,
  accountRef: string,
  openedAt: number,
  notes: string | null,
  actorEmail: string | undefined,
) {
  const current = await assignedProductForUser(e, userId);
  if (current) {
    throw new ApiError(409, 'PRODUCT_ALREADY_ASSIGNED', 'User already has an assigned Claude account; replace it instead');
  }
  const clash = await e.DB.prepare(
    'SELECT id, status FROM product_accounts WHERE account_ref = ?',
  ).bind(accountRef).first<Row>();
  const t = now();
  if (clash) {
    if (String(clash.status) !== 'pooled') {
      throw new ApiError(409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
    }
    await e.DB.prepare(
      `UPDATE product_accounts
       SET user_id = ?, status = 'assigned', opened_at = COALESCE(opened_at, ?), notes = COALESCE(?, notes), updated_at = ?
       WHERE id = ? AND status = 'pooled'`,
    ).bind(userId, openedAt, notes, t, clash.id).run();
    await recordProductEvent(e, String(clash.id), userId, 'assigned', null);
    await markFirstEntitled(e, userId, openedAt);
    await writeOpsAudit(e, actorEmail, 'product.assign', 'product_account', String(clash.id), `assigned ${accountRef}`);
    const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(clash.id).first<Row>();
    return row!;
  }
  const accountId = id();
  try {
    await e.DB.prepare(
      `INSERT INTO product_accounts(
         id, user_id, product, account_ref, status, opened_at, closed_at, close_reason, notes, created_at, updated_at
       ) VALUES(?, ?, ?, ?, 'assigned', ?, NULL, NULL, ?, ?, ?)`,
    ).bind(accountId, userId, PRODUCT_CLAUDE, accountRef, openedAt, notes, t, t).run();
  } catch {
    throw new ApiError(409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
  }
  await recordProductEvent(e, accountId, userId, 'opened', null);
  await recordProductEvent(e, accountId, userId, 'assigned', null);
  await markFirstEntitled(e, userId, openedAt);
  await writeOpsAudit(e, actorEmail, 'product.open', 'product_account', accountId, `opened ${accountRef}`);
  const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
  return row!;
}

export async function banProductAccount(e: Env, accountId: string, detail: string | null, actorEmail: string | undefined) {
  const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
  if (String(row.status) !== 'assigned' && String(row.status) !== 'pooled') {
    throw new ApiError(409, 'ACCOUNT_NOT_ACTIVE', 'Only assigned or pooled accounts can be banned');
  }
  const t = now();
  await e.DB.prepare(
    `UPDATE product_accounts
     SET status = 'banned', closed_at = ?, close_reason = 'banned', updated_at = ?
     WHERE id = ?`,
  ).bind(t, t, accountId).run();
  await recordProductEvent(e, accountId, row.user_id == null ? null : String(row.user_id), 'banned', detail);
  await writeOpsAudit(
    e, actorEmail, 'product.ban', 'product_account', accountId,
    `banned ${row.account_ref}`,
  );
  return (await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>())!;
}

export async function replaceProductAccount(
  e: Env,
  accountId: string,
  nextRef: string,
  notes: string | null,
  actorEmail: string | undefined,
) {
  const current = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
  if (String(current.status) !== 'assigned' || current.user_id == null) {
    throw new ApiError(409, 'ACCOUNT_NOT_ASSIGNED', 'Only an assigned account can be replaced');
  }
  const userId = String(current.user_id);
  const clash = await e.DB.prepare(
    'SELECT id, status FROM product_accounts WHERE account_ref = ?',
  ).bind(nextRef).first<Row>();
  if (clash && String(clash.status) !== 'pooled') {
    throw new ApiError(409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
  }
  const t = now();
  await e.DB.prepare(
    `UPDATE product_accounts
     SET status = 'retired', closed_at = ?, close_reason = 'rotated', updated_at = ?
     WHERE id = ?`,
  ).bind(t, t, accountId).run();
  const next = await createAssignedProductAccount(e, userId, nextRef, t, notes, actorEmail);
  await recordProductEvent(e, accountId, userId, 'replaced', null, String(next.id));
  await writeOpsAudit(
    e, actorEmail, 'product.replace', 'product_account', String(next.id),
    `replaced ${current.account_ref}`,
  );
  return { previous: (await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>())!, current: next };
}
