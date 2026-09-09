type Row = Record<string, any>;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length ? s : null;
}

export type CustomerStatus = {
  userId: string;
  deviceId: string | null;
  platform: string | null;
  appVersion: string | null;
  osVersion: string | null;
  uiState: string | null;
  connected: boolean;
  connectedSince: number | null;
  selectedServer: string | null;
  catalogRevision: number | null;
  lastSeenAt: number | null;
  lastWindowId: string | null;
  edgeAsn: number | null;
  edgeAsOrg: string | null;
  edgeCountry: string | null;
  edgeRegion: string | null;
  lastFailAt: number | null;
  lastFailCode: string | null;
  lastFailNode: string | null;
  fails30m: number;
  updatedAt: number;
};

export type ActivityHour = {
  userId: string;
  deviceId: string;
  hourAt: number;
  onlineMinutes: number;
  connectedMinutes: number;
  bytesUp: number;
  bytesDown: number;
  node: string | null;
  appVersion: string | null;
  platform: string | null;
  windows: number;
};

export type CustomerSession = {
  id: string;
  userId: string;
  deviceId: string | null;
  kind: string;
  at: number;
  source: string | null;
  detail: string | null;
};

function statusFromRow(row: Row): CustomerStatus {
  return {
    userId: String(row.user_id),
    deviceId: text(row.device_id),
    platform: text(row.platform),
    appVersion: text(row.app_version),
    osVersion: text(row.os_version),
    uiState: text(row.ui_state),
    connected: Number(row.connected) === 1,
    connectedSince: finite(row.connected_since),
    selectedServer: text(row.selected_server),
    catalogRevision: finite(row.catalog_revision),
    lastSeenAt: finite(row.last_seen_at),
    lastWindowId: text(row.last_window_id),
    edgeAsn: finite(row.edge_asn),
    edgeAsOrg: text(row.edge_as_org),
    edgeCountry: text(row.edge_country),
    edgeRegion: text(row.edge_region),
    lastFailAt: finite(row.last_fail_at),
    lastFailCode: text(row.last_fail_code),
    lastFailNode: text(row.last_fail_node),
    fails30m: finite(row.fails_30m) ?? 0,
    updatedAt: finite(row.updated_at) ?? 0,
  };
}

export async function customerStatus(
  db: D1Database,
  userId: string,
): Promise<CustomerStatus | null> {
  try {
    const row = await db.prepare(
      'SELECT * FROM ops_customer_status WHERE user_id = ?',
    ).bind(userId).first<Row>();
    return row ? statusFromRow(row) : null;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export async function activityHours(
  db: D1Database,
  userId: string,
  range: { fromSec: number; toSec: number },
): Promise<ActivityHour[]> {
  try {
    const rows = await db.prepare(
      `SELECT user_id, device_id, hour_at, online_minutes, connected_minutes,
              bytes_up, bytes_down, node, app_version, platform, windows
       FROM customer_activity_hours
       WHERE user_id = ? AND hour_at >= ? AND hour_at < ?
       ORDER BY hour_at ASC, device_id ASC`,
    ).bind(userId, range.fromSec, range.toSec).all<Row>();
    return (rows.results ?? []).map((row) => ({
      userId: String(row.user_id),
      deviceId: String(row.device_id ?? ''),
      hourAt: Number(row.hour_at),
      onlineMinutes: Number(row.online_minutes) || 0,
      connectedMinutes: Number(row.connected_minutes) || 0,
      bytesUp: Number(row.bytes_up) || 0,
      bytesDown: Number(row.bytes_down) || 0,
      node: text(row.node),
      appVersion: text(row.app_version),
      platform: text(row.platform),
      windows: Number(row.windows) || 0,
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function sessionsFor(
  db: D1Database,
  userId: string,
  page: { cursor?: { at: number; id: string } | null; limit?: number | null } = {},
): Promise<CustomerSession[]> {
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
  const cursor = page.cursor ?? null;
  try {
    const rows = await db.prepare(
      `SELECT id, user_id, device_id, kind, at, source, detail
       FROM customer_sessions
       WHERE user_id = ?
         AND (
           ? = 0
           OR at < ?
           OR (at = ? AND id < ?)
         )
       ORDER BY at DESC, id DESC
       LIMIT ?`,
    ).bind(
      userId,
      cursor ? 1 : 0,
      cursor?.at ?? 0,
      cursor?.at ?? 0,
      cursor?.id ?? '',
      limit,
    ).all<Row>();
    return (rows.results ?? []).map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      deviceId: text(row.device_id),
      kind: String(row.kind),
      at: Number(row.at),
      source: text(row.source),
      detail: text(row.detail),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}
