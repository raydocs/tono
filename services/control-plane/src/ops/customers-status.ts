// Per-device live status, then a customer row derived from every device.
// Last-window-wins on ops_customer_status is how a healthy Mac hid a
// failing Windows; this file is the replacement write path.

import { sniffPlatform } from './platform';
import {
  FAIL_WINDOW_SECONDS,
  decayFails30m,
  finite,
  loadDevices,
  missingTable,
  text,
  upsertCustomer,
  upsertDeviceFromFailure,
  upsertDeviceFromWindow,
  writeCustomerFromDevices,
} from './customers-device';

type Row = Record<string, any>;

export type TelemetryWindowInput = {
  id: string;
  user_id: string;
  device_id?: string | null;
  received_at: number;
  client_version?: string | null;
  os_version?: string | null;
  payload?: unknown;
  payload_json?: unknown;
  window_start_ms?: number | null;
  window_end_ms?: number | null;
};

export type CustomerEdge = {
  asn?: number | null;
  asOrg?: string | null;
  country?: string | null;
  region?: string | null;
};

function payloadOf(window: TelemetryWindowInput): Row {
  const raw = window.payload ?? window.payload_json;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Row : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Row;
  return {};
}

function eventTsSec(ts: number): number {
  return ts >= 1_000_000_000_000 ? Math.floor(ts / 1000) : ts;
}

type FailEvent = { tsSec: number; code: string | null; node: string | null; attemptId: string | null };

function connectFails(payload: Row): FailEvent[] {
  if (!Array.isArray(payload.events)) return [];
  const out: FailEvent[] = [];
  for (const raw of payload.events) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const event = raw as Row;
    if (event.kind !== 'connectFail') continue;
    const ts = finite(event.ts);
    if (ts === null || ts < 0) continue;
    const attemptId = text(event.attemptId);
    out.push({
      tsSec: eventTsSec(ts),
      code: text(event.code),
      node: text(event.node),
      attemptId: attemptId && attemptId.length <= 64 ? attemptId : null,
    });
  }
  return out;
}

function failsInWindow(fails: FailEvent[], receivedAt: number): FailEvent[] {
  const cutoff = receivedAt - FAIL_WINDOW_SECONDS;
  return fails.filter((event) => event.tsSec >= cutoff && event.tsSec <= receivedAt);
}

