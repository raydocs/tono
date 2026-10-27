// Sign-in helpers: rate limits, email / OIDC challenge inputs, email code
// delivery and the token + device result of a completed sign-in. Moved
// verbatim from index.ts; this module never imports index.ts back.

import { hmacSha256, sha256 } from './crypto';
import { tokens } from './sessions';
import { type OidcProvider } from './oidc';
import { requireAccountEntitlement } from './accounts';
import { consumeRateLimit } from './ops/ingest-limits';
import { ApiError } from './errors';
import { recordClient } from './client-identity';
import { type Env, type Row, str, envInt, tailscaleEnrollmentEnabled, requiredSecret, publicSignupEnabled, now } from './env';
import { clientIp } from './auth';
import { API_RELAYS } from './api-relays';
import { publicDevice } from './ops/shared-admin';
import { publicUser } from './ops/reads';
import { ensureDevice } from './devices';
import { issueEnrollment } from './enrollment';

// TLS-pass-through relays cannot attach an authenticated forwarded client ID.
// Only Cloudflare's edge-owned source IP can identify an exact configured relay;
// never trust X-Forwarded-For, client IDs, an ASN, or an address supplied in JSON.
function fromApiRelay(req: Request): boolean {
  return API_RELAYS.some((relay) => relay.host === clientIp(req));
}

// Subject limits prevent credential guessing; this shared backstop bounds D1
// challenge/rate-limit writes through the public relay across all login kinds.
async function rateLimitRelayAuth(e: Env, req: Request, windowSeconds: number) {
  await consumeRateLimit(e, `rl:${await sha256(`relay-auth:ip:${clientIp(req)}`)}`,
    envInt(e, 'RATE_LIMIT_RELAY_AUTH_IP', 200), windowSeconds);
}

// --- Rate limiting (D1) -------------------------------------------------------

export async function rateLimitEmailStart(e: Env, req: Request, emailAddr: string) {
  const windowSeconds = envInt(e, 'RATE_LIMIT_WINDOW_SECONDS', 900);
  const ipLimit = envInt(e, 'RATE_LIMIT_EMAIL_START_IP', 20);
  const emailLimit = envInt(e, 'RATE_LIMIT_EMAIL_START_EMAIL', 5);
  const ip = clientIp(req);
  if (fromApiRelay(req)) {
    await rateLimitRelayAuth(e, req, windowSeconds);
  } else {
    await consumeRateLimit(e, `rl:${await sha256(`email-start:ip:${ip}`)}`, ipLimit, windowSeconds);
  }
  await consumeRateLimit(e, `rl:${await sha256(`email-start:email:${emailAddr}`)}`, emailLimit, windowSeconds);
}

export async function rateLimitChallenge(
  e: Env,
  req: Request,
  kind: 'email-verify' | 'oidc-verify',
  challengeId: string,
) {
  const windowSeconds = envInt(e, 'RATE_LIMIT_WINDOW_SECONDS', 900);
  const ipLimit = envInt(
    e,
    kind === 'email-verify' ? 'RATE_LIMIT_EMAIL_VERIFY_IP' : 'RATE_LIMIT_OIDC_VERIFY_IP',
    30,
  );
  const challengeLimit = envInt(
    e,
    kind === 'email-verify'
      ? 'RATE_LIMIT_EMAIL_VERIFY_CHALLENGE'
      : 'RATE_LIMIT_OIDC_VERIFY_CHALLENGE',
    5,
  );
  if (fromApiRelay(req)) {
    await rateLimitRelayAuth(e, req, windowSeconds);
  } else {
    await consumeRateLimit(
      e,
      `rl:${await sha256(`${kind}:ip:${clientIp(req)}`)}`,
      ipLimit,
      windowSeconds,
    );
  }
  await consumeRateLimit(
    e,
    `rl:${await sha256(`${kind}:challenge:${challengeId}`)}`,
    challengeLimit,
    windowSeconds,
  );
}

export async function rateLimitOidcStart(e: Env, req: Request, installationId: string) {
  const windowSeconds = envInt(e, 'RATE_LIMIT_WINDOW_SECONDS', 900);
  if (fromApiRelay(req)) {
    await rateLimitRelayAuth(e, req, windowSeconds);
  } else {
    await consumeRateLimit(
      e,
      `rl:${await sha256(`oidc-start:ip:${clientIp(req)}`)}`,
      envInt(e, 'RATE_LIMIT_OIDC_START_IP', 20),
      windowSeconds,
    );
  }
  await consumeRateLimit(
    e,
    `rl:${await sha256(`oidc-start:installation:${installationId}`)}`,
    envInt(e, 'RATE_LIMIT_OIDC_START_INSTALLATION', 10),
    windowSeconds,
  );
}

const PUBLIC_SIGNUP_BUDGET_SECONDS = 86_400;
const publicSignupBudgetKey = async () => `rl:${await sha256('public-signup:codes:day')}`;
// Set when the mail provider itself failed (not one recipient), cleared by the
// next delivery it accepts. Kept beside the rate-limit rows so retention ages it.
const EMAIL_DELIVERY_DOWN_KEY = 'state:email-delivery-unavailable';
const EMAIL_DELIVERY_DOWN_SECONDS = 900;

// Open registration mails strangers, so a global daily budget bounds what a
// spread of IPs and addresses can make the sender emit (decision 138). Past it
// the code is silently not sent: a 429 would tell the caller that the address
// has no account.
export async function publicSignupCodeAllowed(e: Env): Promise<boolean> {
  if (!publicSignupEnabled(e)) return false;
  try {
    await consumeRateLimit(e, await publicSignupBudgetKey(),
      envInt(e, 'PUBLIC_SIGNUP_CODES_PER_DAY', 200), PUBLIC_SIGNUP_BUDGET_SECONDS);
    return true;
  } catch (limited) {
    if (!(limited instanceof ApiError) || limited.status !== 429) throw limited;
    console.warn('public signup daily code budget exhausted');
    return false;
  }
}

