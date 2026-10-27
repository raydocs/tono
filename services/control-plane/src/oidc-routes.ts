// Apple and Google sign-in: nonce challenges, ID-token verification, and the
// link ticket that attaches a provider identity to an account only after the
// user also proves that account with an email code (decision 141).
import { hmacSha256, jwtSign, jwtVerify, randomToken, sha256 } from './crypto';
import { OidcVerificationError, type OidcIdentity, type OidcProvider, verifyOidcIdToken } from './oidc';
import { accountForOidcIdentity } from './accounts';
import { ApiError } from './errors';
import { type Env, type Row, str, envInt, requiredSecret, now, id } from './env';
import { body } from './request';
import {
  rateLimitOidcStart,
  rateLimitChallenge,
  challengeID,
  oidcProvider,
  providerAudiences,
  completePasswordlessAuth,
} from './login';

const LINK_TICKET_TTL_SECONDS = 600;

// A key of its own, so a link ticket can never pass as an access token.
const linkTicketKey = async (e: Env) => hmacSha256('tono-oidc-link-ticket-v1', requiredSecret(e.JWT_SECRET));

function configuredAudiences(e: Env, provider: OidcProvider): string[] {
  const audiences = providerAudiences(e, provider);
  if (audiences.length === 0) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'This identity provider is not configured');
  }
  return audiences;
}

export async function oidcRoute(
  e: Env,
  req: Request,
  p: string,
  m: string,
): Promise<Response | undefined> {
  if (p === '/api/v1/auth/oidc/challenge' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    const provider = oidcProvider(b.provider);
    const name = str(b.deviceName, 'deviceName', 1, 100);
    const inst = str(b.installationId, 'installationId', 8, 200);
    const audiences = configuredAudiences(e, provider);
    // Each platform signs in with its own client; one we do not know falls
    // back to the primary client rather than echoing the caller's value.
    const audience = typeof b.clientId === 'string' && audiences.includes(b.clientId)
      ? b.clientId
      : audiences[0];
    await rateLimitOidcStart(e, req, inst);
    const challenge = id();
    const nonce = randomToken(32);
    const t = now();
    const ttl = envInt(e, 'OIDC_CHALLENGE_TTL_SECONDS', 300);
    await e.DB.prepare(
      `INSERT INTO auth_challenges(
         id, kind, secret_hash, invitation_id, installation_id, device_name,
         attempts, max_attempts, expires_at, created_at
       ) VALUES(?, ?, ?, ?, ?, ?, 0, 3, ?, ?)`,
    ).bind(challenge, provider, await sha256(nonce), null, inst, name, t + ttl, t).run();
    return Response.json({ challengeId: challenge, nonce, expiresIn: ttl, audience });
  }

  if (p === '/api/v1/auth/oidc/verify' && m === 'POST') {
    const b = await body(req, 24 * 1024);
    const provider = oidcProvider(b.provider);
    const challenge = challengeID(b.challengeId);
    const idToken = str(b.idToken, 'idToken', 100, 16_384);
    const audiences = configuredAudiences(e, provider);
    await rateLimitChallenge(e, req, 'oidc-verify', challenge);
    const t = now();
    const reserved = await e.DB.prepare(
      `UPDATE auth_challenges
       SET attempts = attempts + 1
       WHERE id = ? AND kind = ? AND consumed_at IS NULL
         AND expires_at > ? AND attempts < max_attempts
       RETURNING *`,
    ).bind(challenge, provider, t).first<Row>();
    if (!reserved) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }

    let identity: OidcIdentity;
    try {
      identity = await verifyOidcIdToken(provider, idToken, audiences, t);
    } catch (verificationError) {
      if (verificationError instanceof OidcVerificationError && verificationError.temporary) {
        throw new ApiError(503, 'IDENTITY_PROVIDER_UNAVAILABLE', 'The identity provider is temporarily unavailable');
      }
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const nonceHash = await sha256(identity.nonce);
    if (nonceHash !== reserved.secret_hash) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    const consumed = await e.DB.prepare(
      `UPDATE auth_challenges
       SET consumed_at = ?
       WHERE id = ? AND kind = ? AND secret_hash = ?
         AND consumed_at IS NULL AND expires_at > ?`,
    ).bind(t, challenge, provider, nonceHash, t).run();
    if (!consumed.meta.changes) {
      throw new ApiError(401, 'OIDC_AUTHENTICATION_FAILED', 'Identity verification failed');
    }
    let user: Row;
    try {
      user = await accountForOidcIdentity(e, identity);
    } catch (refusal) {
      // The provider proved this person holds the provider account, but not
      // the mailbox. Hand back a ticket that an email-code sign-in on this
      // installation can redeem to link the two.
      if (refusal instanceof ApiError && refusal.code === 'EMAIL_OWNERSHIP_UNVERIFIED') {
        throw new ApiError(refusal.status, refusal.code, refusal.message, {
          linkTicket: await jwtSign({
            typ: 'oidc-link',
            provider,
            sub: identity.subject,
            // Only the account for the address the provider named can take
            // the link, so a ticket never attaches to an unrelated account.
            email: String(identity.email).toLowerCase(),
            inst: String(reserved.installation_id),
            exp: t + LINK_TICKET_TTL_SECONDS,
          }, await linkTicketKey(e)),
        });
      }
      throw refusal;
    }
    return Response.json(await completePasswordlessAuth(
      e, req, user, String(reserved.device_name), String(reserved.installation_id),
    ));
  }

  return undefined;
}

export type IdentityLinkResult = { provider: OidcProvider; status: 'linked' | 'conflict' } | { status: 'expired' };

/**
 * Redeems a link ticket after an email-code sign-in has proved `userId` on
 * `installationId` for the address the provider named. A provider account already linked elsewhere, or an account
 * that already has a different identity at this provider, is never moved or
 * replaced.
 */
export async function redeemLinkTicket(
  e: Env,
  ticket: unknown,
  userId: string,
  userEmail: string,
  installationId: string,
): Promise<IdentityLinkResult | undefined> {
  if (ticket === undefined || ticket === null) return undefined;
  const claims = typeof ticket === 'string' && ticket.length <= 2_048
    ? await jwtVerify(ticket, await linkTicketKey(e))
    : null;
  if (
    claims?.typ !== 'oidc-link' ||
    (claims.provider !== 'apple' && claims.provider !== 'google') ||
    typeof claims.sub !== 'string' || claims.sub.length === 0 ||
    claims.inst !== installationId ||
    claims.email !== userEmail.toLowerCase()
  ) {
    return { status: 'expired' };
  }
  const provider = claims.provider as OidcProvider;
  const t = now();
  const inserted = await e.DB.prepare(
    `INSERT OR IGNORE INTO auth_identities(
       provider, subject, user_id, email, email_verified_at, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
  ).bind(provider, claims.sub, userId, claims.email, t, t, t).run();
  if (inserted.meta.changes) return { provider, status: 'linked' };
  const owner = await e.DB.prepare(
    'SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?',
  ).bind(provider, claims.sub).first<Row>();
  return { provider, status: owner?.user_id === userId ? 'linked' : 'conflict' };
}