async function knownFailureAttempts(
  db: D1Database,
  userId: string,
  attemptIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(attemptIds.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const placeholders = unique.map(() => '?').join(', ');
  try {
    const rows = await db.prepare(
      `SELECT attempt_id FROM connection_events
       WHERE user_id = ? AND source = 'failure' AND attempt_id IN (${placeholders})`,
    ).bind(userId, ...unique).all<{ attempt_id: string }>();
    return new Set((rows.results ?? []).map((row) => String(row.attempt_id)));
  } catch (error) {
    if (missingTable(error) || String(error).includes('no such column')) return new Set();
    throw error;
  }
}

function connectedSinceOf(prev: Row | null, connected: number, nowSec: number): number | null {
  const same = Boolean(prev && Number(prev.connected) === 1 && connected === 1);
  if (connected === 1) return same ? Number(prev!.connected_since) : nowSec;
  return prev?.connected_since == null ? null : Number(prev.connected_since);
}

export async function applyWindowToStatus(
  db: D1Database,
  window: TelemetryWindowInput,
  edge: CustomerEdge | null | undefined,
  nowSec: number,
): Promise<void> {
  const userId = text(window.user_id);
  if (!userId) return;
  const payload = payloadOf(window);
  const receivedAt = finite(window.received_at);
  if (receivedAt === null) return;
  const deviceId = text(window.device_id);
  const osVersion = text(window.os_version);
  const uiState = text(payload.uiState);
  const connected = uiState === 'connected' ? 1 : 0;
  const allFails = failsInWindow(connectFails(payload), receivedAt);
  const known = await knownFailureAttempts(
    db, userId, allFails.map((event) => event.attemptId).filter((id): id is string => id != null),
  );
  const fails = allFails.filter((event) => !event.attemptId || !known.has(event.attemptId));
  const latestFail = allFails.reduce<FailEvent | null>(
    (best, event) => (!best || event.tsSec > best.tsSec ? event : best),
    null,
  );
  const extras = {
    uiState,
    catalogRevision: finite(payload.catalogRevision),
    edge,
    windowId: window.id,
    windowReceivedAt: receivedAt,
  };

  try {
    if (deviceId) {
      const prev = await db.prepare(
        'SELECT * FROM ops_device_status WHERE user_id = ? AND device_id = ?',
      ).bind(userId, deviceId).first<Row>();
      if (prev && String(prev.last_window_id) === window.id) return;
      if (prev && finite(prev.last_seen_at) !== null && Number(prev.last_seen_at) > receivedAt) {
        return;
      }
      const elapsed = prev && finite(prev.last_seen_at) !== null
        ? receivedAt - Number(prev.last_seen_at)
        : FAIL_WINDOW_SECONDS;
      await upsertDeviceFromWindow(db, {
        userId, deviceId,
        platform: sniffPlatform(osVersion),
        appVersion: text(window.client_version),
        osVersion,
        selectedServer: text(payload.selectedServer),
        connected,
        connectedSince: connectedSinceOf(prev, connected, nowSec),
        receivedAt,
        windowId: window.id,
        exitDelayMs: finite(payload.exitDelayMs),
        tcpDelayMs: finite(payload.tcpDelayMs),
        lastFailAt: latestFail?.tsSec ?? null,
        lastFailCode: latestFail?.code ?? null,
        lastFailNode: latestFail?.node ?? null,
        fails30m: decayFails30m(Number(prev?.fails_30m) || 0, elapsed) + fails.length,
        nowSec,
      });
      await writeCustomerFromDevices(db, userId, await loadDevices(db, userId), nowSec, extras);
      return;
    }

    const prev = await db.prepare(
      'SELECT * FROM ops_customer_status WHERE user_id = ?',
    ).bind(userId).first<Row>();
    if (prev && String(prev.last_window_id) === window.id) return;
    if (prev && finite(prev.last_seen_at) !== null && Number(prev.last_seen_at) > receivedAt) {
      return;
    }
    const devices = await loadDevices(db, userId);
    if (devices.length > 0) {
      await writeCustomerFromDevices(db, userId, devices, nowSec, extras);
      return;
    }
    const elapsed = prev && finite(prev.last_seen_at) !== null
      ? receivedAt - Number(prev.last_seen_at)
      : FAIL_WINDOW_SECONDS;
    await upsertCustomer(db, {
      userId, deviceId, platform: sniffPlatform(osVersion),
      appVersion: text(window.client_version), osVersion, uiState, connected,
      connectedSince: connectedSinceOf(prev, connected, nowSec),
      selectedServer: text(payload.selectedServer),
      catalogRevision: finite(payload.catalogRevision),
      lastSeenAt: receivedAt, lastWindowId: window.id,
      edgeAsn: finite(edge?.asn), edgeAsOrg: text(edge?.asOrg ?? null),
      edgeCountry: text(edge?.country ?? null), edgeRegion: text(edge?.region ?? null),
      lastFailAt: latestFail?.tsSec ?? null, lastFailCode: latestFail?.code ?? null,
      lastFailNode: latestFail?.node ?? null,
      fails30m: decayFails30m(Number(prev?.fails_30m) || 0, elapsed) + fails.length,
      updatedAt: nowSec,
    });
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

export async function applyFailureToStatus(
  db: D1Database,
  input: {
    userId: string;
    deviceId: string | null;
    code: string;
    node: string;
    nowSec: number;
    platform?: string | null;
    appVersion?: string | null;
    osVersion?: string | null;
    tcpDelayMs?: number | null;
    exitDelayMs?: number | null;
  },
): Promise<void> {
  const userId = text(input.userId);
  if (!userId) return;
  const deviceId = text(input.deviceId);
  const t = input.nowSec;
  try {
    if (deviceId) {
      await upsertDeviceFromFailure(db, {
        userId, deviceId, nowSec: t, code: input.code, node: input.node,
        platform: text(input.platform ?? null),
        appVersion: text(input.appVersion ?? null),
        osVersion: text(input.osVersion ?? null),
        tcpDelayMs: input.tcpDelayMs ?? null,
        exitDelayMs: input.exitDelayMs ?? null,
      });
      await writeCustomerFromDevices(db, userId, await loadDevices(db, userId), t);
      return;
    }
    await db.prepare(
      `INSERT INTO ops_customer_status (
         user_id, last_fail_at, last_fail_code, last_fail_node, fails_30m, updated_at, connected
       ) VALUES (?, ?, ?, ?, 1, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET
         last_fail_at = excluded.last_fail_at,
         last_fail_code = excluded.last_fail_code,
         last_fail_node = excluded.last_fail_node,
         fails_30m = CASE
           WHEN ops_customer_status.last_fail_at IS NOT NULL
            AND excluded.last_fail_at - ops_customer_status.last_fail_at < 1800
           THEN ops_customer_status.fails_30m + 1
           ELSE 1
         END,
         updated_at = excluded.updated_at`,
    ).bind(userId, t, input.code, input.node, t).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}
