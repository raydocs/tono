// Device lifecycle shared by request handlers and the cron: pending
// expiry, device creation on sign-in, revocation, the revocation outbox and
// per-user enforcement. Moved verbatim from index.ts; this module never
// imports index.ts back.

import { DEVICE_LRU_ORDER, ineligible } from './accounts';
import { ApiError } from './errors';
import { type Env, type Row, now, id, envInt, tailscaleEnrollmentEnabled } from './env';
import { tailscaleToken, tailscale } from './tailscale';

/**
 * Expire pending devices for a user. When a management id is already stored
 * (e.g. mid-confirm claim), enqueue durable Tailscale deletion.
 */
export async function expirePending(e: Env, user: string) {
  const t = now();
  const q = await e.DB.prepare(
    `SELECT id, tailscale_node_id, claim_generation
     FROM devices
     WHERE user_id = ? AND status = 'pending' AND pending_expires_at <= ?`,
  ).bind(user, t).all<Row>();
  for (const d of q.results) {
    const statements: D1PreparedStatement[] = [];
    if (d.tailscale_node_id) {
      statements.push(
        e.DB.prepare(
          `INSERT INTO revocation_jobs(
             id, device_id, tailscale_node_id, created_at, ownership_generation, reason
           )
           SELECT ?, id, tailscale_node_id, ?, claim_generation, 'pending_expired'
           FROM devices
           WHERE id = ? AND user_id = ? AND status = 'pending'
             AND pending_expires_at <= ? AND claim_generation = ?
             AND tailscale_node_id IS NOT NULL
           ON CONFLICT(tailscale_node_id) DO UPDATE SET
             completed_at = NULL,
             last_error = NULL,
             last_attempt_at = 0,
             device_id = excluded.device_id,
             created_at = excluded.created_at,
             ownership_generation = excluded.ownership_generation,
             reason = excluded.reason`,
        ).bind(id(), t, d.id, user, t, d.claim_generation),
      );
    }
    statements.push(
      e.DB.prepare(
        `UPDATE devices SET
           status = 'revoked',
           claim_token = NULL,
           claim_expires_at = NULL,
           updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'pending'
           AND pending_expires_at <= ? AND claim_generation = ?`,
      ).bind(t, d.id, user, t, d.claim_generation),
      e.DB.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE device_id = ? AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM devices
             WHERE id = ? AND status = 'revoked' AND claim_generation = ?
           )`,
      ).bind(t, d.id, d.id, d.claim_generation),
      e.DB.prepare(
        `DELETE FROM device_exit_credentials
         WHERE device_id = ?
           AND EXISTS (
             SELECT 1 FROM devices
             WHERE id = ? AND status = 'revoked' AND claim_generation = ?
           )`,
      ).bind(d.id, d.id, d.claim_generation),
    );
    await e.DB.batch(statements);
  }
}

export async function ensureDevice(e: Env, user: string, name: string, installation: string) {
  await expirePending(e, user);
  let d = await e.DB.prepare('SELECT * FROM devices WHERE user_id = ? AND installation_id = ?').bind(user, installation).first<Row>();
  const enrollmentEnabled = tailscaleEnrollmentEnabled(e);
  const pendingTTL = envInt(e, 'PENDING_DEVICE_TTL_SECONDS', 1_800);
  let did = d?.id || id();

  for (let attempt = 0; attempt < 4; attempt++) {
    const tNow = now();

    if (d?.status === 'active') {
      const touched = await e.DB.prepare(
        `UPDATE devices SET name = ?, last_seen_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND installation_id = ? AND status = 'active'`,
      ).bind(name, tNow, tNow, d.id, user, installation).run();
      if (touched.meta.changes) {
        await e.DB.prepare(
          `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
           SELECT id, user_id, ?, ? FROM devices
           WHERE id = ? AND user_id = ? AND status = 'active'`,
        ).bind(crypto.randomUUID(), tNow, d.id, user).run();
        return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>())!;
      }
      d = await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>();
      continue;
    }

    if (d?.status === 'pending') {
      if (enrollmentEnabled) {
        await e.DB.prepare(
          `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
           SELECT id, user_id, ?, ? FROM devices
           WHERE id = ? AND user_id = ? AND status = 'pending'`,
        ).bind(crypto.randomUUID(), tNow, d.id, user).run();
        return d;
      }
      const activated = await e.DB.prepare(
        `UPDATE devices SET
           name = ?,
           status = 'active',
           pending_expires_at = NULL,
           claim_token = NULL,
           claim_expires_at = NULL,
           enrollment_issued_at = NULL,
           enrollment_hostname = NULL,
           confirmed_at = ?,
           last_seen_at = ?,
           updated_at = ?
         WHERE id = ? AND user_id = ? AND installation_id = ? AND status = 'pending'`,
      ).bind(name, tNow, tNow, tNow, d.id, user, installation).run();
      if (activated.meta.changes) {
        await e.DB.prepare(
          `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
           SELECT id, user_id, ?, ? FROM devices
           WHERE id = ? AND user_id = ? AND status = 'active'`,
        ).bind(crypto.randomUUID(), tNow, d.id, user).run();
        return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>())!;
      }
      d = await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(d.id).first<Row>();
      continue;
    }

    // D1 batch statements are one SQLite transaction. Select the current LRU
    // victim(s), revoke them, occupy the slot and mint the replacement identity
    // inside that single boundary. A competing invocation either observes the
    // committed result or has its whole batch rolled back on UNIQUE/DEVICE_LIMIT;
    // it can no longer commit an eviction before discovering that another
    // request already inserted the same installation.
    const rotationId = id();
    const statements: D1PreparedStatement[] = [
      e.DB.prepare(
        `INSERT INTO device_rotation_victims(rotation_id, device_id)
         SELECT ?, candidate.id
         FROM devices candidate
         WHERE candidate.user_id = ?
           AND candidate.status IN ('pending', 'active')
           AND candidate.id != ?
         ORDER BY ${DEVICE_LRU_ORDER}
         LIMIT MAX(0,
           (SELECT COUNT(*) FROM devices live
            WHERE live.user_id = ? AND live.status IN ('pending', 'active') AND live.id != ?)
           - COALESCE((SELECT device_limit FROM users WHERE id = ?), 2) + 1
         )`,
      ).bind(rotationId, user, did, user, did, user),
      e.DB.prepare(
        `INSERT INTO revocation_jobs(
           id, device_id, tailscale_node_id, created_at, ownership_generation, reason
         )
         SELECT ? || ':' || devices.id,
                devices.id, devices.tailscale_node_id, ?, devices.claim_generation,
                'device_rotated'
         FROM devices
         JOIN device_rotation_victims victims ON victims.device_id = devices.id
         WHERE victims.rotation_id = ? AND devices.tailscale_node_id IS NOT NULL
         ON CONFLICT(tailscale_node_id) DO UPDATE SET
           completed_at = NULL,
           last_error = NULL,
           last_attempt_at = 0,
           device_id = excluded.device_id,
           created_at = excluded.created_at,
           ownership_generation = excluded.ownership_generation,
           reason = excluded.reason`,
      ).bind(rotationId, tNow, rotationId),
      e.DB.prepare(
        `UPDATE devices SET
           status = 'revoked',
           claim_token = NULL,
           claim_expires_at = NULL,
           updated_at = ?
         WHERE id IN (
           SELECT device_id FROM device_rotation_victims WHERE rotation_id = ?
         ) AND status IN ('pending', 'active')`,
      ).bind(tNow, rotationId),
      e.DB.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE revoked_at IS NULL AND device_id IN (
           SELECT device_id FROM device_rotation_victims WHERE rotation_id = ?
         )`,
      ).bind(tNow, rotationId),
      e.DB.prepare(
        `DELETE FROM device_exit_credentials
         WHERE device_id IN (
           SELECT victims.device_id
           FROM device_rotation_victims victims
           JOIN devices ON devices.id = victims.device_id
           WHERE victims.rotation_id = ? AND devices.status = 'revoked'
         )`,
      ).bind(rotationId),
    ];

    if (d) {
      statements.push(enrollmentEnabled
        ? e.DB.prepare(
          `UPDATE devices SET
             name = ?,
             status = 'pending',
             pending_expires_at = ?,
             updated_at = ?,
             tailscale_node_id = NULL,
             tailscale_stable_id = NULL,
             tailscale_api_node_id = NULL,
             tailscale_public_key = NULL,
             tailscale_ips = NULL,
             claim_token = NULL,
             claim_expires_at = NULL,
             claim_generation = claim_generation + 1,
             enrollment_issued_at = NULL,
             enrollment_hostname = NULL,
             confirmed_at = NULL
           WHERE id = ? AND user_id = ? AND installation_id = ? AND status = 'revoked'`,
        ).bind(name, tNow + pendingTTL, tNow, did, user, installation)
        : e.DB.prepare(
          `UPDATE devices SET
             name = ?,
             status = 'active',
             pending_expires_at = NULL,
             updated_at = ?,
             tailscale_node_id = NULL,
             tailscale_stable_id = NULL,
             tailscale_api_node_id = NULL,
             tailscale_public_key = NULL,
             tailscale_ips = NULL,
             claim_token = NULL,
             claim_expires_at = NULL,
             claim_generation = claim_generation + 1,
             enrollment_issued_at = NULL,
             enrollment_hostname = NULL,
             confirmed_at = ?,
             last_seen_at = ?
           WHERE id = ? AND user_id = ? AND installation_id = ? AND status = 'revoked'`,
        ).bind(name, tNow, tNow, tNow, did, user, installation));
    } else {
      statements.push(enrollmentEnabled
        ? e.DB.prepare(
          `INSERT INTO devices(
             id, user_id, installation_id, name, status,
             pending_expires_at, created_at, updated_at
           ) VALUES(?, ?, ?, ?, 'pending', ?, ?, ?)`,
        ).bind(did, user, installation, name, tNow + pendingTTL, tNow, tNow)
        : e.DB.prepare(
          `INSERT INTO devices(
             id, user_id, installation_id, name, status,
             pending_expires_at, confirmed_at, last_seen_at, created_at, updated_at
           ) VALUES(?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`,
        ).bind(did, user, installation, name, tNow, tNow, tNow, tNow));
    }
    statements.push(
      e.DB.prepare(
        `INSERT INTO device_rotation_guards(rotation_id, valid)
         VALUES(?, CASE WHEN EXISTS(
           SELECT 1 FROM devices
           WHERE id = ? AND user_id = ? AND installation_id = ?
             AND status IN ('pending', 'active')
         ) THEN 1 ELSE 0 END)`,
      ).bind(rotationId, did, user, installation),
      e.DB.prepare(
        `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
         SELECT id, user_id, ?, ? FROM devices
         WHERE id = ? AND user_id = ? AND status IN ('pending', 'active')`,
      ).bind(crypto.randomUUID(), tNow, did, user),
      e.DB.prepare('DELETE FROM device_rotation_guards WHERE rotation_id = ?').bind(rotationId),
      e.DB.prepare('DELETE FROM device_rotation_victims WHERE rotation_id = ?').bind(rotationId),
    );

    try {
      await e.DB.batch(statements);
      return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(did).first<Row>())!;
    } catch (x) {
      if (String(x).includes('UNIQUE constraint failed: devices.user_id, devices.installation_id')) {
        const existing = await e.DB.prepare('SELECT * FROM devices WHERE user_id = ? AND installation_id = ?')
          .bind(user, installation).first<Row>();
        if (existing && ['pending', 'active'].includes(String(existing.status))) {
          const updated = await e.DB.prepare(
            `UPDATE devices SET name = ?, last_seen_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('pending', 'active')`,
          ).bind(name, tNow, tNow, existing.id).run();
          if (updated.meta.changes) {
            return (await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(existing.id).first<Row>())!;
          }
        } else if (existing) {
          d = existing;
          did = String(existing.id);
          continue;
        }
      }
      if (
        String(x).includes('DEVICE_LIMIT') ||
        String(x).includes('device_rotation_guards.valid')
      ) {
        d = await e.DB.prepare('SELECT * FROM devices WHERE user_id = ? AND installation_id = ?')
          .bind(user, installation).first<Row>();
        if (d) did = String(d.id);
        if (attempt < 3) continue;
        throw new ApiError(409, 'DEVICE_LIMIT', 'Concurrent device rotation did not settle');
      }
      throw x;
    }
  }
  throw new ApiError(409, 'DEVICE_LIMIT', 'This account has reached its device allowance');
}

