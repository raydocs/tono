import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
  now,
  id,
  str,
} from '../../env';
import {
  writeOpsAudit,
} from '../../product-account';
import { rejectUnexpectedKeys, body } from '../../request';

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

export async function deviceActionsResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
  deps: {
    revokeDevice: (e: Env, d: Row, requireIneligibleUser?: boolean) => Promise<void>;
    processRevocations: (e: Env) => Promise<void>;
    publicAdministrativeAction: (row: Row) => ReturnType<typeof publicAction>;
  },
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
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
  return null;
}
