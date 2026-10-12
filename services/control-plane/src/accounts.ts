// Account resolution for the passwordless sign-in paths: which Tono account a
// verified email code or OIDC claim lands on, and when a claim may only create
// an account rather than select an existing one.
import { ApiError } from './errors';
import { type Env, type Row, id, now } from './env';
import { googleAuthoritativeForEmail, type OidcIdentity } from './oidc';
import { insertUserCarryingAllowlistProfile } from './signup-profile';

export function ineligible(u: Row, t = now()) {
  return u.status !== 'active' ||
    (u.expires_at !== null && u.expires_at <= t) ||
    (u.quota_bytes !== null && u.usage_bytes >= u.quota_bytes);
}

// Least recently seen first, over the live devices aliased `candidate`: the
// later of the row's own last_seen_at (created_at before the first sighting)
// and its newest telemetry heartbeat, then creation time, then rowid, so ties
// never depend on the query plan. Shared by login rotation and limit eviction.
export const DEVICE_LRU_ORDER = `MAX(
  COALESCE(candidate.last_seen_at, candidate.created_at),
  COALESCE((
    SELECT received_at FROM telemetry_windows
    WHERE device_id = candidate.id
    ORDER BY received_at DESC
    LIMIT 1
  ), 0)
) ASC,
candidate.created_at ASC,
candidate.rowid ASC`;

/**
 * Set one account's device limit and, only when that lowers the stored limit,
 * revoke its live devices beyond the new limit, least recently seen first;
 * return the revoked device ids (D15-A, H17-C-F1, A9-RAISE-EVICTS-OVERCAP).
 *
 * `limitWrite` is the users UPDATE that writes `newLimit`. It runs in the same
 * D1 batch, which is one SQLite transaction, right after the victim selection.
 * The selection compares `newLimit` with the limit stored at that moment, so a
 * raise or an unchanged limit evicts nothing even when the account is already
 * over its old cap (it catches up at its next login), and concurrent calls see
 * each other's committed limit. The excess is computed from `newLimit` and the
 * live devices committed at that moment, so the cap and the eviction commit or
 * roll back together and a retry finds nothing left to evict. Every eviction
 * statement is scoped to `userId`. The victims go through the same outbox as
 * login rotation: a tailnet revocation job, the device row, its sessions and
 * its exit credential.
 */
