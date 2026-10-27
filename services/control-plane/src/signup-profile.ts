import { type Env } from './env';

const PASSWORD_AUTH_DISABLED = 'PASSWORD_AUTH_DISABLED';

/**
 * First sign-in: copy onboard wechat/contact/notes/expiry/plan off the allowlist row.
 *
 * `publicSignup` is set when only open registration admitted this address. With
 * no allowlist row the account then expires at its own creation: it exists and
 * the mailbox is verified, but it holds no plan, so every entitlement gate
 * (sign-in, sessions, catalog, exit rosters) refuses service until an operator
 * grants one (decision 138). An invitation added meanwhile still wins.
 */
export async function insertUserCarryingAllowlistProfile(
  e: Env,
  userId: string,
  emailAddr: string,
  createdAt: number,
  publicSignup = false,
): Promise<void> {
  await e.DB.prepare(
    `INSERT OR IGNORE INTO users(
       id, email, password_hash, password_salt, created_at, updated_at,
       wechat_id, contact, notes, expires_at, plan
     ) SELECT ?, ?, ?, ?, ?, ?, a.wechat_id, a.contact, a.notes,
              CASE WHEN ? AND a.email IS NULL THEN ? ELSE a.expires_at END, a.plan
       FROM (SELECT 1) LEFT JOIN signup_allowlist a ON a.email = ?`,
  ).bind(
    userId,
    emailAddr,
    PASSWORD_AUTH_DISABLED,
    PASSWORD_AUTH_DISABLED,
    createdAt,
    createdAt,
    publicSignup ? 1 : 0,
    createdAt,
    emailAddr,
  ).run();
}
