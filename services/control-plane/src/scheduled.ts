// The five-minute cron (`scheduled` in index.ts): user enforcement, stale
// pending expiry, the revocation outbox, housekeeping retention, the ops cron
// and the API relay probe. Revocation helpers shared with request handlers stay
// in index.ts and arrive through `ScheduledDeps`, so this module never imports
// index.ts back.

import { type Env, type Row, now, id, envInt, tailscaleEnrollmentEnabled } from './env';
import { retainOperationsTimeseries } from './ops-timeseries';
import { snapshotUserUsageHours } from './ops-usage-hours';
import { runOpsCron } from './ops/cron';
import { probeApiRelays } from './api-relays';
import { cronStep, runHousekeepingRetention } from './retention';

export const ROUTING_RESEARCH_RETENTION_MAX_SECONDS = 90 * 24 * 60 * 60;

export type ScheduledDeps = {
  enforceUser: (e: Env, userId: string, processNow?: boolean) => Promise<void>;
  expirePending: (e: Env, user: string) => Promise<void>;
  processRevocations: (e: Env) => Promise<void>;
  tailscale: (e: Env, path: string) => Promise<Response>;
};

async function enqueueRevocation(
  e: Env,
  deviceId: string,
  managementId: string,
  ownershipGeneration = -1,
  reason = 'orphan_cleanup',
  t = now(),
) {
  await e.DB.prepare(
    `INSERT INTO revocation_jobs(
       id, device_id, tailscale_node_id, created_at, ownership_generation, reason
     ) VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(tailscale_node_id) DO UPDATE SET
       completed_at = NULL,
       last_error = NULL,
       last_attempt_at = 0,
       device_id = excluded.device_id,
       created_at = excluded.created_at,
       ownership_generation = excluded.ownership_generation,
       reason = excluded.reason`,
  ).bind(id(), deviceId, managementId, t, ownershipGeneration, reason).run();
}

/**
 * Pending nodes created with description `tono-device-{deviceId}` that no longer
 * have a live pending D1 row should be deleted via the durable outbox.
 */
async function cleanupOrphanPendingNodes(e: Env, tailscale: ScheduledDeps['tailscale']) {
  if (!tailscaleEnrollmentEnabled(e)) return;
  const r = await tailscale(e, `/tailnet/${encodeURIComponent(e.TAILSCALE_TAILNET)}/devices`);
  if (!r.ok) return;
  const data = await r.json() as Row;
  const inventory: Row[] = Array.isArray(data.devices) ? data.devices : [];
  const t = now();
  for (const td of inventory) {
    const tags: string[] = Array.isArray(td.tags) ? td.tags.map(String) : [];
    if (!tags.includes('tag:pending-tunnel-client')) continue;
    const desc = String(td.description ?? '');
    if (!desc.startsWith('tono-device-')) continue;
    const deviceId = desc.slice('tono-device-'.length);
    if (!deviceId || !td.id) continue;
    const d = await e.DB.prepare(
      'SELECT id, status, pending_expires_at, enrollment_hostname FROM devices WHERE id = ?',
    ).bind(deviceId).first<Row>();
    const inventoryLabels = [td.name, td.hostname, td.hostName, td.dnsName, td.DNSName]
      .filter((value) => typeof value === 'string')
      .map((value) => String(value).trim().toLowerCase().replace(/\.$/, '').split('.')[0]);
    const orphan =
      !d ||
      d.status === 'revoked' ||
      (d.status === 'pending' && (
        (d.pending_expires_at != null && d.pending_expires_at <= t) ||
        typeof d.enrollment_hostname !== 'string' ||
        !inventoryLabels.includes(d.enrollment_hostname)
      ));
    if (orphan) {
      await enqueueRevocation(e, deviceId, String(td.id), -1, 'orphan_pending_node', t);
    }
  }
}

// Users the cron enforces per tick. Each costs three queries plus one batch per
// live device, so this keeps one invocation far below D1's per-invocation query
// limit; users past the cap are picked up on the next tick.
const ENFORCE_USERS_PER_TICK = 25;

export async function enforceAll(e: Env, deps: ScheduledDeps) {
  const { enforceUser, expirePending, processRevocations, tailscale } = deps;
  const t = now();
  await cronStep('user enforcement scan', async () => {
    // Only ineligible users that still hold a live device or session. Users are
    // never deleted, so without this filter every user who ever expired or ran
    // out of quota was re-enforced (three queries each) every five minutes.
    const q = await e.DB.prepare(
      `SELECT id FROM users
       WHERE (status != 'active'
              OR (expires_at IS NOT NULL AND expires_at <= ?)
              OR (quota_bytes IS NOT NULL AND usage_bytes >= quota_bytes))
         AND (EXISTS (SELECT 1 FROM devices
                      WHERE devices.user_id = users.id AND devices.status IN ('active', 'pending'))
              OR EXISTS (SELECT 1 FROM sessions
                         WHERE sessions.user_id = users.id AND sessions.revoked_at IS NULL))
       LIMIT ?`,
    ).bind(t, ENFORCE_USERS_PER_TICK).all<Row>();
    for (const u of q.results) {
      try {
        await enforceUser(e, u.id, false);
      } catch (x) {
        console.error('user enforcement failed', u.id, x instanceof Error ? x.message : String(x));
      }
    }
  });
  // Also expire any globally-stale pending devices (revocation outbox when management id present)
  await cronStep('stale pending scan', async () => {
    const stale = await e.DB.prepare(
      "SELECT DISTINCT user_id FROM devices WHERE status = 'pending' AND pending_expires_at <= ?",
    ).bind(t).all<Row>();
    for (const row of stale.results) {
      try {
        await expirePending(e, row.user_id);
      } catch (x) {
        console.error('expirePending failed', row.user_id, x instanceof Error ? x.message : String(x));
      }
    }
  });
  // Revocation is enforcement, not housekeeping. Run it before retention so a
  // transient failure deleting old diagnostics or telemetry cannot leave an
  // ineligible user's tailnet identity live until the next cron tick.
  try {
    await cleanupOrphanPendingNodes(e, tailscale);
  } catch (x) {
    console.error('cleanupOrphanPendingNodes failed', x instanceof Error ? x.message : String(x));
  }
  try {
    await processRevocations(e);
  } catch (x) {
    // The durable outbox remains pending and the next scheduled run retries it.
    console.error('processRevocations failed', x instanceof Error ? x.message : String(x));
  }
  await runHousekeepingRetention(e, t);
  await cronStep('ops timeseries retention', () => retainOperationsTimeseries(e.DB, t));
  try {
    await snapshotUserUsageHours(e.DB, t);
  } catch (x) {
    console.error('user usage hour snapshot failed', x instanceof Error ? x.message : String(x));
  }
  try { await runOpsCron(e, t); } catch (x) { console.error('ops cron failed', x instanceof Error ? x.message : String(x)); }
  const routingResearchRetention = Math.min(
    envInt(
      e,
      'ROUTING_RESEARCH_RETENTION_SECONDS',
      ROUTING_RESEARCH_RETENTION_MAX_SECONDS,
    ),
    ROUTING_RESEARCH_RETENTION_MAX_SECONDS,
  );
  await cronStep('routing research retention', () =>
    e.DB.prepare('DELETE FROM routing_research_snapshots WHERE received_at <= ?')
      .bind(t - routingResearchRetention).run());
  await cronStep('api relay probe', () => probeApiRelays(e.DB, t)); // last: up to 5 s of wall time, after enforcement
}
