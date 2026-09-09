import {
  encryptCatalog,
  encryptTrafficPolicy,
  randomToken,
  sha256,
  TRAFFIC_POLICY_SIGNATURE_CONTEXT,
  verifyTrafficPolicySignature,
} from '../crypto';
import { queryHomeProbeHistory } from '../ops-timeseries';
import { ApiError } from '../errors';
import {
  CLIENT_UUID_PLACEHOLDER,
  managedCatalogYAML,
} from '../catalog-yaml';
import {
  type Env,
  type Row,
  now,
  id,
  str,
  requiredCatalogKey,
} from '../env';
import {
  bumpCatalogRevision,
  enqueueRefreshCatalogForUser,
  publicManagedCatalog,
} from '../catalog';
import {
  optionalIpv4,
  proxyNameField,
  defaultProxyNameField,
  socks5HostField,
  socks5PortField,
  validateHomeSocks5,
  publicHomeExit,
  publicHomeBinding,
  parseHomeLine,
  loadHomeBinding,
  findSocks5Home,
  insertSocks5HomeExit,
  upsertHomeBinding,
} from '../home';
import {
  PRODUCT_CLAUDE,
  accountRefField,
  optionalNotes,
  httpsUrlField,
  optionalUnix,
  optionalByteCount,
  optionalMoney,
  optionalCurrency,
  optionalBillingCycle,
  publicProductAccount,
  publicProductEvent,
  publicNodeProfile,
  opsAuditStatement,
  writeOpsAudit,
  recordProductEvent,
  assignedProductForUser,
  createAssignedProductAccount,
  banProductAccount,
  replaceProductAccount,
} from '../product-account';
import {
  canonicalTrafficPolicy,
  publicTrafficPolicy,
} from '../traffic-policy';
import { rejectUnexpectedKeys, body, error, email } from '../request';
import { DIAGNOSTICS_LOG_ACCESS_MAX_SECONDS } from '../diagnostics-limits';

const deviceActions = ['diagnostic_snapshot', 'claude_traffic_snapshot', 'refresh_catalog', 'retry_protection'] as const;

function fixedAction(value: unknown) {
  if (typeof value !== 'string' || !deviceActions.includes(value as typeof deviceActions[number])) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown device action');
  }
  return value;
}

