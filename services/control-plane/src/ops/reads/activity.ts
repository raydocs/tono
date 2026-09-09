import {
  type Env,
  type Row,
  now,
} from '../../env';
import { TELEMETRY_MAX_REPORTED_AT_MS } from '../../limits';
import {
  operationsLive,
  nodeHealthFromQuality,
} from '../live';
import type { OpsRequestCache } from '../cache';

// Per-user liveness from periodic telemetry windows (≈20 min client cadence).
// A user is "online" when their latest window is fresher than two cadences.
export const ACTIVITY_ONLINE_SECONDS = 40 * 60;
// How far back the activity ranking looks. This is a liveness view, not
// history: ranking all thirty retained days on every fifteen-second poll is
// what made the endpoint a full-table window scan. A day keeps "seen this
// morning" visible while letting the received_at index skip the rest.
const ACTIVITY_SCAN_SECONDS = 24 * 3600;

function optionalTelemetryInt(payload: Row, key: string, min: number, max: number): number | null {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

export function telemetryPathFields(payload: Row, receivedAtSec: number) {
  const receivedAtMs = receivedAtSec * 1_000;
  // These timestamps come from the client clock. Keep the raw value in the
  // forensic payload, but never expose a measurement as happening after the
  // Worker received it: a laptop set to 2099 would otherwise keep one bad RTT
  // "fresh" for decades in the incident board.
  const sampleAt = (key: string) => {
    const value = optionalTelemetryInt(payload, key, 1, TELEMETRY_MAX_REPORTED_AT_MS);
    return value == null ? null : Math.min(value, receivedAtMs);
  };
  return {
    exitDelayMs: optionalTelemetryInt(payload, 'exitDelayMs', 1, 120_000),
    tcpDelayMs: optionalTelemetryInt(payload, 'tcpDelayMs', 1, 120_000),
    exitDelayAtMs: sampleAt('exitDelayAtMs'),
    tcpDelayAtMs: sampleAt('tcpDelayAtMs'),
  };
}

function qualityNodeByName(quality: { nodes: Row[] } | null, name: string | null): Row | null {
  if (!quality || !name) return null;
  return quality.nodes.find((node) => node.name === name) ?? null;
}

export function activityUser(row: Row, quality: { nodes: Row[] } | null, nowSec: number) {
  let payload: Row = {};
  try {
    payload = JSON.parse(String(row.payload_json));
  } catch {
    payload = {};
  }
  const lastSeenAt = Number(row.received_at);
  const selectedServer = typeof payload.selectedServer === 'string' ? payload.selectedServer : null;
  const health = nodeHealthFromQuality(qualityNodeByName(quality, selectedServer));
  return {
    userId: String(row.user_id),
    deviceId: row.device_id === null || row.device_id === undefined ? null : String(row.device_id),
    email: String(row.email),
    lastSeenAt,
    online: nowSec - lastSeenAt <= ACTIVITY_ONLINE_SECONDS,
    clientVersion: String(row.client_version),
    osVersion: String(row.os_version),
    selectedServer,
    uiState: typeof payload.uiState === 'string' ? payload.uiState : null,
    catalogRevision: typeof payload.catalogRevision === 'number' ? payload.catalogRevision : null,
    ...telemetryPathFields(payload, lastSeenAt),
    ...health,
  };
}

/**
 * Everyone whose latest telemetry window names this node, over the whole
 * telemetry retention rather than the activity view's one-day scan.
 *
 * Who loses an exit when it is retired is not a liveness question: a customer
 * who has not opened their laptop this week has still selected it and still
 * finds it gone. The day-bounded scan stays where it belongs — the online and
 * active lists — and this pays for the full window only when an operator asks
 * about one node.
 */
export async function operationsNodeSelections(e: Env, name: string, cache?: OpsRequestCache) {
  const live = await operationsLive(e, cache);
  const nowSec = now();
  // Rank ids only: those columns all live in the (user_id, device_id,
  // received_at, id) index, so the whole retention is ranked without touching a
  // row, and the payload is read and parsed once per device rather than once
  // per window.
  const rows = await e.DB.prepare(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (
                PARTITION BY user_id, COALESCE(device_id, '')
                ORDER BY received_at DESC, id DESC
              ) AS rank
       FROM telemetry_windows
     )
     SELECT t.id, t.user_id, t.device_id, t.received_at, t.client_version, t.os_version,
            t.payload_json, u.email
     FROM ranked
     JOIN telemetry_windows t ON t.id = ranked.id
     JOIN users u ON u.id = t.user_id
     WHERE ranked.rank = 1 AND json_extract(t.payload_json, '$.selectedServer') = ?
     ORDER BY t.received_at DESC, t.id DESC`,
  ).bind(name).all<Row>();
  return rows.results.map((row) => activityUser(row, live.quality, nowSec));
}

export async function loadOperationsActivity(e: Env, cache?: OpsRequestCache) {
  const live = await operationsLive(e, cache);
  const quality = live.quality;
  const nowSec = now();
  const rows = await e.DB.prepare(
    `WITH ranked AS (
       SELECT t.id, t.user_id, t.device_id, t.received_at, t.client_version, t.os_version,
              t.payload_json, u.email,
              ROW_NUMBER() OVER (
                PARTITION BY t.user_id, COALESCE(t.device_id, '')
                ORDER BY t.received_at DESC, t.id DESC
              ) AS rank
       FROM telemetry_windows t
       JOIN users u ON u.id = t.user_id
       WHERE t.received_at >= ?
     )
     SELECT id, user_id, device_id, received_at, client_version, os_version, payload_json, email
     FROM ranked
     WHERE rank = 1
     ORDER BY received_at DESC, id DESC`,
  ).bind(nowSec - ACTIVITY_SCAN_SECONDS).all<Row>();
  const users = rows.results.map((row) => activityUser(row, quality, nowSec));
  const onlineRows = users.filter((user) => user.online);
  // Pre-0019 windows carry no device id; fall back to per-user counting there.
  const onlineDevices = new Set(onlineRows.map(
    (user) => `${user.userId}:${user.deviceId ?? 'legacy'}`,
  )).size;
  return {
    onlineWindowSeconds: ACTIVITY_ONLINE_SECONDS,
    onlineUsers: new Set(onlineRows.map((user) => user.userId)).size,
    onlineDevices,
    users,
  };
}

export function operationsActivity(e: Env, cache?: OpsRequestCache) {
  if (!cache) return loadOperationsActivity(e);
  return cache.activity ??= loadOperationsActivity(e, cache);
}
