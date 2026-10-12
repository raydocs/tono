// Tailscale enrollment: issuing a pre-authorized key and the confirm state
// machine. Moved verbatim from index.ts; this module never imports
// index.ts back.

import { randomToken } from './crypto';
import { ApiError } from './errors';
import { type Env, type Row, now, id, str, envInt, tailscaleEnrollmentEnabled } from './env';
import { publicDevice } from './ops/shared-admin';
import { tailscale, type ResolvedTailscaleDevice, normalizedNodeKey, resolveFromInventory } from './tailscale';
import { processRevocations } from './devices';

/**
 * Clear only the exact failed claim generation. A durable guard job is written
 * before tag promotion, so this function never has to infer current ownership.
 */
async function compensateConfirmFailure(
  e: Env,
  deviceId: string,
  claimToken: string,
  claimGeneration: number,
) {
  const t = now();
  await e.DB.prepare(
    `UPDATE devices SET claim_token = NULL, claim_expires_at = NULL,
       tailscale_node_id = NULL, tailscale_stable_id = NULL,
       tailscale_api_node_id = NULL, tailscale_public_key = NULL,
       tailscale_ips = NULL, updated_at = ?
     WHERE id = ? AND status = 'pending' AND claim_token = ?
       AND claim_generation = ?`,
  ).bind(t, deviceId, claimToken, claimGeneration).run();
  try {
    await processRevocations(e);
  } catch (x) {
    console.error('compensation processRevocations failed', x instanceof Error ? x.message : String(x));
  }
}

async function clearClaim(e: Env, deviceId: string, claimToken: string, claimGeneration: number) {
  const t = now();
  await e.DB.prepare(
    `UPDATE devices SET claim_token = NULL, claim_expires_at = NULL, updated_at = ?
     WHERE id = ? AND claim_token = ? AND claim_generation = ?
       AND status = 'pending'`,
  ).bind(t, deviceId, claimToken, claimGeneration).run();
}