export async function revokeDevice(e: Env, d: Row, requireIneligibleUser = false) {
  const t = now();
  const requireFlag = requireIneligibleUser ? 1 : 0;
  await e.DB.batch([
    // Resolve claim_generation inside this transaction. Reading it before the
    // batch creates a race where a concurrent confirm can advance generation
    // and make a successful-looking revoke update zero rows.
    e.DB.prepare(
      `INSERT INTO revocation_jobs(
         id, device_id, tailscale_node_id, created_at, ownership_generation, reason
       )
       SELECT ?, id, tailscale_node_id, ?, claim_generation, 'device_revoked'
       FROM devices
       WHERE id = ? AND status IN ('active', 'pending')
         AND tailscale_node_id IS NOT NULL
         AND (
           ? = 0 OR EXISTS (
             SELECT 1 FROM users
             WHERE users.id = devices.user_id
               AND (
                 users.status != 'active'
                 OR (users.expires_at IS NOT NULL AND users.expires_at <= ?)
                 OR (users.quota_bytes IS NOT NULL AND users.usage_bytes >= users.quota_bytes)
               )
           )
         )
       ON CONFLICT(tailscale_node_id) DO UPDATE SET
         completed_at = NULL,
         last_error = NULL,
         last_attempt_at = 0,
         device_id = excluded.device_id,
         created_at = excluded.created_at,
         ownership_generation = excluded.ownership_generation,
         reason = excluded.reason`,
    ).bind(id(), t, d.id, requireFlag, t),
    e.DB.prepare(
      `UPDATE devices SET
         status = 'revoked',
         claim_token = NULL,
         claim_expires_at = NULL,
         updated_at = ?
       WHERE id = ? AND status IN ('active', 'pending')
         AND (
           ? = 0 OR EXISTS (
             SELECT 1 FROM users
             WHERE users.id = devices.user_id
               AND (
                 users.status != 'active'
                 OR (users.expires_at IS NOT NULL AND users.expires_at <= ?)
                 OR (users.quota_bytes IS NOT NULL AND users.usage_bytes >= users.quota_bytes)
               )
             )
           )`,
    ).bind(t, d.id, requireFlag, t),
    e.DB.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE device_id = ? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM devices
           WHERE devices.id = ? AND devices.status = 'revoked'
         )`,
    ).bind(t, d.id, d.id),
    e.DB.prepare(
      `DELETE FROM device_exit_credentials
       WHERE device_id = ?
         AND EXISTS (
           SELECT 1 FROM devices
           WHERE devices.id = ? AND devices.status = 'revoked'
         )`,
    ).bind(d.id, d.id),
  ]);
}

export async function processRevocations(e: Env) {
  // Deleting a revoked identity's tailnet node is enforcement: it runs while
  // enrollment is paused too, which only fences new enrollment (H17-G-F2).
  const jobs = await e.DB.prepare(
    `SELECT * FROM revocation_jobs WHERE completed_at IS NULL
     ORDER BY last_attempt_at, created_at, id LIMIT 40`,
  ).all<Row>();
  let oauthToken: string | undefined;
  for (const job of jobs.results) {
    try {
      const jobGeneration = Number(job.ownership_generation ?? -1);
      const t = now();
      // Rotate failed and claim-deferred jobs behind less recently attempted
      // work, without dropping the durable retry or growing the batch limit.
      await e.DB.prepare(
        'UPDATE revocation_jobs SET last_attempt_at = ? WHERE id = ? AND completed_at IS NULL',
      ).bind(t, job.id).run();

      // An active D1 owner is authoritative. This also retires a stale guard job
      // left behind after a successful activation acknowledgement failed.
      const owner = await e.DB.prepare(
        `SELECT id, status, claim_token, claim_expires_at, claim_generation
         FROM devices
         WHERE tailscale_node_id = ? AND status IN ('active', 'pending')
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END
         LIMIT 1`,
      ).bind(job.tailscale_node_id).first<Row>();
      if (owner?.status === 'active') {
        await e.DB.prepare(
          `UPDATE revocation_jobs SET completed_at = ?, last_error = ?
           WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
        ).bind(t, 'skipped: node has a live active owner', job.id, job.device_id, jobGeneration).run();
        continue;
      }
      if (owner?.status === 'pending' && owner.claim_token && Number(owner.claim_expires_at ?? 0) > t) {
        await e.DB.prepare(
          `UPDATE revocation_jobs SET last_error = ?
           WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
        ).bind('deferred: node has a live confirm claim', job.id, job.device_id, jobGeneration).run();
        continue;
      }

      // A newer claim for the same installation may not have stored its
      // management id yet. Defer until it either binds/activates or expires.
      const newerClaim = await e.DB.prepare(
        `SELECT id FROM devices
         WHERE id = ? AND status = 'pending' AND claim_generation > ?
           AND claim_token IS NOT NULL AND claim_expires_at > ?`,
      ).bind(job.device_id, jobGeneration, t).first<Row>();
      if (newerClaim) {
        await e.DB.prepare(
          `UPDATE revocation_jobs SET last_error = ?
           WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
        ).bind('deferred: device has a newer confirm claim', job.id, job.device_id, jobGeneration).run();
        continue;
      }

      oauthToken ??= await tailscaleToken(e);
      const deletion = await tailscale(
        e,
        `/device/${encodeURIComponent(job.tailscale_node_id)}`,
        { method: 'DELETE' },
        true,
        oauthToken,
      );
      await deletion.body?.cancel();
      await e.DB.prepare(
        `UPDATE revocation_jobs SET completed_at = ?, last_error = NULL
         WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
      ).bind(now(), job.id, job.device_id, jobGeneration).run();
    } catch (x) {
      await e.DB.prepare(
        `UPDATE revocation_jobs SET last_error = ?
         WHERE id = ? AND device_id = ? AND ownership_generation = ?`,
      ).bind(
        String(x instanceof Error ? x.message : x).slice(0, 500),
        job.id,
        job.device_id,
        Number(job.ownership_generation ?? -1),
      ).run();
    }
  }
}

export async function enforceUser(e: Env, userId: string, processNow = true) {
  const u = await e.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<Row>();
  if (!u || !ineligible(u)) return;
  const ds = await e.DB.prepare("SELECT * FROM devices WHERE user_id = ? AND status IN ('active', 'pending')").bind(userId).all<Row>();
  for (const d of ds.results) await revokeDevice(e, d, true);
  const t = now();
  await e.DB.prepare(
    `UPDATE sessions SET revoked_at = ?
     WHERE user_id = ? AND revoked_at IS NULL
       AND EXISTS (
         SELECT 1 FROM users
         WHERE users.id = ?
           AND (
             users.status != 'active'
             OR (users.expires_at IS NOT NULL AND users.expires_at <= ?)
             OR (users.quota_bytes IS NOT NULL AND users.usage_bytes >= users.quota_bytes)
           )
       )`,
  ).bind(t, userId, userId, t).run();
  if (processNow) await processRevocations(e);
}
