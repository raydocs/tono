import { ApiError } from '../../errors';
import { type Env, type Row, now } from '../../env';
import { enqueueRefreshCatalogForUser } from '../../catalog';
import {
  hy2AutoSwitchAllAccounts,
  hy2Override,
  resolveHy2AutoSwitch,
} from '../../hy2-auto-switch';
import { opsAuditStatement, opsAuditStatementFrom } from '../../product-account';
import { rejectUnexpectedKeys, body } from '../../request';

/**
 * The two hy2 auto-switch controls (A18, D1-C): one global switch, and per
 * account an "internal" mark plus an on/off override. Gated on the Access
 * door by `access-roles.ts` (global write `settings.publish`, account write
 * `customers.write`); every change that lands writes one `ops_audit` row in
 * the same batch, and a no-op writes none.
 *
 * What clients see is the resolved answer in their own catalog
 * (`hy2AutoSwitch`); see `src/hy2-auto-switch.ts` for the order.
 */
export async function hy2AutoSwitchResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
): Promise<Response | null> {
  if (resource === 'hy2-auto-switch') {
    if (m === 'GET') return Response.json(await globalView(e));
    if (m !== 'PUT') return null;
    const b = await body(req, 1024);
    rejectUnexpectedKeys(b, ['allAccounts']);
    if (typeof b.allAccounts !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'allAccounts must be a boolean');
    }
    const value = b.allAccounts ? 1 : 0;
    await e.DB.batch([
      e.DB.prepare(
        `INSERT INTO hy2_auto_switch_settings(singleton_id, all_accounts, updated_at)
         VALUES(1, ?, ?)
         ON CONFLICT(singleton_id) DO UPDATE SET
           all_accounts = excluded.all_accounts, updated_at = excluded.updated_at
         WHERE hy2_auto_switch_settings.all_accounts != excluded.all_accounts`,
      ).bind(value, now()),
      opsAuditStatement(
        e, actorEmail, 'hy2-auto-switch.global', 'hy2_auto_switch_settings', '1',
        b.allAccounts
          ? 'all accounts on (per-account off still wins)'
          : 'all accounts off (internal accounts and per-account on stay on)',
        true,
      ),
    ]);
    return Response.json(await globalView(e));
  }

  const mt = resource.match(/^users\/([^/]+)\/hy2-auto-switch$/);
  if (!mt) return null;
  const userId = mt[1]!;
  if (m === 'GET') return Response.json(await accountView(e, userId));
  if (m !== 'PUT') return null;
  const b = await body(req, 1024);
  rejectUnexpectedKeys(b, ['internalAccount', 'override']);
  if (b.internalAccount === undefined && b.override === undefined) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'internalAccount or override is required');
  }
  if (b.internalAccount !== undefined && typeof b.internalAccount !== 'boolean') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'internalAccount must be a boolean');
  }
  if (b.override !== undefined && b.override !== null && b.override !== 'on' && b.override !== 'off') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'override must be on, off or null');
  }
  // Existence check (404). The write sets only the fields this request names,
  // in SQL, so two concurrent partial PUTs cannot restore each other's stale
  // value; and the "was" half of the audit line is read inside the same batch.
  await accountView(e, userId);
  const setInternal = b.internalAccount !== undefined;
  const internalValue = b.internalAccount === true ? 1 : 0;
  const setOverride = b.override !== undefined;
  const overrideValue = hy2Override(b.override);
  const changed = [
    setInternal ? `internal ${b.internalAccount ? 'yes' : 'no'}` : null,
    setOverride ? `override ${overrideValue ?? 'default'}` : null,
  ].filter((part): part is string => part !== null).join('; ');
  // Rows this request would change. The audit INSERT runs first in the batch
  // against the same predicate, so it sees the pre-update row in the same
  // transaction (SQLite's RETURNING yields only new values) and writes
  // nothing when the UPDATE is a no-op.
  const willChange = `users.id = ?
         AND ((? AND users.internal_account != ?) OR (? AND users.hy2_auto_switch IS NOT ?))`;
  const willChangeBinds = [
    userId, setInternal ? 1 : 0, internalValue, setOverride ? 1 : 0, overrideValue,
  ];
  const [, update] = await e.DB.batch([
    opsAuditStatementFrom(
      e, actorEmail, 'user.hy2-auto-switch', 'user', userId,
      `set ${changed}; auto-switch was `,
      // resolveHy2AutoSwitch in SQL, over the pre-update row.
      `CASE users.hy2_auto_switch WHEN 'off' THEN 'off' WHEN 'on' THEN 'on'
         ELSE CASE WHEN COALESCE(settings.all_accounts, 0) = 1 OR users.internal_account = 1
                   THEN 'on' ELSE 'off' END
       END`,
      {
        sql: `FROM users
              LEFT JOIN hy2_auto_switch_settings settings ON settings.singleton_id = 1
              WHERE ${willChange}`,
        binds: willChangeBinds,
      },
    ),
    e.DB.prepare(
      `UPDATE users SET
         internal_account = CASE WHEN ? THEN ? ELSE internal_account END,
         hy2_auto_switch = CASE WHEN ? THEN ? ELSE hy2_auto_switch END,
         updated_at = ?
       WHERE ${willChange}`,
    ).bind(
      setInternal ? 1 : 0, internalValue, setOverride ? 1 : 0, overrideValue, now(),
      ...willChangeBinds,
    ),
  ]);
  // The answer rides the catalog response, so ask this account's devices
  // (and only them) to fetch it now rather than at their next poll.
  if (update?.meta.changes) await enqueueRefreshCatalogForUser(e, userId);
  return Response.json(await accountView(e, userId));
}

async function globalView(e: Env) {
  const [global, counts] = await Promise.all([
    hy2AutoSwitchAllAccounts(e),
    e.DB.prepare(
      `SELECT SUM(CASE WHEN internal_account = 1 THEN 1 ELSE 0 END) AS internal_accounts,
              SUM(CASE WHEN hy2_auto_switch = 'on' THEN 1 ELSE 0 END) AS override_on,
              SUM(CASE WHEN hy2_auto_switch = 'off' THEN 1 ELSE 0 END) AS override_off
       FROM users`,
    ).first<Row>(),
  ]);
  return {
    ...global,
    internalAccounts: Number(counts?.internal_accounts ?? 0),
    overrideOn: Number(counts?.override_on ?? 0),
    overrideOff: Number(counts?.override_off ?? 0),
  };
}

async function accountView(e: Env, userId: string) {
  const row = await e.DB.prepare(
    `SELECT users.id, users.internal_account, users.hy2_auto_switch,
            COALESCE(settings.all_accounts, 0) AS all_accounts
     FROM users
     LEFT JOIN hy2_auto_switch_settings settings ON settings.singleton_id = 1
     WHERE users.id = ?`,
  ).bind(userId).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'User not found');
  const internalAccount = Number(row.internal_account) === 1;
  const override = hy2Override(row.hy2_auto_switch);
  const allAccounts = Number(row.all_accounts) === 1;
  return {
    userId: String(row.id),
    internalAccount,
    override,
    allAccounts,
    effective: resolveHy2AutoSwitch({ override, internalAccount, allAccounts }),
  };
}
