import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
  now,
} from '../../env';
import {
  opsAuditStatement,
} from '../../product-account';
import { rejectUnexpectedKeys, body } from '../../request';
import { DIAGNOSTICS_LOG_ACCESS_MAX_SECONDS } from '../../diagnostics-limits';

export async function diagnosticsLogsResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
): Promise<Response | null> {
  let mt: RegExpMatchArray | null;
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
  return null;
}
