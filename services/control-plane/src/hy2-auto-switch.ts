import { type Env, type Row } from './env';

/**
 * hy2 auto-switch (backlog A18, owner decision D1-C).
 *
 * The answer is a permission, not a route: `true` lets a client that has
 * failed on a node's VLESS Reality block move on its own to the ` · hy2`
 * block of the SAME node (same base name, same Tono-issued identity; see
 * `catalog-yaml.ts`). It never adds, removes or reorders a catalog entry, and
 * manual choice of a served hy2 block does not depend on it.
 *
 * Resolution, strictest first:
 * - a per-account override `off` → off, whatever the global switch says;
 * - a per-account override `on` → on;
 * - otherwise the global switch, and failing that `internal_account`.
 *
 * Defaults (migration 0100): global off, no account internal, no override, so
 * every account resolves off until an operator marks it internal or flips a
 * switch. Nothing flips on a timer: "everyone after two weeks" is an operator
 * pressing the global switch.
 */
export type Hy2AutoSwitchOverride = 'on' | 'off' | null;

export function resolveHy2AutoSwitch(input: {
  override: Hy2AutoSwitchOverride;
  internalAccount: boolean;
  allAccounts: boolean;
}): boolean {
  if (input.override === 'off') return false;
  if (input.override === 'on') return true;
  return input.allAccounts || input.internalAccount;
}

export function hy2Override(value: unknown): Hy2AutoSwitchOverride {
  return value === 'on' || value === 'off' ? value : null;
}

/** Global switch. A missing row reads as off. */
export async function hy2AutoSwitchAllAccounts(e: Env): Promise<{
  allAccounts: boolean;
  updatedAt: number | null;
}> {
  const row = await e.DB.prepare(
    'SELECT all_accounts, updated_at FROM hy2_auto_switch_settings WHERE singleton_id = 1',
  ).first<Row>();
  return {
    allAccounts: Number(row?.all_accounts ?? 0) === 1,
    updatedAt: Number(row?.updated_at ?? 0) || null,
  };
}

/**
 * The resolved permission for one account; an unknown account is off, and so
 * is a failed read: the catalog that carries this answer must not become
 * unavailable because of it, and off is what every client did before A18.
 */
export async function hy2AutoSwitchForUser(e: Env, userId: string): Promise<boolean> {
  try {
    return await readHy2AutoSwitchForUser(e, userId);
  } catch {
    console.warn('hy2 auto-switch read failed; serving off');
    return false;
  }
}

async function readHy2AutoSwitchForUser(e: Env, userId: string): Promise<boolean> {
  const row = await e.DB.prepare(
    `SELECT users.internal_account, users.hy2_auto_switch,
            COALESCE(settings.all_accounts, 0) AS all_accounts
     FROM users
     LEFT JOIN hy2_auto_switch_settings settings ON settings.singleton_id = 1
     WHERE users.id = ?`,
  ).bind(userId).first<Row>();
  if (!row) return false;
  return resolveHy2AutoSwitch({
    override: hy2Override(row.hy2_auto_switch),
    internalAccount: Number(row.internal_account) === 1,
    allAccounts: Number(row.all_accounts) === 1,
  });
}
