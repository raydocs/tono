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

function emailOwnershipUnverified(): ApiError {
  return new ApiError(
    401,
    'EMAIL_OWNERSHIP_UNVERIFIED',
    'Sign in with an email code; this provider cannot vouch for the mailbox',
  );
}

export async function accountForVerifiedEmail(
  e: Env,
  emailAddr: string,
  // createOnly: the claim may only create the account for this address, never
  // select an existing one (checked again after the insert, so a concurrent
  // email-code sign-up cannot be linked either).
  { createOnly = false } = {},
): Promise<Row> {
  let user = await e.DB.prepare('SELECT * FROM users WHERE email = ?').bind(emailAddr).first<Row>();
  if (user) {
    if (createOnly) throw emailOwnershipUnverified();
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
  if (createOnly && user.id !== userId) throw emailOwnershipUnverified();
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
  // email_verified after that mailbox is reassigned, so its claim may create
  // an account but may not take over the one the current mailbox owner signed
  // up with (#789).
  const user = await accountForVerifiedEmail(e, identity.email, {
    createOnly: identity.provider === 'google' && !googleAuthoritativeForEmail(identity),
  });
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