export function publicAction(row: Row) {
  return {
    id: row.id, userId: row.user_id, deviceId: row.device_id, action: row.action,
    status: row.status, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
    deliveredAt: row.delivered_at === null ? null : Number(row.delivered_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    result: row.result_json ? JSON.parse(row.result_json) : null,
  };
}

export const publicDevice = (d: Row, currentId?: string) => ({
  id: d.id,
  name: d.name,
  installationId: d.installation_id,
  current: d.id === currentId,
  status: d.status,
  pendingExpiresAt: d.pending_expires_at,
  tailscaleNodeId: d.tailscale_node_id,
  stableNodeId: d.tailscale_stable_id ?? undefined,
  tailscaleApiNodeId: d.tailscale_api_node_id ?? undefined,
  tailscaleIPs: d.tailscale_ips ? JSON.parse(d.tailscale_ips) : [],
  lastSeenAt: d.last_seen_at ?? undefined,
  confirmedAt: d.confirmed_at ?? undefined,
  createdAt: d.created_at,
});

export const USAGE_METERING_LEGACY_QUIET_SECONDS = 30 * 60;
export const USAGE_METERING_NODE_READY_SECONDS = 15 * 60;

export async function usageMeteringStatus(e: Env) {
  const timestamp = now();
  const [rollout, legacySources, namedSources, activeNodes, baselines] = await e.DB.batch([
    e.DB.prepare(
      `SELECT phase, legacy_last_seen_at, updated_at
       FROM usage_metering_rollout WHERE singleton_id = 1`,
    ),
    e.DB.prepare(
      `SELECT COUNT(*) AS source_rows,
              COUNT(DISTINCT user_id) AS users,
              COALESCE(SUM(accumulated_bytes), 0) AS accumulated_bytes,
              COALESCE(MAX(updated_at), 0) AS latest_update_at
       FROM usage_report_sources WHERE source_id = ''`,
    ),
    e.DB.prepare(
      `SELECT COUNT(*) AS source_rows,
              COUNT(DISTINCT user_id) AS users,
              COUNT(DISTINCT source_id) AS sources,
              SUM(CASE WHEN protocol_version = 2 THEN 1 ELSE 0 END) AS v2_rows,
              SUM(CASE WHEN protocol_version = 1 THEN 1 ELSE 0 END) AS v1_rows,
              COALESCE(SUM(accumulated_bytes), 0) AS accumulated_bytes,
              COALESCE(MAX(updated_at), 0) AS latest_update_at
       FROM usage_report_sources WHERE source_id != ''`,
    ),
    e.DB.prepare(
      `SELECT exit_nodes.id, exit_nodes.name,
              exit_nodes.metering_protocol_version,
              exit_nodes.metering_last_seen_at
       FROM exit_nodes
       WHERE exit_nodes.status = 'active'
       ORDER BY exit_nodes.name, exit_nodes.id`,
    ),
    e.DB.prepare('SELECT COUNT(*) AS count FROM usage_metering_cutover_baselines'),
  ]);
  const state = rollout.results[0] as Row | undefined;
  const legacy = legacySources.results[0] as Row | undefined;
  const named = namedSources.results[0] as Row | undefined;
  const nodes = activeNodes.results as Row[];
  const phase = state?.phase === 'v2_required' ? 'v2_required' : 'dual';
  const legacyLastSeenAt = Number(state?.legacy_last_seen_at ?? 0);
  const blockers: string[] = [];
  if (phase === 'dual') {
    // Silence is not a paired accounting boundary. Until the handoff protocol
    // exists, only installations with no legacy history may advance.
    if (legacyLastSeenAt > 0 || Number(legacy?.source_rows ?? 0) > 0) {
      blockers.push('legacy_handoff_boundary_unavailable');
    }
    if (nodes.length === 0) blockers.push('no_active_exit_nodes');
    if (nodes.some((node) =>
      Number(node.metering_protocol_version) !== 2 ||
      Number(node.metering_last_seen_at) <= timestamp - USAGE_METERING_NODE_READY_SECONDS
    )) {
      blockers.push('active_exit_without_v2_readiness');
    }
    if (legacyLastSeenAt > timestamp - USAGE_METERING_LEGACY_QUIET_SECONDS) {
      blockers.push('legacy_collector_recently_active');
    }
  }
  return {
    phase,
    updatedAt: Number(state?.updated_at ?? 0),
    legacyLastSeenAt: legacyLastSeenAt || null,
    legacyQuietSeconds: legacyLastSeenAt ? Math.max(0, timestamp - legacyLastSeenAt) : null,
    requiredLegacyQuietSeconds: USAGE_METERING_LEGACY_QUIET_SECONDS,
    legacy: {
      sourceRows: Number(legacy?.source_rows ?? 0),
      users: Number(legacy?.users ?? 0),
      accumulatedBytes: Number(legacy?.accumulated_bytes ?? 0),
      latestUpdateAt: Number(legacy?.latest_update_at ?? 0) || null,
    },
    named: {
      sourceRows: Number(named?.source_rows ?? 0),
      users: Number(named?.users ?? 0),
      sources: Number(named?.sources ?? 0),
      v1Rows: Number(named?.v1_rows ?? 0),
      v2Rows: Number(named?.v2_rows ?? 0),
      accumulatedBytes: Number(named?.accumulated_bytes ?? 0),
      latestUpdateAt: Number(named?.latest_update_at ?? 0) || null,
    },
    activeNodes: nodes.map((node) => ({
      id: String(node.id),
      name: String(node.name),
      v2Ready:
        Number(node.metering_protocol_version) === 2 &&
        Number(node.metering_last_seen_at) > timestamp - USAGE_METERING_NODE_READY_SECONDS,
      lastV2At: Number(node.metering_last_seen_at) || null,
    })),
    cutoverBaselineUsers: Number((baselines.results[0] as Row | undefined)?.count ?? 0),
    canRequireV2: phase === 'dual' && blockers.length === 0,
    blockers,
  };
}

export async function backfillDeviceExitCredentials(e: Env, limit = 50) {
  const pending = await e.DB.prepare(
    `SELECT devices.id, devices.user_id
     FROM devices
     LEFT JOIN device_exit_credentials ON device_exit_credentials.device_id = devices.id
     WHERE devices.status IN ('pending', 'active')
       AND device_exit_credentials.device_id IS NULL
     ORDER BY devices.created_at, devices.id
     LIMIT ?`,
  ).bind(limit).all<Row>();
  if (pending.results.length === 0) return 0;
  const results = await e.DB.batch(pending.results.map((device) => e.DB.prepare(
    `INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
     SELECT id, user_id, ?, ? FROM devices
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'active')`,
  ).bind(crypto.randomUUID(), now(), device.id, device.user_id)));
  return results.reduce((total, result) => total + Number(result.meta.changes ?? 0), 0);
}

export type SharedAdminDeps = {
  revokeDevice: (e: Env, d: Row, requireIneligibleUser?: boolean) => Promise<void>;
  processRevocations: (e: Env) => Promise<void>;
  enforceUser: (e: Env, userId: string, processNow?: boolean) => Promise<void>;
  publicAdministrativeAction: (row: Row) => ReturnType<typeof publicAction>;
};

/**
 * Resources served identically to both administrative front doors.
 *
 * The operations console authenticates with Cloudflare Access and the scripted
 * surface with a bearer token, but home exits, their bindings and the signup
 * allowlist are the same resource either way — and each was implemented twice,
 * byte for byte, about 260 lines of it. That is not a tidiness problem: a fix to
 * one copy leaves the other wrong. The two had already begun to diverge — the
 * allowlist listing coerced `email` on one path and not the other, harmless in
 * itself because D1 returns a string for a TEXT column either way, but it is
 * divergence appearing in code nobody had touched deliberately.
 * `directSuffixes` shipping with no syntax validation at all came from this
 * same shape, and that one was not harmless.
 *
 * Returns null when the resource is not one of the shared ones, so each caller
 * still reaches the handlers that genuinely are its own — `/ops/dashboard`,
 * `/admin/traffic-policy`, and the two `users` listings, which return
 * deliberately different shapes and are not merged.
 *
 * Authentication is the caller's responsibility and must already have happened:
 * this performs no authorization of its own.
 */
export async function sharedAdministrativeResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
  deps: SharedAdminDeps,
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
  if (resource === 'usage-metering-rollout' && m === 'GET') {
    return Response.json(await usageMeteringStatus(e));
  }
  if (resource === 'usage-metering-rollout' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['phase']);
    if (b.phase !== 'v2_required') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Rollout may only advance to v2_required');
    }
    const state = await usageMeteringStatus(e);
    if (state.phase === 'v2_required') return Response.json(state);
    if (!state.canRequireV2) {
      throw new ApiError(
        409,
        'METERING_ROLLOUT_NOT_READY',
        `Metering v2 is not ready: ${state.blockers.join(', ')}`,
      );
    }
    const t = now();
    let changed: D1Result;
    try {
      const results = await e.DB.batch([
        e.DB.prepare(
          `INSERT INTO usage_metering_cutover_baselines(
             user_id, reported_bytes, named_bytes, cutover_at
           )
           SELECT users.id,
                  users.usage_reported_bytes,
                  COALESCE((
                    SELECT SUM(accumulated_bytes)
                    FROM usage_report_sources
                    WHERE usage_report_sources.user_id = users.id
                      AND usage_report_sources.source_id != ''
                  ), 0),
                  ?
           FROM users
           WHERE true
           ON CONFLICT(user_id) DO NOTHING`,
        ).bind(t),
        e.DB.prepare(
          `UPDATE usage_metering_rollout
           SET phase = 'v2_required', updated_at = ?
           WHERE singleton_id = 1 AND phase = 'dual'`,
        ).bind(t),
        opsAuditStatement(
          e,
          actorEmail,
          'usage-metering.require-v2',
          'usage_metering_rollout',
          '1',
          'legacy collector disabled; named protocol v2 required',
          true,
        ),
      ]);
      changed = results[1];
    } catch (error) {
      if (String(error).includes('USAGE_METERING_ROLLOUT_NOT_READY')) {
        throw new ApiError(
          409,
          'METERING_ROLLOUT_NOT_READY',
          'Metering readiness changed; inspect rollout state and retry',
        );
      }
      throw error;
    }
    if (!changed.meta.changes) return Response.json(await usageMeteringStatus(e));
    return Response.json(await usageMeteringStatus(e));
  }
  mt = resource.match(/^users\/([^/]+)\/devices\/([^/]+)\/diagnostics-logs$/);
  if (mt && m === 'GET') {
    const row = await e.DB.prepare(
      `SELECT devices.id, access.expires_at, access.created_at, access.updated_at
       FROM devices
       LEFT JOIN diagnostics_log_access access ON access.device_id = devices.id
       WHERE devices.user_id = ? AND devices.id = ?`,
    ).bind(mt[1], mt[2]).first<Row>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Device not found');
    const expiresAt = row.expires_at == null ? null : Number(row.expires_at);
    return Response.json({
      diagnosticsLogs: {
        userId: mt[1],
        deviceId: mt[2],
        enabled: expiresAt !== null && expiresAt > now(),
        expiresAt,
        createdAt: row.created_at == null ? null : Number(row.created_at),
        updatedAt: row.updated_at == null ? null : Number(row.updated_at),
      },
    });
  }
  if (mt && m === 'PUT') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['expiresAt']);
    const t = now();
    if (
      !Number.isSafeInteger(b.expiresAt) ||
      b.expiresAt <= t ||
      b.expiresAt > t + DIAGNOSTICS_LOG_ACCESS_MAX_SECONDS
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'expiresAt must be within the next 24 hours');
    }
    const device = await e.DB.prepare(
      `SELECT devices.id, access.expires_at
       FROM devices
       LEFT JOIN diagnostics_log_access access ON access.device_id = devices.id
       WHERE devices.user_id = ? AND devices.id = ?`,
    ).bind(mt[1], mt[2]).first<Row>();
    if (!device) throw new ApiError(404, 'NOT_FOUND', 'Device not found');
    if (Number(device.expires_at) !== b.expiresAt) {
      await e.DB.batch([
        e.DB.prepare(
          `INSERT INTO diagnostics_log_access(
             device_id, user_id, expires_at, created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?)
           ON CONFLICT(device_id) DO UPDATE SET
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at
           WHERE diagnostics_log_access.expires_at != excluded.expires_at`,
        ).bind(mt[2], mt[1], b.expiresAt, t, t),
        opsAuditStatement(
          e,
          actorEmail,
          'diagnostics-logs.enable',
          'device',
          mt[2],
          `enabled raw logs for user ${mt[1]} until ${b.expiresAt}`,
          true,
        ),
      ]);
    }
    return Response.json({
      diagnosticsLogs: {
        userId: mt[1], deviceId: mt[2], enabled: true, expiresAt: b.expiresAt,
      },
    });
  }
  if (mt && m === 'DELETE') {
    const device = await e.DB.prepare(
      `SELECT devices.id, access.device_id AS access_device_id
       FROM devices
       LEFT JOIN diagnostics_log_access access ON access.device_id = devices.id
       WHERE devices.user_id = ? AND devices.id = ?`,
    ).bind(mt[1], mt[2]).first<Row>();
    if (!device) throw new ApiError(404, 'NOT_FOUND', 'Device not found');
    if (device.access_device_id != null) {
      await e.DB.batch([
        e.DB.prepare(
          'DELETE FROM diagnostics_log_access WHERE device_id = ? AND user_id = ?',
        ).bind(mt[2], mt[1]),
        opsAuditStatement(
          e,
          actorEmail,
          'diagnostics-logs.disable',
          'device',
          mt[2],
          `disabled raw logs for user ${mt[1]}`,
          true,
        ),
      ]);
    }
    return Response.json({
      diagnosticsLogs: {
        userId: mt[1], deviceId: mt[2], enabled: false, expiresAt: null,
      },
    });
  }
  if (resource === 'exit-nodes' && m === 'GET') {
    const rows = await e.DB.prepare(
      `SELECT id, name, status, last_roster_at, created_at, updated_at
       FROM exit_nodes ORDER BY name, id`,
    ).all<Row>();
    return Response.json({
      nodes: rows.results.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        status: String(row.status),
        lastRosterAt: Number(row.last_roster_at),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      })),
    });
  }
  if (resource === 'exit-nodes' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['id', 'name']);
    const nodeId = str(b.id, 'id', 1, 64);
    if (!/^[a-zA-Z0-9._-]+$/.test(nodeId)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid exit node id');
    }
    const name = str(b.name, 'name', 1, 100).trim();
    const token = randomToken();
    const t = now();
    try {
      await e.DB.prepare(
        `INSERT INTO exit_nodes(
           id, name, token_hash, status, last_roster_at, created_at, updated_at
         ) VALUES(?, ?, ?, 'active', 0, ?, ?)`,
      ).bind(nodeId, name, await sha256(token), t, t).run();
    } catch {
      throw new ApiError(409, 'EXIT_NODE_CONFLICT', 'Exit node id or name already exists');
    }
    await writeOpsAudit(e, actorEmail, 'exit-node.create', 'exit_node', nodeId, name);
    return Response.json({
      node: { id: nodeId, name, status: 'active', lastRosterAt: 0, createdAt: t, updatedAt: t },
      token,
    }, { status: 201 });
  }
  mt = resource.match(/^exit-nodes\/([^/]+)\/token$/);
  if (mt && m === 'POST') {
    const token = randomToken();
    const t = now();
    const updated = await e.DB.prepare(
      `UPDATE exit_nodes SET token_hash = ?, updated_at = ? WHERE id = ?`,
    ).bind(await sha256(token), t, mt[1]).run();
    if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Exit node not found');
    await writeOpsAudit(e, actorEmail, 'exit-node.rotate-token', 'exit_node', mt[1], 'rotated token');
    return Response.json({ id: mt[1], token, updatedAt: t });
  }
  mt = resource.match(/^exit-nodes\/([^/]+)$/);
  if (mt && m === 'PATCH') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['status']);
    const status = str(b.status, 'status', 1, 20);
    if (!['active', 'disabled'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid exit node status');
    }
    const t = now();
    const updated = await e.DB.prepare(
      `UPDATE exit_nodes
       SET last_roster_at = CASE
             WHEN status = 'disabled' AND ? = 'active' THEN 0
             ELSE last_roster_at
           END,
           status = ?,
           updated_at = ?
       WHERE id = ?`,
    ).bind(status, status, t, mt[1]).run();
    if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Exit node not found');
    await writeOpsAudit(e, actorEmail, 'exit-node.update', 'exit_node', mt[1], `status ${status}`);
    return Response.json({ id: mt[1], status, updatedAt: t });
  }
  if (resource === 'exit-credential-rollout' && m === 'GET') {
    const [rollout, coverage, activeNodes] = await e.DB.batch([
      e.DB.prepare('SELECT phase, updated_at FROM exit_credential_rollout WHERE singleton_id = 1'),
      e.DB.prepare(
        `SELECT
           SUM(CASE WHEN credentials.device_id IS NULL THEN 1 ELSE 0 END) AS missing,
           COALESCE(MAX(credentials.created_at), 0) AS latest_credential_at
         FROM devices
         LEFT JOIN device_exit_credentials credentials ON credentials.device_id = devices.id
         WHERE devices.status IN ('pending', 'active')`,
      ),
      e.DB.prepare(
        `SELECT COUNT(*) AS count, COALESCE(MIN(last_roster_at), 0) AS oldest_ack
         FROM exit_nodes WHERE status = 'active'`,
      ),
    ]);
    const state = rollout.results[0] as Row | undefined;
    const covered = coverage.results[0] as Row | undefined;
    const nodes = activeNodes.results[0] as Row | undefined;
    return Response.json({
      phase: state?.phase === 'device_only' ? 'device_only' : 'dual',
      updatedAt: Number(state?.updated_at ?? 0),
      missingDeviceCredentials: Number(covered?.missing ?? 0),
      latestCredentialAt: Number(covered?.latest_credential_at ?? 0),
      activeNodes: Number(nodes?.count ?? 0),
      oldestRosterAck: Number(nodes?.oldest_ack ?? 0),
    });
  }
  if (resource === 'exit-credential-rollout' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['phase']);
    if (b.phase !== 'device_only') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Rollout may only advance to device_only');
    }
    await backfillDeviceExitCredentials(e, 50);
    const catalog = await publicManagedCatalog(e);
    if (!catalog.yaml.includes(CLIENT_UUID_PLACEHOLDER)) {
      throw new ApiError(409, 'ROLLOUT_NOT_READY', 'Publish the device credential catalog first');
    }
    const [coverage, activeNodes] = await e.DB.batch([
      e.DB.prepare(
        `SELECT
           SUM(CASE WHEN credentials.device_id IS NULL THEN 1 ELSE 0 END) AS missing,
           COALESCE(MAX(credentials.created_at), 0) AS latest_credential_at
         FROM devices
         LEFT JOIN device_exit_credentials credentials ON credentials.device_id = devices.id
         WHERE devices.status IN ('pending', 'active')`,
      ),
      e.DB.prepare(
        `SELECT COUNT(*) AS count, COALESCE(MIN(last_roster_at), 0) AS oldest_ack
         FROM exit_nodes WHERE status = 'active'`,
      ),
    ]);
    const covered = coverage.results[0] as Row | undefined;
    const nodes = activeNodes.results[0] as Row | undefined;
    const latestCredentialAt = Number(covered?.latest_credential_at ?? 0);
    if (Number(covered?.missing ?? 0) > 0) {
      throw new ApiError(409, 'ROLLOUT_NOT_READY', 'Active devices still lack exit credentials');
    }
    if (Number(nodes?.count ?? 0) < 1 || Number(nodes?.oldest_ack ?? 0) <= latestCredentialAt) {
      throw new ApiError(409, 'ROLLOUT_NOT_READY', 'Every active exit must acknowledge the current roster');
    }
    const t = now();
    let updated: D1Result;
    try {
      updated = await e.DB.prepare(
        `UPDATE exit_credential_rollout
         SET phase = 'device_only', updated_at = ?
         WHERE singleton_id = 1 AND phase = 'dual'
           AND EXISTS (
             SELECT 1 FROM managed_exit_catalog
             WHERE singleton_id = 1 AND revision = ?
           )`,
      ).bind(t, catalog.revision).run();
    } catch (error) {
      if (String(error).includes('EXIT_CREDENTIAL_ROLLOUT_NOT_READY')) {
        throw new ApiError(409, 'ROLLOUT_NOT_READY', 'Device or exit roster readiness changed; retry the rollout check');
      }
      throw error;
    }
    if (!updated.meta.changes) {
      const state = await e.DB.prepare(
        'SELECT phase, updated_at FROM exit_credential_rollout WHERE singleton_id = 1',
      ).first<Row>();
      if (state?.phase === 'device_only') {
        return Response.json({ phase: 'device_only', updatedAt: Number(state.updated_at) });
      }
      throw new ApiError(409, 'ROLLOUT_NOT_READY', 'Managed catalog changed; retry the rollout check');
    }
    await writeOpsAudit(e, actorEmail, 'exit-credential.device-only', 'exit_credential_rollout', '1', 'retired shared legacy');
    return Response.json({ phase: 'device_only', updatedAt: t });
  }
  if (resource === 'home-exits' && m === 'GET') {
    const q = await e.DB.prepare(
      `SELECT home_exits.*,
              (SELECT COUNT(*) FROM user_home_bindings WHERE home_exit_id = home_exits.id) AS bind_count
       FROM home_exits
       ORDER BY status ASC, display_name ASC, created_at ASC`,
    ).all<Row>();
    const exits = q.results.map(publicHomeExit);
    try {
      // The lifetime ratio hides a line that died last week behind months of
      // green history, so a seven-day window travels alongside it — counted in
      // the same pass rather than a second scan.
      const weekAgo = now() - 7 * 86_400;
      const stats = await e.DB.prepare(
        `SELECT home_exit_id,
                SUM(CASE WHEN status = 'alive' THEN 1 ELSE 0 END) AS alive,
                COUNT(*) AS total,
                SUM(CASE WHEN probed_at >= ? AND status = 'alive' THEN 1 ELSE 0 END) AS alive_7d,
                SUM(CASE WHEN probed_at >= ? THEN 1 ELSE 0 END) AS total_7d
         FROM operations_home_probe_samples
         GROUP BY home_exit_id`,
      ).bind(weekAgo, weekAgo).all<Row>();
      const byId = new Map(stats.results.map((row) => [String(row.home_exit_id), row]));
      return Response.json({
        homeExits: exits.map((exit) => {
          const row = byId.get(exit.id);
          if (!row) return exit;
          const alive = Number(row.alive);
          const total = Number(row.total);
          const alive7d = Number(row.alive_7d);
          const total7d = Number(row.total_7d);
          return {
            ...exit,
            probeAlive: alive,
            probeTotal: total,
            probeUptimeRatio: total > 0 ? alive / total : undefined,
            probeAlive7d: alive7d,
            probeTotal7d: total7d,
            probeUptimeRatio7d: total7d > 0 ? alive7d / total7d : undefined,
          };
        }),
      });
    } catch (error) {
      if (!String(error).includes('no such table')) throw error;
      return Response.json({ homeExits: exits });
    }
  }
  if (resource === 'home-exits' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    const proxyName = proxyNameField(b.proxyName);
    const displayName = str(b.displayName, 'displayName', 1, 200).trim();
    const egressIpv4 = optionalIpv4(b.egressIpv4, 'egressIpv4');
    const kind = b.kind === undefined ? 'catalog' : str(b.kind, 'kind', 1, 20);
    if (!['catalog', 'socks5'].includes(kind)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid kind');
    }
    const socks5Host = b.socks5Host === undefined || b.socks5Host === null || b.socks5Host === ''
      ? null
      : socks5HostField(b.socks5Host);
    const socks5Port = b.socks5Port === undefined || b.socks5Port === null
      ? null
      : socks5PortField(b.socks5Port);
    const socks5Username = b.socks5Username === undefined || b.socks5Username === null || b.socks5Username === ''
      ? null
      : str(b.socks5Username, 'socks5Username', 1, 255);
    const socks5Password = b.socks5Password === undefined || b.socks5Password === null || b.socks5Password === ''
      ? null
      : str(b.socks5Password, 'socks5Password', 1, 255);
    validateHomeSocks5(kind, socks5Host, socks5Port, socks5Username, socks5Password);
    const notes = b.notes === undefined || b.notes === null || b.notes === ''
      ? null
      : str(b.notes, 'notes', 1, 1000);
    const status = b.status === undefined ? 'active' : str(b.status, 'status', 1, 20);
    if (!['active', 'disabled', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const homeId = id();
    const t = now();
    try {
      await e.DB.prepare(
        `INSERT INTO home_exits(
           id, proxy_name, display_name, egress_ipv4, kind,
           socks5_host, socks5_port, socks5_username, socks5_password,
           status, notes, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        homeId, proxyName, displayName, egressIpv4, kind,
        socks5Host, socks5Port, socks5Username, socks5Password,
        status, notes, t, t,
      ).run();
    } catch {
      throw new ApiError(409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
    }
    const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeId).first<Row>();
    await bumpCatalogRevision(e);
    await writeOpsAudit(e, actorEmail, 'home.create', 'home_exit', homeId, displayName);
    return Response.json({ homeExit: publicHomeExit(row!) }, { status: 201 });
  }
  if (resource === 'home-exits/assign' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['userId', 'line', 'displayName', 'defaultProxyName', 'replace']);
    const userId = str(b.userId, 'userId', 1, 100);
    const parsed = parseHomeLine(b.line);
    if (b.replace !== undefined && typeof b.replace !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid replace');
    }
    const replace = b.replace === true;
    const user = await e.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    const current = await loadHomeBinding(e, userId);
    if (current && !replace) {
      throw new ApiError(409, 'HOME_ALREADY_BOUND', 'User already has a home exit; pass replace=true to swap it');
    }
    const defaultProxyName = b.defaultProxyName === undefined && current
      ? (current.default_proxy_name == null || current.default_proxy_name === ''
        ? null
        : String(current.default_proxy_name))
      : await defaultProxyNameField(e, b.defaultProxyName);
    const emailLocal = String(user.email).split('@')[0] || 'user';
    const displayName = b.displayName === undefined || b.displayName === null || b.displayName === ''
      ? `家宽 · ${emailLocal}`
      : str(b.displayName, 'displayName', 1, 200).trim();

    let home = await findSocks5Home(e, parsed.host, parsed.port, parsed.username);
    let createdHome = false;
    if (home) {
      const owner = await e.DB.prepare(
        'SELECT user_id FROM user_home_bindings WHERE home_exit_id = ?',
      ).bind(home.id).first<Row>();
      if (owner && String(owner.user_id) !== userId) {
        throw new ApiError(409, 'HOME_EXIT_IN_USE', 'This home line is already assigned to another user');
      }
      if (String(home.status) !== 'active') {
        await e.DB.prepare(
          'UPDATE home_exits SET status = ?, display_name = ?, notes = ?, updated_at = ? WHERE id = ?',
        ).bind('active', displayName, parsed.notes ?? home.notes, now(), home.id).run();
        home = (await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(home.id).first<Row>())!;
      }
    } else {
      home = await insertSocks5HomeExit(e, parsed, displayName);
      createdHome = true;
    }

    const previousHomeId = current ? String(current.home_exit_id) : null;
    const bound = await upsertHomeBinding(e, userId, String(home.id), defaultProxyName);
    let retiredHomeExitId: string | undefined;
    if (previousHomeId && previousHomeId !== String(home.id)) {
      const stillUsed = await e.DB.prepare(
        'SELECT 1 FROM user_home_bindings WHERE home_exit_id = ? LIMIT 1',
      ).bind(previousHomeId).first<Row>();
      if (!stillUsed) {
        await e.DB.prepare(
          "UPDATE home_exits SET status = 'retired', updated_at = ? WHERE id = ?",
        ).bind(now(), previousHomeId).run();
        retiredHomeExitId = previousHomeId;
      }
    }
    await bumpCatalogRevision(e);
    const binding = await loadHomeBinding(e, userId);
    const refreshQueued = await enqueueRefreshCatalogForUser(e, userId);
    const swapped = Boolean(previousHomeId && previousHomeId !== String(home.id));
    await writeOpsAudit(
      e, actorEmail, swapped ? 'home.replace' : 'home.assign', 'user', userId,
      swapped ? `replaced home for ${user.email}` : `assigned home for ${user.email}`,
    );
    return Response.json({
      homeExit: publicHomeExit(home),
      binding: publicHomeBinding(binding!),
      created: createdHome,
      replaced: swapped,
      retiredHomeExitId,
      refreshQueued,
    }, { status: createdHome || bound.created ? 201 : 200 });
  }
  if (resource === 'home-exits/import' && m === 'POST') {
    const b = await body(req, 32 * 1024);
    rejectUnexpectedKeys(b, ['lines']);
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 50) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'lines must be an array of 1–50 strings');
    }
    const created: ReturnType<typeof publicHomeExit>[] = [];
    const skipped: Array<{ host?: string; port?: number; username?: string; message: string }> = [];
    const failed: Array<{ message: string }> = [];
    for (const raw of b.lines) {
      try {
        const parsed = parseHomeLine(raw);
        const existing = await findSocks5Home(e, parsed.host, parsed.port, parsed.username);
        if (existing) {
          skipped.push({
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
            message: 'already exists',
          });
          continue;
        }
        const displayName = parsed.notes && parsed.notes.length <= 200
          ? parsed.notes
          : `家宽 · ${parsed.host}`;
        const row = await insertSocks5HomeExit(e, parsed, displayName);
        created.push(publicHomeExit(row));
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Invalid home line';
        failed.push({ message });
      }
    }
    if (created.length > 0) {
      await bumpCatalogRevision(e);
      await writeOpsAudit(
        e, actorEmail, 'home.import', 'home_exit', null,
        `imported ${created.length} (skipped ${skipped.length}, failed ${failed.length})`,
      );
    }
    return Response.json({ created, skipped, failed }, { status: created.length > 0 ? 201 : 200 });
  }
  mt = resource.match(/^home-exits\/([^/]+)\/probes$/);
  if (mt && m === 'GET') {
    const existing = await e.DB.prepare('SELECT id FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    const range = new URL(req.url).searchParams.get('range');
    if (range !== null && !['24h', '7d', '90d'].includes(range)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unsupported probes range');
    }
    return Response.json({ probes: await queryHomeProbeHistory(e.DB, mt[1], now(), range) });
  }
  mt = resource.match(/^home-exits\/([^/]+)$/);
  if (mt && m === 'PATCH') {
    const b = await body(req, 8 * 1024);
    const existing = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    const proxyName = b.proxyName === undefined ? String(existing.proxy_name) : proxyNameField(b.proxyName);
    const displayName = b.displayName === undefined
      ? String(existing.display_name)
      : str(b.displayName, 'displayName', 1, 200).trim();
    const egressIpv4 = b.egressIpv4 === undefined
      ? (existing.egress_ipv4 == null ? null : String(existing.egress_ipv4))
      : optionalIpv4(b.egressIpv4, 'egressIpv4');
    const notes = b.notes === undefined
      ? (existing.notes == null ? null : String(existing.notes))
      : (b.notes === null || b.notes === '' ? null : str(b.notes, 'notes', 1, 1000));
    const status = b.status === undefined ? String(existing.status) : str(b.status, 'status', 1, 20);
    if (!['active', 'disabled', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const kind = b.kind === undefined ? String(existing.kind ?? 'catalog') : str(b.kind, 'kind', 1, 20);
    if (!['catalog', 'socks5'].includes(kind)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid kind');
    }
    // Omitted socks5 fields keep their stored values; switching back to
    // catalog wipes them.
    const keep = kind === 'socks5';
    const socks5Host = b.socks5Host === undefined
      ? (keep && existing.socks5_host != null ? String(existing.socks5_host) : null)
      : (b.socks5Host === null || b.socks5Host === '' ? null : socks5HostField(b.socks5Host));
    const socks5Port = b.socks5Port === undefined
      ? (keep && existing.socks5_port != null ? Number(existing.socks5_port) : null)
      : (b.socks5Port === null ? null : socks5PortField(b.socks5Port));
    const socks5Username = b.socks5Username === undefined
      ? (keep && existing.socks5_username != null ? String(existing.socks5_username) : null)
      : (b.socks5Username === null || b.socks5Username === '' ? null : str(b.socks5Username, 'socks5Username', 1, 255));
    const socks5Password = b.socks5Password === undefined
      ? (keep && existing.socks5_password != null ? String(existing.socks5_password) : null)
      : (b.socks5Password === null || b.socks5Password === '' ? null : str(b.socks5Password, 'socks5Password', 1, 255));
    validateHomeSocks5(kind, socks5Host, socks5Port, socks5Username, socks5Password);
    const t = now();
    try {
      const updated = await e.DB.prepare(
        `UPDATE home_exits
         SET proxy_name = ?, display_name = ?, egress_ipv4 = ?, kind = ?,
             socks5_host = ?, socks5_port = ?, socks5_username = ?, socks5_password = ?,
             status = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        proxyName, displayName, egressIpv4, kind,
        socks5Host, socks5Port, socks5Username, socks5Password,
        status, notes, t, mt[1],
      ).run();
      if (!updated.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
    }
    const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(mt[1]).first<Row>();
    await bumpCatalogRevision(e);
    return Response.json({ homeExit: publicHomeExit(row!) });
  }
  if (mt && m === 'DELETE') {
    const bound = await e.DB.prepare(
      'SELECT 1 FROM user_home_bindings WHERE home_exit_id = ? LIMIT 1',
    ).bind(mt[1]).first<Row>();
    if (bound) {
      throw new ApiError(409, 'HOME_EXIT_IN_USE', 'Unbind all users before deleting this home exit');
    }
    const deleted = await e.DB.prepare('DELETE FROM home_exits WHERE id = ?').bind(mt[1]).run();
    if (!deleted.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    await bumpCatalogRevision(e);
    return new Response(null, { status: 204 });
  }
  if (resource === 'home-bindings' && m === 'GET') {
    const q = await e.DB.prepare(
      `SELECT
         user_home_bindings.user_id,
         users.email,
         user_home_bindings.home_exit_id,
         user_home_bindings.default_proxy_name,
         home_exits.proxy_name,
         home_exits.display_name,
         home_exits.kind,
         home_exits.socks5_host,
         home_exits.socks5_port,
         home_exits.egress_ipv4,
         home_exits.status AS home_status,
         user_home_bindings.created_at,
         user_home_bindings.updated_at
       FROM user_home_bindings
       JOIN users ON users.id = user_home_bindings.user_id
       JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       ORDER BY users.email ASC`,
    ).all<Row>();
    return Response.json({ bindings: q.results.map(publicHomeBinding) });
  }
  mt = resource.match(/^users\/([^/]+)\/home-binding$/);
  if (mt && m === 'GET') {
    const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    const row = await e.DB.prepare(
      `SELECT
         user_home_bindings.user_id,
         users.email,
         user_home_bindings.home_exit_id,
         user_home_bindings.default_proxy_name,
         home_exits.proxy_name,
         home_exits.display_name,
         home_exits.kind,
         home_exits.socks5_host,
         home_exits.socks5_port,
         home_exits.egress_ipv4,
         home_exits.status AS home_status,
         user_home_bindings.created_at,
         user_home_bindings.updated_at
       FROM user_home_bindings
       JOIN users ON users.id = user_home_bindings.user_id
       JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       WHERE user_home_bindings.user_id = ?`,
    ).bind(mt[1]).first<Row>();
    return Response.json({ binding: row ? publicHomeBinding(row) : null });
  }
  if (mt && m === 'PUT') {
    const b = await body(req, 8 * 1024);
    const user = await e.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(mt[1]).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    let homeExitId: string | undefined;
    if (b.homeExitId !== undefined) {
      homeExitId = str(b.homeExitId, 'homeExitId', 1, 100);
    } else if (b.proxyName !== undefined) {
      const byName = await e.DB.prepare(
        'SELECT id FROM home_exits WHERE proxy_name = ?',
      ).bind(proxyNameField(b.proxyName)).first<Row>();
      if (!byName) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
      homeExitId = String(byName.id);
    } else {
      throw new ApiError(400, 'VALIDATION_ERROR', 'homeExitId or proxyName is required');
    }
    const home = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeExitId).first<Row>();
    if (!home) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');
    if (String(home.status) !== 'active') {
      throw new ApiError(409, 'HOME_EXIT_INACTIVE', 'Home exit must be active before binding');
    }
    const defaultProxyName = await defaultProxyNameField(e, b.defaultProxyName);
    const t = now();
    const existing = await e.DB.prepare(
      'SELECT created_at FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).first<Row>();
    if (existing) {
      await e.DB.prepare(
        `UPDATE user_home_bindings
         SET home_exit_id = ?, default_proxy_name = ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(homeExitId, defaultProxyName, t, mt[1]).run();
    } else {
      await e.DB.prepare(
        `INSERT INTO user_home_bindings(user_id, home_exit_id, default_proxy_name, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?)`,
      ).bind(mt[1], homeExitId, defaultProxyName, t, t).run();
    }
    const row = await e.DB.prepare(
      `SELECT
         user_home_bindings.user_id,
         users.email,
         user_home_bindings.home_exit_id,
         user_home_bindings.default_proxy_name,
         home_exits.proxy_name,
         home_exits.display_name,
         home_exits.kind,
         home_exits.socks5_host,
         home_exits.socks5_port,
         home_exits.egress_ipv4,
         home_exits.status AS home_status,
         user_home_bindings.created_at,
         user_home_bindings.updated_at
       FROM user_home_bindings
       JOIN users ON users.id = user_home_bindings.user_id
       JOIN home_exits ON home_exits.id = user_home_bindings.home_exit_id
       WHERE user_home_bindings.user_id = ?`,
    ).bind(mt[1]).first<Row>();
    await bumpCatalogRevision(e);
    await writeOpsAudit(
      e, actorEmail, existing ? 'home.replace' : 'home.assign', 'user', mt[1],
      existing ? `replaced home for ${user.email}` : `assigned home for ${user.email}`,
    );
    return Response.json({ binding: publicHomeBinding(row!) }, { status: existing ? 200 : 201 });
  }
  if (mt && m === 'DELETE') {
    const deleted = await e.DB.prepare(
      'DELETE FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).run();
    if (!deleted.meta.changes) {
      const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(mt[1]).first<Row>();
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    } else {
      await bumpCatalogRevision(e);
      await writeOpsAudit(e, actorEmail, 'home.unbind', 'user', mt[1], 'removed home binding');
    }
    return new Response(null, { status: 204 });
  }
  mt = resource.match(/^users\/([^/]+)\/close$/);
  if (mt && m === 'POST') {
    if (req.headers.get('content-length') && Number(req.headers.get('content-length')) > 0) {
      const b = await body(req, 4 * 1024);
      rejectUnexpectedKeys(b, ['reason']);
    }
    const user = await e.DB.prepare('SELECT * FROM users WHERE id = ?').bind(mt[1]).first<Row>();
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    const t = now();
    const unbound = await e.DB.prepare(
      'DELETE FROM user_home_bindings WHERE user_id = ?',
    ).bind(mt[1]).run();
    if (unbound.meta.changes) await bumpCatalogRevision(e);
    const assigned = await assignedProductForUser(e, mt[1]);
    if (assigned) {
      await e.DB.prepare(
        `UPDATE product_accounts
         SET status = 'retired', closed_at = ?, close_reason = 'other', updated_at = ?
         WHERE id = ? AND status = 'assigned'`,
      ).bind(t, t, assigned.id).run();
      await recordProductEvent(e, String(assigned.id), mt[1], 'note', 'refund close');
    }
    await e.DB.prepare('DELETE FROM signup_allowlist WHERE email = ?').bind(user.email).run();
    await e.DB.prepare(
      `UPDATE users
       SET status = 'disabled',
           notes = CASE WHEN notes IS NULL OR notes = '' THEN '退款销户' ELSE notes END,
           updated_at = ?
       WHERE id = ?`,
    ).bind(t, mt[1]).run();
    await deps.enforceUser(e, mt[1]);
    await writeOpsAudit(e, actorEmail, 'user.close', 'user', mt[1], `closed ${user.email}`);
    return Response.json({ ok: true, email: String(user.email), status: 'disabled' });
  }
  if (resource === 'signup-allowlist' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    const address = email(b.email);
    const createdAt = now();
    const inserted = await e.DB.prepare(
      'INSERT OR IGNORE INTO signup_allowlist(email, created_at) VALUES(?, ?)',
    ).bind(address, createdAt).run();
    const entry = await e.DB.prepare(
      'SELECT created_at FROM signup_allowlist WHERE email = ?',
    ).bind(address).first<Row>();
    if (inserted.meta.changes === 1) {
      await writeOpsAudit(e, actorEmail, 'allowlist.add', 'signup_allowlist', address, address);
    }
    return Response.json(
      {
        email: address,
        createdAt: Number(entry?.created_at ?? createdAt),
        created: inserted.meta.changes === 1,
      },
      { status: inserted.meta.changes === 1 ? 201 : 200 },
    );
  }
  if (resource === 'exit-catalog' && m === 'GET') {
    return Response.json(await publicManagedCatalog(e));
  }
  if (resource === 'exit-catalog' && m === 'PUT') {
    const b = await body(req, 2 * 1024 * 1024);
    rejectUnexpectedKeys(b, ['yaml', 'expectedRevision']);
    const yaml = managedCatalogYAML(b.yaml);
    const expectedRevision = b.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'expectedRevision is required and must be a non-negative integer');
    }
    const current = await e.DB.prepare(
      'SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<Row>();
    const currentRevision = Number(current?.revision ?? 0);
    if (expectedRevision !== currentRevision) {
      throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; reload before replacing it');
    }
    const revision = currentRevision + 1;
    const encrypted = await encryptCatalog(yaml, requiredCatalogKey(e));
    const digest = await sha256(yaml);
    const t = now();
    const changed = current
      ? await e.DB.prepare(
        `UPDATE managed_exit_catalog
         SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?
         WHERE singleton_id = 1 AND revision = ?`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, currentRevision).run()
      : await e.DB.prepare(
        `INSERT OR IGNORE INTO managed_exit_catalog(
           singleton_id, revision, ciphertext, nonce, content_sha256, updated_at
         ) VALUES(1, ?, ?, ?, ?, ?)`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t).run();
    if (!changed.meta.changes) {
      throw new ApiError(409, 'CATALOG_CONFLICT', 'Managed catalog changed; reload before replacing it');
    }
    await writeOpsAudit(
      e,
      actorEmail,
      'catalog.publish',
      'managed_exit_catalog',
      String(revision),
      `published r${currentRevision} → r${revision} (${digest.slice(0, 16)})`,
    );
    return Response.json({ revision, sha256: digest, updatedAt: t });
  }
  if (resource === 'traffic-policy' && m === 'GET') {
    return Response.json(await publicTrafficPolicy(e));
  }
  if (resource === 'traffic-policy' && m === 'PUT') {
    const b = await body(req, 64 * 1024);
    rejectUnexpectedKeys(b, ['policy', 'expectedRevision', 'signature', 'dryRun']);
    if (b.signature !== undefined && (typeof b.signature !== 'string' || !b.signature.length || b.signature.length > 128)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid signature');
    }
    if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid dryRun');
    }
    const signature = b.signature as string | undefined;
    const dryRun = b.dryRun === true;
    const policy = canonicalTrafficPolicy(b.policy, dryRun || Boolean(signature));
    const json = JSON.stringify(policy);
    if (signature) {
      const publicKey = e.TRAFFIC_POLICY_PUBLIC_KEY;
      if (!publicKey) {
        throw new ApiError(409, 'TRAFFIC_POLICY_KEY_UNCONFIGURED', 'This deployment has no policy signing public key, so a signed policy cannot be accepted');
      }
      if (!await verifyTrafficPolicySignature(json, signature, publicKey)) {
        throw new ApiError(400, 'TRAFFIC_POLICY_SIGNATURE_INVALID', 'The signature does not cover the canonical policy this would serve');
      }
    }
    if (dryRun) {
      let signatureRequired = false;
      try {
        canonicalTrafficPolicy(b.policy, false);
      } catch {
        signatureRequired = true;
      }
      return Response.json({
        dryRun: true,
        json,
        sha256: await sha256(json),
        signatureRequired,
        signatureContext: TRAFFIC_POLICY_SIGNATURE_CONTEXT,
      });
    }
    const expectedRevision = b.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'expectedRevision is required and must be a non-negative integer');
    }
    const current = await e.DB.prepare(
      'SELECT revision FROM managed_traffic_policy WHERE singleton_id = 1',
    ).first<Row>();
    const currentRevision = Number(current?.revision ?? 0);
    if (expectedRevision !== currentRevision) {
      throw new ApiError(409, 'TRAFFIC_POLICY_CONFLICT', 'Managed traffic policy changed; reload before replacing it');
    }
    const revision = currentRevision + 1;
    const encrypted = await encryptTrafficPolicy(json, requiredCatalogKey(e));
    const digest = await sha256(json);
    const t = now();
    const storedSignature = signature ?? null;
    const changed = current
      ? await e.DB.prepare(
        `UPDATE managed_traffic_policy
         SET revision = ?, ciphertext = ?, nonce = ?, content_sha256 = ?, updated_at = ?, signature = ?
         WHERE singleton_id = 1 AND revision = ?`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, storedSignature, currentRevision).run()
      : await e.DB.prepare(
        `INSERT OR IGNORE INTO managed_traffic_policy(
           singleton_id, revision, ciphertext, nonce, content_sha256, updated_at, signature
         ) VALUES(1, ?, ?, ?, ?, ?, ?)`,
      ).bind(revision, encrypted.ciphertext, encrypted.nonce, digest, t, storedSignature).run();
    if (!changed.meta.changes) {
      throw new ApiError(409, 'TRAFFIC_POLICY_CONFLICT', 'Managed traffic policy changed; reload before replacing it');
    }
    await writeOpsAudit(
      e,
      actorEmail,
      'traffic-policy.publish',
      'managed_traffic_policy',
      String(revision),
      `published r${currentRevision} → r${revision} (${digest.slice(0, 16)})`,
    );
    return Response.json({
      revision, json, sha256: digest, updatedAt: t,
      ...(signature ? { signature } : {}),
    });
  }
  if (resource === 'device-actions' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['deviceId', 'action', 'ttlSeconds']);
    const deviceId = str(b.deviceId, 'deviceId', 1, 200);
    const action = fixedAction(b.action);
    const ttl = b.ttlSeconds ?? 300;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 3600) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid ttlSeconds');
    const device = await e.DB.prepare("SELECT * FROM devices WHERE id = ? AND status != 'revoked'").bind(deviceId).first<Row>();
    if (!device) throw new ApiError(404, 'NOT_FOUND', 'Active device not found');
    const t = now();
    const commandId = id();
    await e.DB.prepare(
      'INSERT INTO device_actions(id,user_id,device_id,action,status,created_at,expires_at) VALUES(?,?,?,?,\'pending\',?,?)',
    ).bind(commandId, device.user_id, device.id, action, t, t + ttl).run();
    const row = await e.DB.prepare('SELECT * FROM device_actions WHERE id = ?').bind(commandId).first<Row>();
    await writeOpsAudit(e, actorEmail, 'device.action', 'device', deviceId, `queued ${action}`);
    return Response.json({ action: publicAction(row!) }, { status: 201 });
  }
  if (resource === 'device-actions' && m === 'GET') {
    const t = now();
    await e.DB.prepare("UPDATE device_actions SET status = 'expired' WHERE status IN ('pending','delivered') AND expires_at <= ?").bind(t).run();
    const deviceId = new URL(req.url).searchParams.get('deviceId');
    if (deviceId !== null && (deviceId.length < 1 || deviceId.length > 200)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid deviceId');
    const q = deviceId
      ? await e.DB.prepare('SELECT * FROM device_actions WHERE device_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').bind(deviceId).all<Row>()
      : await e.DB.prepare('SELECT * FROM device_actions ORDER BY created_at DESC, rowid DESC LIMIT 100').all<Row>();
    return Response.json({ actions: q.results.map(deps.publicAdministrativeAction) });
  }
  if (resource === 'devices' && m === 'GET') {
    const q = await e.DB.prepare(
      'SELECT devices.*, users.email FROM devices JOIN users ON users.id = devices.user_id ORDER BY devices.created_at DESC',
    ).all<Row>();
    return Response.json({
      devices: q.results.map((x) => ({ ...publicDevice(x), userId: x.user_id, email: x.email })),
    });
  }
  mt = resource.match(/^devices\/([^/]+)$/);
  if (mt && m === 'DELETE') {
    const d = await e.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(mt[1]).first<Row>();
    if (!d) throw new ApiError(404, 'NOT_FOUND', 'Device not found');
    await deps.revokeDevice(e, d);
    await deps.processRevocations(e);
    await writeOpsAudit(e, actorEmail, 'device.revoke', 'device', mt[1], `revoked device of user ${String(d.user_id)}`);
    return new Response(null, { status: 204 });
  }

  if (resource === 'product-accounts' && m === 'GET') {
    const status = new URL(req.url).searchParams.get('status');
    if (status !== null && !['pooled', 'assigned', 'banned', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    const q = status
      ? await e.DB.prepare(
        `SELECT product_accounts.*, users.email
         FROM product_accounts
         LEFT JOIN users ON users.id = product_accounts.user_id
         WHERE product_accounts.status = ?
         ORDER BY product_accounts.updated_at DESC`,
      ).bind(status).all<Row>()
      : await e.DB.prepare(
        `SELECT product_accounts.*, users.email
         FROM product_accounts
         LEFT JOIN users ON users.id = product_accounts.user_id
         ORDER BY product_accounts.updated_at DESC
         LIMIT 500`,
      ).all<Row>();
    return Response.json({ accounts: q.results.map(publicProductAccount) });
  }
  if (resource === 'product-accounts' && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['accountRef', 'userId', 'openedAt', 'notes']);
    const accountRef = accountRefField(b.accountRef);
    const notes = optionalNotes(b.notes);
    const openedAt = optionalUnix(b.openedAt, 'openedAt') ?? now();
    if (b.userId !== undefined && b.userId !== null && b.userId !== '') {
      const userId = str(b.userId, 'userId', 1, 100);
      const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<Row>();
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
      const row = await createAssignedProductAccount(e, userId, accountRef, openedAt, notes, actorEmail);
      return Response.json({ account: publicProductAccount(row) }, { status: 201 });
    }
    const existing = await e.DB.prepare(
      'SELECT id FROM product_accounts WHERE account_ref = ?',
    ).bind(accountRef).first<Row>();
    if (existing) throw new ApiError(409, 'ACCOUNT_REF_IN_USE', 'This Claude account is already registered');
    const accountId = id();
    const t = now();
    await e.DB.prepare(
      `INSERT INTO product_accounts(
         id, user_id, product, account_ref, status, opened_at, closed_at, close_reason, notes, created_at, updated_at
       ) VALUES(?, NULL, ?, ?, 'pooled', NULL, NULL, NULL, ?, ?, ?)`,
    ).bind(accountId, PRODUCT_CLAUDE, accountRef, notes, t, t).run();
    await recordProductEvent(e, accountId, null, 'opened', 'pooled');
    await writeOpsAudit(e, actorEmail, 'product.pool', 'product_account', accountId, `pooled ${accountRef}`);
    const row = await e.DB.prepare('SELECT * FROM product_accounts WHERE id = ?').bind(accountId).first<Row>();
    return Response.json({ account: publicProductAccount(row!) }, { status: 201 });
  }
  mt = resource.match(/^product-accounts\/([^/]+)\/ban$/);
  if (mt && m === 'POST') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['detail']);
    const row = await banProductAccount(e, mt[1], optionalNotes(b.detail, 'detail', 1000), actorEmail);
    return Response.json({ account: publicProductAccount(row) });
  }
  mt = resource.match(/^product-accounts\/([^/]+)\/replace$/);
  if (mt && m === 'POST') {
    const b = await body(req, 8 * 1024);
    rejectUnexpectedKeys(b, ['accountRef', 'notes']);
    const result = await replaceProductAccount(
      e, mt[1], accountRefField(b.accountRef), optionalNotes(b.notes), actorEmail,
    );
    return Response.json({
      previous: publicProductAccount(result.previous),
      account: publicProductAccount(result.current),
    });
  }
  mt = resource.match(/^product-accounts\/([^/]+)$/);
  if (mt && m === 'GET') {
    const row = await e.DB.prepare(
      `SELECT product_accounts.*, users.email
       FROM product_accounts
       LEFT JOIN users ON users.id = product_accounts.user_id
       WHERE product_accounts.id = ?`,
    ).bind(mt[1]).first<Row>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Product account not found');
    const events = await e.DB.prepare(
      'SELECT * FROM product_account_events WHERE account_id = ? ORDER BY at DESC LIMIT 50',
    ).bind(mt[1]).all<Row>();
    return Response.json({ account: publicProductAccount(row), events: events.results.map(publicProductEvent) });
  }

  if (resource === 'node-profiles' && m === 'GET') {
    const q = await e.DB.prepare(
      'SELECT * FROM ops_node_profiles ORDER BY status ASC, catalog_name ASC',
    ).all<Row>();
    return Response.json({ profiles: q.results.map(publicNodeProfile) });
  }
  if (resource === 'node-profiles' && m === 'POST') {
    const b = await body(req, 16 * 1024);
    rejectUnexpectedKeys(b, [
      'catalogName', 'publicIp', 'provider', 'billingUrl',
      'price', 'currency', 'billingCycle',
      'trafficQuotaBytes', 'trafficUsedBytes', 'trafficCycleStart', 'trafficCycleEnd',
      'cycleNetIn', 'cycleNetOut', 'renewsAt', 'notes', 'status',
    ]);
    const catalogName = str(b.catalogName, 'catalogName', 1, 200).trim();
    const publicIp = b.publicIp === undefined || b.publicIp === null || b.publicIp === ''
      ? null
      : optionalIpv4(b.publicIp, 'publicIp');
    const provider = optionalNotes(b.provider, 'provider', 80);
    const billingUrl = httpsUrlField(b.billingUrl, 'billingUrl');
    const profileId = id();
    const t = now();
    const status = b.status === undefined ? 'active' : str(b.status, 'status', 1, 20);
    if (!['active', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    try {
      await e.DB.prepare(
        `INSERT INTO ops_node_profiles(
           id, catalog_name, public_ip, provider, billing_url,
           price, currency, billing_cycle,
           traffic_quota_bytes, traffic_used_bytes, traffic_cycle_start, traffic_cycle_end,
           cycle_net_in, cycle_net_out, renews_at, notes, status, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        profileId, catalogName, publicIp, provider, billingUrl,
        optionalMoney(b.price, 'price'), optionalCurrency(b.currency), optionalBillingCycle(b.billingCycle),
        optionalByteCount(b.trafficQuotaBytes, 'trafficQuotaBytes'),
        optionalByteCount(b.trafficUsedBytes, 'trafficUsedBytes'),
        optionalUnix(b.trafficCycleStart, 'trafficCycleStart'),
        optionalUnix(b.trafficCycleEnd, 'trafficCycleEnd'),
        optionalByteCount(b.cycleNetIn, 'cycleNetIn'),
        optionalByteCount(b.cycleNetOut, 'cycleNetOut'),
        optionalUnix(b.renewsAt, 'renewsAt'),
        optionalNotes(b.notes),
        status, t, t,
      ).run();
    } catch {
      throw new ApiError(409, 'NODE_PROFILE_EXISTS', 'A profile with this catalog name already exists');
    }
    await writeOpsAudit(e, actorEmail, 'node.create', 'node_profile', profileId, catalogName);
    const row = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(profileId).first<Row>();
    return Response.json({ profile: publicNodeProfile(row!) }, { status: 201 });
  }
  mt = resource.match(/^node-profiles\/([^/]+)$/);
  if (mt && m === 'PUT') {
    const b = await body(req, 16 * 1024);
    rejectUnexpectedKeys(b, [
      'catalogName', 'publicIp', 'provider', 'billingUrl',
      'price', 'currency', 'billingCycle',
      'trafficQuotaBytes', 'trafficUsedBytes', 'trafficCycleStart', 'trafficCycleEnd',
      'cycleNetIn', 'cycleNetOut', 'renewsAt', 'notes', 'status',
    ]);
    const existing = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(mt[1]).first<Row>();
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Node profile not found');
    const catalogName = b.catalogName === undefined
      ? String(existing.catalog_name)
      : str(b.catalogName, 'catalogName', 1, 200).trim();
    const status = b.status === undefined ? String(existing.status) : str(b.status, 'status', 1, 20);
    if (!['active', 'retired'].includes(status)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
    }
    try {
      await e.DB.prepare(
        `UPDATE ops_node_profiles SET
           catalog_name = ?, public_ip = ?, provider = ?, billing_url = ?,
           price = ?, currency = ?, billing_cycle = ?,
           traffic_quota_bytes = ?, traffic_used_bytes = ?,
           traffic_cycle_start = ?, traffic_cycle_end = ?,
           cycle_net_in = ?, cycle_net_out = ?, renews_at = ?,
           notes = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        catalogName,
        b.publicIp === undefined
          ? (existing.public_ip == null ? null : String(existing.public_ip))
          : (b.publicIp === null || b.publicIp === '' ? null : optionalIpv4(b.publicIp, 'publicIp')),
        b.provider === undefined
          ? (existing.provider == null ? null : String(existing.provider))
          : optionalNotes(b.provider, 'provider', 80),
        b.billingUrl === undefined
          ? (existing.billing_url == null ? null : String(existing.billing_url))
          : httpsUrlField(b.billingUrl, 'billingUrl'),
        b.price === undefined
          ? (existing.price == null ? null : Number(existing.price))
          : optionalMoney(b.price, 'price'),
        b.currency === undefined
          ? (existing.currency == null ? null : String(existing.currency))
          : optionalCurrency(b.currency),
        b.billingCycle === undefined
          ? (existing.billing_cycle == null ? null : Number(existing.billing_cycle))
          : optionalBillingCycle(b.billingCycle),
        b.trafficQuotaBytes === undefined
          ? (existing.traffic_quota_bytes == null ? null : Number(existing.traffic_quota_bytes))
          : optionalByteCount(b.trafficQuotaBytes, 'trafficQuotaBytes'),
        b.trafficUsedBytes === undefined
          ? (existing.traffic_used_bytes == null ? null : Number(existing.traffic_used_bytes))
          : optionalByteCount(b.trafficUsedBytes, 'trafficUsedBytes'),
        b.trafficCycleStart === undefined
          ? (existing.traffic_cycle_start == null ? null : Number(existing.traffic_cycle_start))
          : optionalUnix(b.trafficCycleStart, 'trafficCycleStart'),
        b.trafficCycleEnd === undefined
          ? (existing.traffic_cycle_end == null ? null : Number(existing.traffic_cycle_end))
          : optionalUnix(b.trafficCycleEnd, 'trafficCycleEnd'),
        b.cycleNetIn === undefined
          ? (existing.cycle_net_in == null ? null : Number(existing.cycle_net_in))
          : optionalByteCount(b.cycleNetIn, 'cycleNetIn'),
        b.cycleNetOut === undefined
          ? (existing.cycle_net_out == null ? null : Number(existing.cycle_net_out))
          : optionalByteCount(b.cycleNetOut, 'cycleNetOut'),
        b.renewsAt === undefined
          ? (existing.renews_at == null ? null : Number(existing.renews_at))
          : optionalUnix(b.renewsAt, 'renewsAt'),
        b.notes === undefined
          ? (existing.notes == null ? null : String(existing.notes))
          : optionalNotes(b.notes),
        status,
        now(),
        mt[1],
      ).run();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, 'NODE_PROFILE_EXISTS', 'A profile with this catalog name already exists');
    }
    await writeOpsAudit(e, actorEmail, 'node.update', 'node_profile', mt[1], catalogName);
    const row = await e.DB.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(mt[1]).first<Row>();
    return Response.json({ profile: publicNodeProfile(row!) });
  }

  if (resource === 'audit' && m === 'GET') {
    // Plain newest-100 without params, exactly as before; the filters exist so
    // an operator can follow one target or actor back past the first page
    // instead of the log stopping at whatever happened most recently.
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get('limit');
    let limit = 100;
    if (rawLimit !== null) {
      limit = Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid limit');
      }
    }
    const rawBefore = params.get('before');
    let before: number | null = null;
    if (rawBefore !== null) {
      before = Number(rawBefore);
      if (!Number.isSafeInteger(before) || before <= 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid before');
      }
    }
    // A second is not unique — a PATCH that resets usage and changes a field
    // writes two rows in the same one — so paging on the timestamp alone drops
    // whichever of them did not fit on the page. `beforeId` carries the rest of
    // the cursor; `before` on its own still means what it always did.
    const rawBeforeId = params.get('beforeId');
    let beforeId: string | null = null;
    if (rawBeforeId !== null) {
      if (before === null || !/^.{1,100}$/.test(rawBeforeId)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid beforeId');
      }
      beforeId = rawBeforeId;
    }
    const targetId = params.get('targetId');
    const actorEmail = params.get('actorEmail');
    // The two equality filters are spliced in rather than guarded by a bound
    // flag: one plan is compiled for every binding, and `? = 0 OR target_id = ?`
    // can never reach an index on `target_id`, so following one customer back
    // through the log would read all of it.
    const filters = [
      ...(targetId === null ? [] : ['AND target_id = ?']),
      ...(actorEmail === null ? [] : ['AND actor_email = ?']),
    ].join('\n         ');
    const q = await e.DB.prepare(
      `SELECT * FROM ops_audit
       WHERE (? = 0 OR at < ? OR (? = 1 AND at = ? AND id < ?))
         ${filters}
       ORDER BY at DESC, id DESC LIMIT ?`,
    ).bind(...[
      before === null ? 0 : 1, before ?? 0,
      beforeId === null ? 0 : 1, before ?? 0, beforeId ?? '',
      ...(targetId === null ? [] : [targetId]),
      ...(actorEmail === null ? [] : [actorEmail]),
      limit + 1,
    ]).all<Row>();
    const hasMore = q.results.length > limit;
    const rows = hasMore ? q.results.slice(0, limit) : q.results;
    const last = rows.length ? rows[rows.length - 1] : null;
    return Response.json({
      entries: rows.map((row) => ({
        id: String(row.id),
        at: Number(row.at),
        actorEmail: String(row.actor_email),
        action: String(row.action),
        targetType: String(row.target_type),
        targetId: row.target_id == null ? null : String(row.target_id),
        summary: String(row.summary),
      })),
      hasMore,
      nextBefore: hasMore && last ? Number(last.at) : null,
      nextBeforeId: hasMore && last ? String(last.id) : null,
    });
  }

  return null;
}
