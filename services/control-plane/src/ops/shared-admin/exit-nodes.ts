import {
  randomToken,
  sha256,
} from '../../crypto';
import { ApiError } from '../../errors';
import {
  CLIENT_UUID_PLACEHOLDER,
} from '../../catalog-yaml';
import {
  type Env,
  type Row,
  now,
  str,
} from '../../env';
import {
  publicManagedCatalog,
} from '../../catalog';
import {
  writeOpsAudit,
} from '../../product-account';
import { rejectUnexpectedKeys, body } from '../../request';

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

export async function exitNodesResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
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
  return null;
}