export async function issueEnrollment(e: Env, d: Row) {
  if (!tailscaleEnrollmentEnabled(e)) {
    throw new ApiError(410, 'TAILSCALE_DISABLED', 'Tailscale enrollment is temporarily disabled');
  }
  const t = now();
  if (d.claim_token && Number(d.claim_expires_at ?? 0) > t) {
    throw new ApiError(429, 'ENROLLMENT_COOLDOWN', 'Wait before requesting another enrollment key');
  }
  const unfinishedRevocation = await e.DB.prepare(
    `SELECT 1
     FROM revocation_jobs
     WHERE device_id = ? AND completed_at IS NULL
     LIMIT 1`,
  ).bind(d.id).first<Row>();
  if (unfinishedRevocation) {
    throw new ApiError(
      409,
      'REVOCATION_PENDING',
      'Wait for the prior tailnet identity to be revoked before enrolling again',
    );
  }
  if (d.enrollment_issued_at && t - d.enrollment_issued_at < 60) {
    throw new ApiError(429, 'ENROLLMENT_COOLDOWN', 'Wait before requesting another enrollment key');
  }
  const enrollmentHostname = `tono-${id().replaceAll('-', '')}`;
  const claim = await e.DB.prepare(
    `UPDATE devices SET enrollment_issued_at = ?, enrollment_hostname = ?, updated_at = ?
     WHERE id = ? AND status = 'pending' AND pending_expires_at > ?
       AND (claim_token IS NULL OR claim_expires_at <= ?)
       AND (enrollment_issued_at IS NULL OR enrollment_issued_at <= ?)
       AND NOT EXISTS (
         SELECT 1
         FROM revocation_jobs
         WHERE device_id = devices.id AND completed_at IS NULL
       )`,
  ).bind(t, enrollmentHostname, t, d.id, t, t, t - 60).run();
  if (!claim.meta.changes) {
    const racedRevocation = await e.DB.prepare(
      `SELECT 1
       FROM revocation_jobs
       WHERE device_id = ? AND completed_at IS NULL
       LIMIT 1`,
    ).bind(d.id).first<Row>();
    if (racedRevocation) {
      throw new ApiError(
        409,
        'REVOCATION_PENDING',
        'Wait for the prior tailnet identity to be revoked before enrolling again',
      );
    }
    throw new ApiError(429, 'ENROLLMENT_COOLDOWN', 'Wait before requesting another enrollment key');
  }
  try {
    const r = await tailscale(e, `/tailnet/${encodeURIComponent(e.TAILSCALE_TAILNET)}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          devices: {
            create: {
              reusable: false,
              ephemeral: true,
              preauthorized: true,
              tags: ['tag:pending-tunnel-client'],
            },
          },
        },
        expirySeconds: 600,
        description: `tono-device-${d.id}`,
      }),
    });
    const x = await r.json() as Row;
    const authKey = str(x.key, 'tailscaleAuthKey', 1, 1000);
    const expiresAt = str(x.expires, 'tailscaleKeyExpiry', 1, 100);
    return { id: d.id, authKey, hostname: enrollmentHostname, expiresAt, state: 'pending' };
  } catch (x) {
    // Release only this issuance lease. A transient Tailscale failure must not
    // make every subsequent authentication attempt fail with the local
    // 60-second cooldown.
    await e.DB.prepare(
      `UPDATE devices SET enrollment_issued_at = NULL, enrollment_hostname = NULL, updated_at = ?
       WHERE id = ? AND status = 'pending' AND enrollment_issued_at = ?
         AND enrollment_hostname = ?`,
    ).bind(now(), d.id, t, enrollmentHostname).run();
    throw x;
  }
}

// --- Confirm state machine ----------------------------------------------------

export async function confirmDevice(
  e: Env,
  a: { userId: string; deviceId?: string; installationId?: string },
  deviceRowId: string,
  b: Row,
) {
  if (!tailscaleEnrollmentEnabled(e)) {
    throw new ApiError(410, 'TAILSCALE_DISABLED', 'Tailscale enrollment is temporarily disabled');
  }
  const stableNodeId = str(b.stableNodeId, 'stableNodeId', 1, 200);
  const nodeId = b.nodeId !== undefined && b.nodeId !== null ? str(b.nodeId, 'nodeId', 1, 200) : undefined;
  const publicKey = str(b.publicKey, 'publicKey', 1, 500);
  const ips = b.tailscaleIPs;
  if (!Array.isArray(ips) || ips.length < 1 || ips.length > 10 || ips.some((x) => typeof x !== 'string' || x.length > 64)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid tailscaleIPs');
  }
  const ipsList = ips as string[];

  // 1) Atomic claim. Each successful claim advances a durable ownership
  // generation so stale requests and stale deletion jobs can be fenced.
  const claimToken = randomToken(16);
  const t = now();
  const claimTTL = envInt(e, 'CONFIRM_CLAIM_TTL_SECONDS', 300);
  const claim = await e.DB.prepare(
    `UPDATE devices SET
       claim_token = ?,
       claim_expires_at = ?,
       claim_generation = claim_generation + 1,
       tailscale_node_id = NULL,
       tailscale_stable_id = NULL,
       tailscale_api_node_id = NULL,
       tailscale_public_key = NULL,
       tailscale_ips = NULL,
       updated_at = ?
     WHERE id = ? AND user_id = ? AND installation_id = ?
       AND status = 'pending' AND pending_expires_at > ?
       AND (claim_token IS NULL OR claim_expires_at <= ?)`,
  ).bind(
    claimToken,
    t + claimTTL,
    t,
    deviceRowId,
    a.userId,
    a.installationId,
    t,
    t,
  ).run();
  if (!claim.meta.changes) {
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device is already being confirmed or is not pending');
  }
  const claimed = await e.DB.prepare(
    `SELECT claim_generation, enrollment_hostname FROM devices
     WHERE id = ? AND claim_token = ? AND status = 'pending'`,
  ).bind(deviceRowId, claimToken).first<Row>();
  if (
    !claimed ||
    typeof claimed.enrollment_hostname !== 'string' ||
    !/^tono-[a-f0-9]{32}$/.test(claimed.enrollment_hostname)
  ) {
    await clearClaim(e, deviceRowId, claimToken, Number(claimed?.claim_generation ?? -1));
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device claim was lost');
  }
  const claimGeneration = Number(claimed.claim_generation);

  // 2) Resolve management id from inventory (list, never GET by client id)
  let resolved: ResolvedTailscaleDevice;
  try {
    resolved = await resolveFromInventory(e, {
      stableNodeId,
      nodeId,
      publicKey,
      ips: ipsList,
      enrollmentHostname: claimed.enrollment_hostname,
    });
  } catch (err) {
    await clearClaim(e, deviceRowId, claimToken, claimGeneration);
    throw err;
  }

  // 3) Store identity columns under the claim (management id in tailscale_node_id)
  try {
    const storeAt = now();
    const store = await e.DB.prepare(
      `UPDATE devices SET
         tailscale_node_id = ?,
         tailscale_stable_id = ?,
         tailscale_api_node_id = ?,
         tailscale_public_key = ?,
         tailscale_ips = ?,
         updated_at = ?
       WHERE id = ? AND claim_token = ? AND claim_generation = ?
         AND status = 'pending' AND pending_expires_at > ?
         AND claim_expires_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM revocation_jobs
           WHERE tailscale_node_id = ? AND completed_at IS NULL
         )`,
    ).bind(
      resolved.managementId,
      stableNodeId,
      resolved.apiNodeId ?? nodeId ?? null,
      resolved.publicKey ?? normalizedNodeKey(publicKey) ?? null,
      JSON.stringify(ipsList),
      storeAt,
      deviceRowId,
      claimToken,
      claimGeneration,
      storeAt,
      storeAt,
      resolved.managementId,
    ).run();
    if (!store.meta.changes) {
      await clearClaim(e, deviceRowId, claimToken, claimGeneration);
      throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device state changed during confirm');
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Unique constraint: another device already owns this management or stable id
    await clearClaim(e, deviceRowId, claimToken, claimGeneration);
    throw new ApiError(409, 'NODE_ALREADY_CLAIMED', 'Tailscale node is already bound to another device');
  }

  // 4) Persist a deletion guard BEFORE the irreversible external promotion.
  // The guard is completed atomically with D1 activation. If activation throws,
  // cron still owns a durable cleanup record.
  const guardAt = now();
  const [renewed, guard] = await e.DB.batch([
    e.DB.prepare(
      `UPDATE devices SET claim_expires_at = ?, updated_at = ?
       WHERE id = ? AND claim_token = ? AND claim_generation = ?
         AND status = 'pending' AND pending_expires_at > ?
         AND claim_expires_at > ? AND tailscale_node_id = ?`,
    ).bind(
      guardAt + claimTTL,
      guardAt,
      deviceRowId,
      claimToken,
      claimGeneration,
      guardAt,
      guardAt,
      resolved.managementId,
    ),
    e.DB.prepare(
      `INSERT INTO revocation_jobs(
         id, device_id, tailscale_node_id, created_at, ownership_generation, reason
       )
       SELECT ?, id, tailscale_node_id, ?, claim_generation, 'confirm_guard'
       FROM devices
       WHERE id = ? AND claim_token = ? AND claim_generation = ?
         AND status = 'pending' AND pending_expires_at > ?
         AND claim_expires_at > ? AND tailscale_node_id = ?
       ON CONFLICT(tailscale_node_id) DO UPDATE SET
         completed_at = NULL,
         last_error = NULL,
         last_attempt_at = 0,
         device_id = excluded.device_id,
         created_at = excluded.created_at,
         ownership_generation = excluded.ownership_generation,
         reason = excluded.reason`,
    ).bind(
      id(),
      guardAt,
      deviceRowId,
      claimToken,
      claimGeneration,
      guardAt,
      guardAt,
      resolved.managementId,
    ),
  ]);
  if (!renewed.meta.changes || !guard.meta.changes) {
    await compensateConfirmFailure(e, deviceRowId, claimToken, claimGeneration);
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device claim expired before promotion');
  }

  // 5) Promote tags using the server-authoritative management id only.
  try {
    const tagRes = await tailscale(e, `/device/${encodeURIComponent(resolved.managementId)}/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['tag:tunnel-client'] }),
    });
    await tagRes.body?.cancel();
    if (!tagRes.ok) throw new ApiError(502, 'TAILSCALE_ERROR', 'Failed to promote Tailscale device tags');
  } catch (err) {
    await compensateConfirmFailure(e, deviceRowId, claimToken, claimGeneration);
    throw err instanceof ApiError ? err : new ApiError(502, 'TAILSCALE_ERROR', 'Failed to promote Tailscale device tags');
  }

  // 6) Activate and retire the guard in one D1 transaction. Both pending and
  // claim leases are checked again after the external API call.
  let activate: D1Result;
  try {
    const activatedAt = now();
    [activate] = await e.DB.batch([
      e.DB.prepare(
        `UPDATE devices SET
           status = 'active',
           pending_expires_at = NULL,
           confirmed_at = ?,
           last_seen_at = ?,
           claim_token = NULL,
           claim_expires_at = NULL,
           updated_at = ?
         WHERE id = ? AND claim_token = ? AND claim_generation = ?
           AND status = 'pending' AND pending_expires_at > ?
           AND claim_expires_at > ? AND tailscale_node_id = ?`,
      ).bind(
        activatedAt,
        activatedAt,
        activatedAt,
        deviceRowId,
        claimToken,
        claimGeneration,
        activatedAt,
        activatedAt,
        resolved.managementId,
      ),
      e.DB.prepare(
        `UPDATE revocation_jobs SET completed_at = ?, last_error = NULL
         WHERE tailscale_node_id = ? AND device_id = ?
           AND ownership_generation = ? AND completed_at IS NULL
           AND EXISTS (
             SELECT 1 FROM devices
             WHERE id = ? AND status = 'active' AND claim_generation = ?
               AND tailscale_node_id = ?
           )`,
      ).bind(
        activatedAt,
        resolved.managementId,
        deviceRowId,
        claimGeneration,
        deviceRowId,
        claimGeneration,
        resolved.managementId,
      ),
    ]);
  } catch {
    // The pre-promotion guard remains durable even if D1 is temporarily
    // unavailable here.
    try {
      await compensateConfirmFailure(e, deviceRowId, claimToken, claimGeneration);
    } catch {
      // Scheduled processing will retry the already-persisted guard.
    }
    throw new ApiError(503, 'CONFIRM_ACTIVATION_FAILED', 'Device activation could not be committed');
  }

  if (!activate.meta.changes) {
    await compensateConfirmFailure(e, deviceRowId, claimToken, claimGeneration);
    throw new ApiError(409, 'DEVICE_STATE_CHANGED', 'Device state changed');
  }

  const d = (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(deviceRowId).first<Row>())!;
  return publicDevice(d, a.deviceId);
}
