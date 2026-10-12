// Exit credential roster served to exit nodes and its per-device label.
// Moved verbatim from index.ts; this module never imports index.ts back.

import { type Env, type Row } from './env';
import { exitCredentialRolloutPhase } from './catalog';
import { backfillDeviceExitCredentials } from './ops/shared-admin';

export const sha256Hex = async (value: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function exitCredentialRoster(e: Env, timestamp: number) {
  await backfillDeviceExitCredentials(e);
  const phase = await exitCredentialRolloutPhase(e);
  const legacyUnion = phase === 'dual'
    ? `UNION
       SELECT credentials.user_id AS user_id, NULL AS device_id,
              credentials.client_uuid AS client_uuid
         FROM exit_credentials credentials
         JOIN users ON users.id = credentials.user_id
        WHERE credentials.retired_at IS NULL AND users.status = 'active'
          AND (users.expires_at IS NULL OR users.expires_at > ?)
          AND (users.quota_bytes IS NULL OR users.usage_bytes < users.quota_bytes)
          AND (
            NOT EXISTS (SELECT 1 FROM devices WHERE devices.user_id = users.id)
            OR EXISTS (
              SELECT 1 FROM devices
              WHERE devices.user_id = users.id
                AND devices.status IN ('pending', 'active')
            )
          )`
    : '';
  const rows = await e.DB.prepare(
    `SELECT credentials.user_id AS user_id, credentials.device_id AS device_id,
            credentials.client_uuid AS client_uuid
       FROM device_exit_credentials credentials
       JOIN devices ON devices.id = credentials.device_id
       JOIN users ON users.id = devices.user_id
      WHERE devices.status IN ('pending', 'active')
        AND users.status = 'active'
        AND (users.expires_at IS NULL OR users.expires_at > ?)
        AND (users.quota_bytes IS NULL OR users.usage_bytes < users.quota_bytes)
     ${legacyUnion}
      ORDER BY user_id, device_id`,
  ).bind(...(phase === 'dual' ? [timestamp, timestamp] : [timestamp])).all<Row>();
  return { rows: rows.results, retireSharedLegacy: phase === 'device_only' };
}

export async function exitCredentialLabel(userId: string, deviceId: string | null, clientUUID: string) {
  if (!deviceId) return `u:${userId}`;
  return `u:${userId}:${deviceId}:${await sha256Hex(clientUUID)}`;
}
