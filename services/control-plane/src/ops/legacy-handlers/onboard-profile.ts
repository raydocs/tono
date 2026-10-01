import { ApiError } from '../../errors';
import { type Env, type Row, str } from '../../env';
import { PRODUCT_CLAUDE, accountRefField } from '../../product-account';

/**
 * The account_ref the onboard's Claude allocation would take, validated
 * before any write so its 409s can be checked first. accountRef wins over
 * productAccountId, as it does in the allocation.
 */
export async function onboardAllocationRef(e: Env, b: Record<string, unknown>): Promise<string | null> {
  let ref: string | null = null;
  if (b.accountRef !== undefined && b.accountRef !== null && b.accountRef !== '') {
    ref = accountRefField(b.accountRef);
  }
  if (b.productAccountId !== undefined && b.productAccountId !== null && b.productAccountId !== '') {
    const productAccountId = str(b.productAccountId, 'productAccountId', 1, 100);
    const pooled = await e.DB.prepare(
      'SELECT id, account_ref FROM product_accounts WHERE id = ?',
    ).bind(productAccountId).first<Row>();
    if (!pooled) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
    ref ??= String(pooled.account_ref);
  }
  return ref;
}

/**
 * Expiry and plan on `users/onboard`, with the same rules as PATCH
 * users/{id}. `plan` is the value to store when the key was sent.
 */
export function onboardEntitlement(b: Record<string, unknown>) {
  const expiresAt = b.expiresAt as number | null | undefined;
  if (
    expiresAt !== undefined &&
    expiresAt !== null &&
    (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expiresAt');
  }
  if (b.plan !== undefined && b.plan !== null && b.plan !== '' && b.plan !== PRODUCT_CLAUDE) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid plan');
  }
  const plan = b.plan === undefined || b.plan === null || b.plan === '' ? null : PRODUCT_CLAUDE;
  return { expiresAt, plan };
}

const PROFILE_SET = `wechat_id = CASE WHEN ? THEN ? ELSE wechat_id END,
     contact = CASE WHEN ? THEN ? ELSE contact END,
     notes = CASE WHEN ? THEN ? ELSE notes END,
     expires_at = CASE WHEN ? THEN ? ELSE expires_at END,
     plan = CASE WHEN ? THEN ? ELSE plan END`;

/**
 * The pending profile for an email with no account at lookup time: kept on
 * the allowlist row for first sign-in, and written onto an account with that
 * email if a first sign-in created one after the lookup. Batched with the
 * allowlist grant by the caller, so neither interleaving loses the expiry.
 * `profile` is (sent, value) pairs for wechat_id, contact, notes, expires_at
 * and plan, in that order.
 */
export function pendingProfileWrites(e: Env, address: string, profile: unknown[], t: number) {
  return [
    e.DB.prepare(`UPDATE signup_allowlist SET ${PROFILE_SET} WHERE email = ?`).bind(...profile, address),
    e.DB.prepare(`UPDATE users SET ${PROFILE_SET}, updated_at = ? WHERE email = ?`).bind(...profile, t, address),
  ];
}

/** The same `profile` pairs on an account that existed at lookup time. */
export function accountProfileWrite(e: Env, userId: string, profile: unknown[], t: number) {
  return e.DB.prepare(`UPDATE users SET ${PROFILE_SET}, updated_at = ? WHERE id = ?`).bind(...profile, t, userId);
}