/**
 * Global sign-in mail state for clients' copy, the same for every caller and
 * never about one address: `publicSignup` is the registration mode (false is
 * invite-only); `signupPaused` is open registration with today's new-address
 * budget spent, when only existing accounts and invitations get a code;
 * `deliveryDegraded` is a recent provider-side failure that no accepted
 * delivery has cleared since.
 */
export async function emailSignupStatus(e: Env) {
  const t = now();
  const budgetKey = await publicSignupBudgetKey();
  const rows = (await e.DB.prepare(
    'SELECT key, count, window_start FROM rate_limits WHERE key IN (?, ?)',
  ).bind(budgetKey, EMAIL_DELIVERY_DOWN_KEY).all<Row>()).results;
  const budget = rows.find((row) => row.key === budgetKey);
  const down = rows.find((row) => row.key === EMAIL_DELIVERY_DOWN_KEY);
  const open = publicSignupEnabled(e);
  return {
    publicSignup: open,
    signupPaused: open && !!budget &&
      Number(budget.window_start) > t - PUBLIC_SIGNUP_BUDGET_SECONDS &&
      Number(budget.count) >= envInt(e, 'PUBLIC_SIGNUP_CODES_PER_DAY', 200),
    deliveryDegraded: !!down && Number(down.window_start) > t - EMAIL_DELIVERY_DOWN_SECONDS,
  };
}

async function recordEmailDelivery(e: Env, providerAvailable: boolean) {
  // Best effort: the caller still has to retire an undelivered code.
  await (providerAvailable
    ? e.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(EMAIL_DELIVERY_DOWN_KEY)
    : e.DB.prepare(
      `INSERT INTO rate_limits(key, count, window_start) VALUES(?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1, window_start = excluded.window_start`,
    ).bind(EMAIL_DELIVERY_DOWN_KEY, now())
  ).run().catch((stateError: unknown) => {
    console.error('email delivery state update failed', String(stateError));
  });
}

// --- Passwordless authentication ---------------------------------------------

export function challengeID(value: unknown): string {
  const parsed = str(value, 'challengeId', 36, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid challengeId');
  }
  return parsed;
}

export function oidcProvider(value: unknown): OidcProvider {
  if (value !== 'apple' && value !== 'google') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid provider');
  }
  return value;
}

export function emailDeliveryConfigured(e: Env): boolean {
  return typeof e.RESEND_API_KEY === 'string' &&
    e.RESEND_API_KEY.length >= 20 &&
    typeof e.EMAIL_FROM === 'string' &&
    e.EMAIL_FROM.length >= 3 &&
    e.EMAIL_FROM.length <= 320 &&
    e.EMAIL_FROM.includes('@') &&
    !/[\r\n]/.test(e.EMAIL_FROM);
}

export function providerAudience(e: Env, provider: OidcProvider): string | undefined {
  const value = provider === 'apple' ? e.APPLE_CLIENT_ID : e.GOOGLE_CLIENT_ID;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 512 ? trimmed : undefined;
}

export function numericCode(): string {
  // Rejection sampling avoids modulo bias in the six-digit code.
  const range = 1_000_000;
  const maximum = 0x1_0000_0000 - (0x1_0000_0000 % range);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= maximum);
  return (value[0] % range).toString().padStart(6, '0');
}

export async function challengeSecret(e: Env, challenge: string, secret: string) {
  return hmacSha256(
    `auth-challenge\u0000${challenge}\u0000${secret}`,
    requiredSecret(e.JWT_SECRET),
  );
}

export async function deliverEmailCode(
  e: Env,
  recipient: string,
  code: string,
  challenge: string,
  ttlSeconds: number,
) {
  if (!emailDeliveryConfigured(e)) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        authorization: `Bearer ${e.RESEND_API_KEY}`,
        'content-type': 'application/json',
        'idempotency-key': challenge,
      },
      body: JSON.stringify({
        from: e.EMAIL_FROM,
        to: [recipient],
        subject: 'Your Tono sign-in code',
        text: `Your Tono sign-in code is ${code}. It expires in ${Math.ceil(ttlSeconds / 60)} minutes. If you did not request it, you can ignore this email.`,
      }),
    });
    await response.body?.cancel();
    // A 400/422 is about this recipient and must not turn into a global
    // signal anyone can read; auth, rate-limit and 5xx answers are the
    // provider's and say nothing about the address.
    const providerFailed = response.status === 401 || response.status === 403 ||
      response.status === 429 || response.status >= 500;
    if (response.ok || providerFailed) await recordEmailDelivery(e, response.ok);
    return response.ok;
  } catch (deliveryError) {
    console.error(
      'email delivery failed',
      deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
    );
    await recordEmailDelivery(e, false);
    return false;
  }
}

export async function completePasswordlessAuth(e: Env, req: Request, user: Row, deviceName: string, installationId: string) {
  requireAccountEntitlement(user);
  const device = await ensureDevice(e, user.id, deviceName, installationId);
  await recordClient(e, req, String(device.id));
  return authResult(e, user, device);
}

// --- Tokens / devices ---------------------------------------------------------

async function authResult(e: Env, u: Row, d: Row) {
  const enrollment =
    tailscaleEnrollmentEnabled(e) && d.status === 'pending'
      ? await issueEnrollment(e, d)
      : undefined;
  return {
    ...await tokens(e, u.id, d.id, d.installation_id),
    user: publicUser(u),
    device: publicDevice(d, d.id),
    enrollment,
  };
}
