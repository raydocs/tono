const DETAIL_LIMIT = 300;
const DEFAULT_RETAIN_DAYS = 400;
const DEFAULT_RETAIN_LIMIT = 500;
const SESSION_KINDS = [
  'login', 'logout', 'device_registered', 'device_revoked',
  'credential_rotated', 'session_expired',
] as const;

export type SessionKind = typeof SESSION_KINDS[number];

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.length ? value : null;
}

export async function recordSession(
  db: D1Database,
  input: {
    userId: string;
    deviceId?: string | null;
    kind: SessionKind;
    at: number;
    source?: string | null;
    detail?: string | null;
    id?: string | null;
  },
): Promise<string | null> {
  if (!SESSION_KINDS.includes(input.kind)) return null;
  const userId = text(input.userId);
  if (!userId) return null;
  const id = text(input.id) ?? crypto.randomUUID();
  const detail = input.detail == null ? null : String(input.detail).slice(0, DETAIL_LIMIT);
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO customer_sessions (
         id, user_id, device_id, kind, at, source, detail
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, userId, text(input.deviceId ?? null), input.kind, input.at,
      text(input.source ?? null), detail,
    ).run();
    return id;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

async function backfillKind(db: D1Database, sql: string, remaining: number): Promise<number> {
  if (remaining <= 0) return 0;
  const result = await db.prepare(sql).bind(remaining).run();
  return Number(result.meta.changes) || 0;
}

export async function backfillSessionsFromTables(db: D1Database, limit = 200): Promise<number> {
  const cap = Math.min(Math.max(limit, 1), 1000);
  try {
    let inserted = 0;
    inserted += await backfillKind(db, `
      INSERT INTO customer_sessions (id, user_id, device_id, kind, at, source, detail)
      SELECT 'login:' || sessions.id, sessions.user_id, sessions.device_id,
             'login', sessions.created_at, 'sessions', NULL
      FROM sessions
      WHERE NOT EXISTS (
        SELECT 1 FROM customer_sessions existing WHERE existing.id = 'login:' || sessions.id
      )
      ORDER BY sessions.created_at ASC, sessions.id ASC
      LIMIT ?`, cap);
    inserted += await backfillKind(db, `
      INSERT INTO customer_sessions (id, user_id, device_id, kind, at, source, detail)
      SELECT 'device_registered:' || devices.id, devices.user_id, devices.id,
             'device_registered', COALESCE(devices.confirmed_at, devices.created_at),
             'devices', NULL
      FROM devices
      WHERE NOT EXISTS (
        SELECT 1 FROM customer_sessions existing
        WHERE existing.id = 'device_registered:' || devices.id
      )
      ORDER BY COALESCE(devices.confirmed_at, devices.created_at) ASC, devices.id ASC
      LIMIT ?`, cap - inserted);
    inserted += await backfillKind(db, `
      INSERT INTO customer_sessions (id, user_id, device_id, kind, at, source, detail)
      SELECT 'device_revoked:' || devices.id, devices.user_id, devices.id,
             'device_revoked', COALESCE(devices.updated_at, devices.created_at),
             'devices', NULL
      FROM devices
      WHERE devices.status = 'revoked'
        AND NOT EXISTS (
          SELECT 1 FROM customer_sessions existing
          WHERE existing.id = 'device_revoked:' || devices.id
        )
      ORDER BY COALESCE(devices.updated_at, devices.created_at) ASC, devices.id ASC
      LIMIT ?`, cap - inserted);
    return inserted;
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}

async function retainRows(db: D1Database, sql: string, cutoff: number, limit: number): Promise<number> {
  try {
    const result = await db.prepare(sql).bind(cutoff, cutoff, limit).run();
    return Number(result.meta.changes) || 0;
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}

export async function retainActivityHours(
  db: D1Database,
  nowSec: number,
  days = DEFAULT_RETAIN_DAYS,
  limit = DEFAULT_RETAIN_LIMIT,
): Promise<number> {
  const cutoff = nowSec - days * 86400;
  return retainRows(
    db,
    `DELETE FROM customer_activity_hours
     WHERE hour_at < ?
       AND rowid IN (
         SELECT rowid FROM customer_activity_hours
         WHERE hour_at < ? ORDER BY hour_at ASC LIMIT ?
       )`,
    cutoff,
    limit,
  );
}

export async function retainSessions(
  db: D1Database,
  nowSec: number,
  days = DEFAULT_RETAIN_DAYS,
  limit = DEFAULT_RETAIN_LIMIT,
): Promise<number> {
  const cutoff = nowSec - days * 86400;
  return retainRows(
    db,
    `DELETE FROM customer_sessions
     WHERE at < ?
       AND rowid IN (
         SELECT rowid FROM customer_sessions
         WHERE at < ? ORDER BY at ASC, id ASC LIMIT ?
       )`,
    cutoff,
    limit,
  );
}
