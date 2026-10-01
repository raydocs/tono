// Token-admin (`/api/v1/admin/*`, ADMIN_API_TOKEN) writes that change who may
// sign up or what a customer is entitled to. Each one leaves an ops_audit row
// with actor `token-admin`, like the Access console's equivalent writes.
import { randomToken, sha256 } from '../crypto';
import { ApiError } from '../errors';
import { type Env, type Row, now, id, tailscaleEnrollmentEnabled } from '../env';
import { rejectUnexpectedKeys, body, email } from '../request';
import { writeOpsAudit } from '../product-account';

const ACTOR = 'token-admin';

export async function tokenAdminWrite(
  req: Request,
  e: Env,
  p: string,
  m: string,
  deps: { enforceUser: (e: Env, userId: string) => Promise<unknown> },
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
  if (p === '/api/v1/admin/signup-allowlist' && m === 'DELETE') {
    const b = await body(req, 4 * 1024);
    const address = email(b.email);
    const deleted = await e.DB.prepare(
      'DELETE FROM signup_allowlist WHERE email = ?',
    ).bind(address).run();
    if (deleted.meta.changes) {
      await writeOpsAudit(e, ACTOR, 'allowlist.remove', 'signup_allowlist', address, address);
    }
    return new Response(null, { status: 204 });
  }
  if (p === '/api/v1/admin/invitations' && m === 'POST') {
    const b = await body(req, 16 * 1024);
    const code = randomToken(24);
    const t = now();
    const days = Number(b.expiresInDays ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expiresInDays');
    }
    const invitationId = id();
    const address = email(b.email);
    await e.DB.prepare(
      'INSERT INTO invitations(id, code_hash, email, expires_at, created_at) VALUES(?, ?, ?, ?, ?)',
    ).bind(invitationId, await sha256(code), address, t + days * 86400, t).run();
    // The invite code itself stays out of the audit log.
    await writeOpsAudit(e, ACTOR, 'invitation.create', 'invitation', invitationId, `invited ${address} for ${days}d`);
    return Response.json({ inviteCode: code, expiresAt: t + days * 86400 }, { status: 201 });
  }
  mt = p.match(/^\/api\/v1\/admin\/invitations\/([^/]+)$/);
  if (mt && m === 'DELETE') {
    const deleted = await e.DB.prepare('DELETE FROM invitations WHERE id = ? AND redeemed_at IS NULL').bind(mt[1]).run();
    if (deleted.meta.changes) {
      await writeOpsAudit(e, ACTOR, 'invitation.delete', 'invitation', mt[1], 'deleted');
    }
    return new Response(null, { status: 204 });
  }
  mt = p.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
  if (mt && m === 'PATCH') {
    const b = await body(req, 16 * 1024);
    // A misspelled field used to return 200 and change nothing. For an
    // endpoint whose job includes clearing a billing cycle so a locked-out
    // customer can connect again, a silent success is the worst possible
    // answer: the operator believes the account was reset, and only the
    // customer finds out otherwise.
    rejectUnexpectedKeys(b, ['status', 'quotaBytes', 'deviceLimit', 'expiresAt', 'resetUsage']);
    const status = b.status;
    const quota = b.quotaBytes;
    // Ending a cycle, not editing a number. The collector keeps a fleet-wide
    // cumulative total and re-sends it every ten minutes, so zeroing
    // `usage_bytes` on its own would be undone by the next report; moving the
    // baseline to the counter is what actually clears the cycle.
    const resetUsage = b.resetUsage;
    if (resetUsage !== undefined && resetUsage !== true) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'resetUsage may only be true');
    }
    const deviceLimit = b.deviceLimit;
    const expiresAt = b.expiresAt;
    if (status !== undefined && !['active', 'disabled'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    if (
      expiresAt !== undefined &&
      expiresAt !== null &&
      (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expiresAt');
    }
    if (quota !== undefined && quota !== null && (!Number.isSafeInteger(quota) || quota < 0)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid quotaBytes');
    }
    if (
      deviceLimit !== undefined &&
      (!Number.isSafeInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 25)
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid deviceLimit');
    }
    if (status === 'active') {
      const residual = await e.DB.prepare(
        `SELECT
           users.status current_status,
           (SELECT COUNT(*) FROM devices
            WHERE user_id = ? AND status IN ('active', 'pending')) live_devices,
           (SELECT COUNT(*) FROM revocation_jobs
            JOIN devices ON devices.id = revocation_jobs.device_id
            WHERE devices.user_id = ? AND revocation_jobs.completed_at IS NULL) pending_jobs
         FROM users WHERE users.id = ?`,
      ).bind(mt[1], mt[1], mt[1]).first<Row>();
      if (!residual) throw new ApiError(404, 'NOT_FOUND', 'User not found');
      if (
        residual.current_status !== 'active' &&
        ((residual.live_devices ?? 0) > 0 || (tailscaleEnrollmentEnabled(e) && (residual.pending_jobs ?? 0) > 0))
      ) {
        throw new ApiError(409, 'REVOCATION_PENDING', 'Wait for tailnet device revocation before re-enabling this user');
      }
    }
    const updated = await e.DB.prepare(
      `UPDATE users SET
         status = COALESCE(?, status),
         quota_bytes = CASE WHEN ? THEN ? ELSE quota_bytes END,
         device_limit = CASE WHEN ? THEN ? ELSE device_limit END,
         expires_at = CASE WHEN ? THEN ? ELSE expires_at END,
         usage_baseline_bytes = CASE WHEN ? THEN usage_reported_bytes ELSE usage_baseline_bytes END,
         usage_bytes = CASE WHEN ? THEN 0 ELSE usage_bytes END,
         updated_at = ?
       WHERE id = ?`,
    ).bind(
      status ?? null,
      quota !== undefined,
      quota ?? null,
      deviceLimit !== undefined,
      deviceLimit ?? null,
      expiresAt !== undefined,
      expiresAt ?? null,
      resetUsage === true,
      resetUsage === true,
      now(),
      mt[1],
    ).run();
    if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    if (resetUsage === true) {
      await writeOpsAudit(e, ACTOR, 'user.usage-reset', 'user', mt[1], 'billing cycle reset');
    }
    const changedFields = [
      status !== undefined ? 'status' : null,
      quota !== undefined ? 'quotaBytes' : null,
      deviceLimit !== undefined ? 'deviceLimit' : null,
      expiresAt !== undefined ? 'expiresAt' : null,
    ].filter((name): name is string => name !== null);
    if (changedFields.length) {
      await writeOpsAudit(e, ACTOR, 'user.update', 'user', mt[1], `changed ${changedFields.join(', ')}`);
    }
    await deps.enforceUser(e, mt[1]);
    return Response.json({ ok: true });
  }
  return null;
}
