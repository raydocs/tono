import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
  id,
  now,
} from '../../env';
import {
  opsAuditStatement,
  writeOpsAudit,
} from '../../product-account';
import { rejectUnexpectedKeys, body } from '../../request';
import { DIAGNOSTICS_LOG_ACCESS_MAX_SECONDS } from '../../diagnostics-limits';
import type { LogWindowDto } from '../contract/customers';

function windowDetail(windowId: string, objectKey: string | null, note?: string): string {
  const key = objectKey && objectKey.length > 0 ? objectKey : '-';
  const text = note
    ? `window:${windowId} key:${key} ${note}`
    : `window:${windowId} key:${key}`;
  return text.slice(0, 500);
}

function windowIdFromSummary(summary: string): string | null {
  const match = summary.match(/^window:(\S+)/);
  return match ? match[1] : null;
}

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

export async function loadLogWindows(db: D1Database, userId: string): Promise<LogWindowDto[]> {
  try {
    const access = await db.prepare(
      `SELECT device_id, created_at, expires_at
       FROM diagnostics_log_access WHERE user_id = ?
       ORDER BY created_at DESC`,
    ).bind(userId).all<Row>();
    const rows = access.results ?? [];
    if (rows.length === 0) return [];
    const audits = await db.prepare(
      `SELECT action, actor_email, summary
       FROM ops_audit
       WHERE target_id = ?
         AND action IN ('diagnostics.window.open', 'diagnostics.window.read')
       ORDER BY at DESC`,
    ).bind(userId).all<Row>();
    const openedBy = new Map<string, string>();
    const reads = new Map<string, number>();
    for (const row of audits.results ?? []) {
      const windowId = windowIdFromSummary(String(row.summary ?? ''));
      if (!windowId) continue;
      if (String(row.action) === 'diagnostics.window.open') {
        if (!openedBy.has(windowId)) openedBy.set(windowId, String(row.actor_email));
      } else {
        reads.set(windowId, (reads.get(windowId) ?? 0) + 1);
      }
    }
    return rows.map((row) => {
      const windowId = String(row.device_id);
      return {
        id: windowId,
        openedBy: openedBy.get(windowId) ?? null,
        openedAt: Number(row.created_at),
        expiresAt: Number(row.expires_at),
        reads: reads.get(windowId) ?? 0,
      };
    });
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function closeExpiredLogWindows(
  db: D1Database,
  nowSec: number,
  limit = 500,
): Promise<void> {
  try {
    const found = await db.prepare(
      `SELECT device_id, user_id FROM diagnostics_log_access
       WHERE expires_at < ? ORDER BY expires_at ASC LIMIT ?`,
    ).bind(nowSec, limit).all<Row>();
    const rows = found.results ?? [];
    if (rows.length === 0) return;
    const chunk = 10;
    for (let i = 0; i < rows.length; i += chunk) {
      const statements = [];
      for (const row of rows.slice(i, i + chunk)) {
        const windowId = String(row.device_id);
        const userId = String(row.user_id);
        statements.push(
          db.prepare(
            'DELETE FROM diagnostics_log_access WHERE device_id = ? AND user_id = ?',
          ).bind(windowId, userId),
          db.prepare(
            `INSERT INTO ops_audit(
               id, at, actor_email, action, target_type, target_id, summary,
               actor_type, actor_role, request_id
             ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`,
          ).bind(
            id(), nowSec, 'system', 'diagnostics.window.close', 'user', userId,
            windowDetail(windowId, null, 'expired'), 'system', 'owner', null,
          ),
        );
      }
      await db.batch(statements);
    }
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

function publicLogSegment(row: Row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    deviceId: row.device_id == null ? undefined : String(row.device_id),
    sessionId: String(row.session_id),
    sequence: Number(row.sequence),
    byteSize: Number(row.byte_size),
    lineCount: Number(row.line_count),
    receivedAt: Number(row.received_at),
    clientVersion: String(row.client_version),
    osVersion: String(row.os_version),
  };
}

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
      const detail = windowDetail(mt[2], null);
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
        opsAuditStatement(
          e,
          actorEmail,
          'diagnostics.window.open',
          'user',
          mt[1],
          detail,
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
      const detail = windowDetail(mt[2], null);
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
        opsAuditStatement(
          e,
          actorEmail,
          'diagnostics.window.close',
          'user',
          mt[1],
          detail,
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
  if (resource === 'diagnostics/logs' && m === 'GET') {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null
      ? 200
      : Math.min(Math.max(Number(limitRaw) || 0, 1), 1000);
    const rows = userId
      ? await e.DB.prepare(
        `SELECT * FROM diagnostics_log_objects WHERE user_id = ?
           ORDER BY received_at DESC LIMIT ?`,
      ).bind(userId, limit).all<Row>()
      : await e.DB.prepare(
        `SELECT * FROM diagnostics_log_objects
           ORDER BY received_at DESC LIMIT ?`,
      ).bind(limit).all<Row>();
    return Response.json({
      segments: rows.results.map(publicLogSegment),
    });
  }
  mt = resource.match(/^diagnostics\/logs\/([^/]+)$/);
  if (mt && m === 'GET') {
    const row = await e.DB.prepare(
      `SELECT user_id, device_id, r2_key, session_id, sequence
       FROM diagnostics_log_objects WHERE id = ?`,
    ).bind(mt[1]).first<Row>();
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Log segment not found');
    const object = await e.DIAGNOSTICS_LOGS.get(String(row.r2_key));
    // The index outlives a bucket lifecycle rule or a partial retention
    // sweep, so a missing object is an expected 404 rather than a 500.
    if (!object) throw new ApiError(404, 'NOT_FOUND', 'Log segment payload is gone');
    const windowId = row.device_id == null ? mt[1] : String(row.device_id);
    await writeOpsAudit(
      e,
      actorEmail,
      'diagnostics.window.read',
      'user',
      String(row.user_id),
      windowDetail(windowId, String(row.r2_key)),
    );
    const name = `${row.session_id}-${String(row.sequence).padStart(7, '0')}.jsonl.gz`;
    return new Response(object.body, {
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      },
    });
  }
  return null;
}
