import { type Env } from './env';

const PASSWORD_AUTH_DISABLED = 'PASSWORD_AUTH_DISABLED';

/** First sign-in: copy onboard wechat/contact/notes off the allowlist row. */
export async function insertUserCarryingAllowlistProfile(
  e: Env,
  userId: string,
  emailAddr: string,
  createdAt: number,
): Promise<void> {
  await e.DB.prepare(
    `INSERT OR IGNORE INTO users(
       id, email, password_hash, password_salt, created_at, updated_at,
       wechat_id, contact, notes
     ) SELECT ?, ?, ?, ?, ?, ?, a.wechat_id, a.contact, a.notes
       FROM (SELECT 1) LEFT JOIN signup_allowlist a ON a.email = ?`,
  ).bind(
    userId,
    emailAddr,
    PASSWORD_AUTH_DISABLED,
    PASSWORD_AUTH_DISABLED,
    createdAt,
    createdAt,
    emailAddr,
  ).run();
}