export async function evictDevicesOverLimit(
  e: Env,
  userId: string,
  newLimit: number,
  limitWrite: D1PreparedStatement,
): Promise<{ limitWriteChanges: number; evicted: string[] }> {
  const t = now();
  const evictionId = id();
  const victims = `SELECT device_id FROM device_rotation_victims WHERE rotation_id = ?`;
  const results = await e.DB.batch<Row>([
    e.DB.prepare(
      `INSERT INTO device_rotation_victims(rotation_id, device_id)
       SELECT ?, candidate.id
       FROM devices candidate
       WHERE candidate.user_id = ? AND candidate.status IN ('pending', 'active')
         AND ? < (SELECT device_limit FROM users WHERE id = ?)
       ORDER BY ${DEVICE_LRU_ORDER}
       LIMIT MAX(0,
         (SELECT COUNT(*) FROM devices live
          WHERE live.user_id = ? AND live.status IN ('pending', 'active'))
         - ?
       )`,
    ).bind(evictionId, userId, newLimit, userId, userId, newLimit),
    limitWrite,
    e.DB.prepare(
      `INSERT INTO revocation_jobs(
         id, device_id, tailscale_node_id, created_at, ownership_generation, reason
       )
       SELECT ? || ':' || devices.id,
              devices.id, devices.tailscale_node_id, ?, devices.claim_generation,
              'device_limit_lowered'
       FROM devices
       WHERE devices.id IN (${victims})
         AND devices.user_id = ? AND devices.tailscale_node_id IS NOT NULL
       ON CONFLICT(tailscale_node_id) DO UPDATE SET
         completed_at = NULL,
         last_error = NULL,
         last_attempt_at = 0,
         device_id = excluded.device_id,
         created_at = excluded.created_at,
         ownership_generation = excluded.ownership_generation,
         reason = excluded.reason`,
    ).bind(evictionId, t, evictionId, userId),
    e.DB.prepare(
      `UPDATE devices SET
         status = 'revoked',
         claim_token = NULL,
         claim_expires_at = NULL,
         updated_at = ?
       WHERE id IN (${victims})
         AND user_id = ? AND status IN ('pending', 'active')`,
    ).bind(t, evictionId, userId),
    e.DB.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE revoked_at IS NULL AND user_id = ? AND device_id IN (${victims})`,
    ).bind(t, userId, evictionId),
    e.DB.prepare(
      `DELETE FROM device_exit_credentials
       WHERE user_id = ? AND device_id IN (
         SELECT devices.id FROM devices
         WHERE devices.id IN (${victims}) AND devices.status = 'revoked'
       )`,
    ).bind(userId, evictionId),
    e.DB.prepare(`${victims} ORDER BY device_id`).bind(evictionId),
    e.DB.prepare('DELETE FROM device_rotation_victims WHERE rotation_id = ?').bind(evictionId),
  ]);
  return {
    limitWriteChanges: Number(results[1]?.meta.changes ?? 0),
    evicted: (results[6]?.results ?? []).map((row) => String(row.device_id)),
  };
}

export async function directSignupAllowed(e: Env, emailAddr: string): Promise<boolean> {
  const managed = await e.DB.prepare(
    'SELECT 1 FROM signup_allowlist WHERE email = ?',
  ).bind(emailAddr).first<Row>();
  if (managed) return true;

  // Keep the configuration allowlist as a backwards-compatible bootstrap
  // path. New individual users should be managed through the authenticated
  // admin API so granting access does not require a Worker redeployment.
  const configured = e.DIRECT_SIGNUP_ALLOWLIST;
  if (typeof configured !== 'string' || configured.length > 4096) return false;
  const entries = configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0 || entries.length > 100) return false;
  return entries.some((entry) => (
    entry.startsWith('@')
      ? emailAddr.endsWith(entry) && emailAddr.length > entry.length
      : emailAddr === entry
  ));
}

async function ensureEmailIdentity(e: Env, user: Row, emailAddr: string, t = now()) {
  await e.DB.prepare(
    `INSERT INTO auth_identities(
       provider, subject, user_id, email, email_verified_at, created_at, updated_at
     ) VALUES('email', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, subject) DO UPDATE SET
       email = excluded.email,
       email_verified_at = excluded.email_verified_at,
       updated_at = excluded.updated_at
     WHERE auth_identities.user_id = excluded.user_id`,
  ).bind(emailAddr, user.id, emailAddr, t, t, t).run();
  const identity = await e.DB.prepare(
    "SELECT user_id FROM auth_identities WHERE provider = 'email' AND subject = ?",
  ).bind(emailAddr).first<Row>();
  if (!identity || identity.user_id !== user.id) {
    throw new ApiError(409, 'IDENTITY_CONFLICT', 'This sign-in identity is already linked');
  }
}

export async function accountForVerifiedEmail(
  e: Env,
  emailAddr: string,
): Promise<Row> {
  let user = await e.DB.prepare('SELECT * FROM users WHERE email = ?').bind(emailAddr).first<Row>();
  if (user) {
    if (ineligible(user)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
    await ensureEmailIdentity(e, user, emailAddr);
    return user;
  }

  if (!(await directSignupAllowed(e, emailAddr))) {
    throw new ApiError(401, 'AUTHENTICATION_FAILED', 'Authentication could not be completed');
  }
  const t = now();
  const userId = id();
  let creationError: unknown;
  try {
    // The verified email or OIDC claim is the account-creation authority.
    // INSERT OR IGNORE makes concurrent first sign-ins converge on the same
    // unique email without requiring an invitation/redemption transaction.
    await insertUserCarryingAllowlistProfile(e, userId, emailAddr, t);
  } catch (error) {
    // Resolve a concurrent first sign-in below. D1 uniqueness constraints
    // ensure that only the account for this verified email can be selected.
    creationError = error;
  }
  user = await e.DB.prepare('SELECT * FROM users WHERE email = ?').bind(emailAddr).first<Row>();
  if (!user) {
    if (creationError) {
      throw new ApiError(
        503,
        'ACCOUNT_CREATION_UNAVAILABLE',
        'Account activation is temporarily unavailable',
      );
    }
    throw new ApiError(401, 'AUTHENTICATION_FAILED', 'Authentication could not be completed');
  }
  if (ineligible(user)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
  await ensureEmailIdentity(e, user, emailAddr, t);
  return user;
}

export async function accountForOidcIdentity(
  e: Env,
  identity: OidcIdentity,
): Promise<Row> {
  const linked = await e.DB.prepare(
    `SELECT users.*
     FROM auth_identities
     JOIN users ON users.id = auth_identities.user_id
     WHERE auth_identities.provider = ? AND auth_identities.subject = ?`,
  ).bind(identity.provider, identity.subject).first<Row>();
  if (linked) {
    if (ineligible(linked)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
    return linked;
  }
  if (!identity.email || !identity.emailVerified) {
    throw new ApiError(
      401,
      'VERIFIED_EMAIL_REQUIRED',
      'The identity provider did not return a verified email address',
    );
  }
  // A Google account backed by an unmanaged external mailbox still asserts
  // email_verified after that mailbox is reassigned, so its claim can neither
  // take over the account the current mailbox owner signed up with nor
  // pre-create the account that owner's email-code sign-in would land on
  // (#789, decision 072). Such users sign in with an email code.
  if (identity.provider === 'google' && !googleAuthoritativeForEmail(identity)) {
    throw new ApiError(
      401,
      'EMAIL_OWNERSHIP_UNVERIFIED',
      'Sign in with an email code; this provider cannot vouch for the mailbox',
    );
  }

  const user = await accountForVerifiedEmail(e, identity.email);
  const t = now();
  try {
    await e.DB.prepare(
      `INSERT INTO auth_identities(
         provider, subject, user_id, email, email_verified_at, created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      identity.provider,
      identity.subject,
      user.id,
      identity.email,
      t,
      t,
      t,
    ).run();
    return user;
  } catch {
    const raced = await e.DB.prepare(
      `SELECT users.*
       FROM auth_identities
       JOIN users ON users.id = auth_identities.user_id
       WHERE auth_identities.provider = ? AND auth_identities.subject = ?`,
    ).bind(identity.provider, identity.subject).first<Row>();
    if (!raced) {
      const existingProvider = await e.DB.prepare(
        `SELECT 1 FROM auth_identities
         WHERE provider = ? AND user_id = ?`,
      ).bind(identity.provider, user.id).first<Row>();
      if (existingProvider) {
        throw new ApiError(409, 'IDENTITY_CONFLICT', 'This sign-in identity is already linked');
      }
      throw new ApiError(
        503,
        'IDENTITY_LINK_UNAVAILABLE',
        'Identity linking is temporarily unavailable',
      );
    }
    if (ineligible(raced)) throw new ApiError(403, 'USER_DISABLED', 'User is disabled');
    return raced;
  }
}
