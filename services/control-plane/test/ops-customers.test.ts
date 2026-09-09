import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  accrueActivityHours,
  activityHours,
  applyWindowToStatus,
  backfillSessionsFromTables,
  customerStatus,
  projectBacklog,
  recordSession,
  retainActivityHours,
  retainSessions,
  sessionsFor,
  sniffPlatform,
  type TelemetryWindowInput,
} from '../src/ops/customers';

const db = () => (env as unknown as { DB: D1Database }).DB;

const HOUR = 1_800_000_000; // UTC hour-aligned
const USER = 'u-360';
const DEVICE = 'd-360';

async function seedUser(id = USER, email = '360@example.com') {
  await db().prepare(
    `INSERT INTO users (id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES (?, ?, 'x', 'y', 'active', 0, 1, 1)`,
  ).bind(id, email).run();
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    uiState: 'connected',
    selectedServer: 'Salt Lake City · Summit',
    catalogRevision: 7,
    events: [] as unknown[],
    ...overrides,
  };
}

function windowInput(overrides: Partial<TelemetryWindowInput> & { payload?: unknown } = {}): TelemetryWindowInput {
  return {
    id: 'w-1',
    user_id: USER,
    device_id: DEVICE,
    received_at: HOUR + 60,
    client_version: '0.0.19',
    os_version: 'Windows 11 Pro 23H2',
    window_start_ms: (HOUR - 600) * 1000,
    window_end_ms: (HOUR + 600) * 1000,
    payload: payload(),
    ...overrides,
  };
}

async function insertTelemetry(input: TelemetryWindowInput) {
  const body = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload ?? {});
  await db().prepare(
    `INSERT INTO telemetry_windows (
       id, user_id, device_id, received_at, window_start_ms, window_end_ms,
       client_version, os_version, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id,
    input.user_id,
    input.device_id ?? null,
    input.received_at,
    input.window_start_ms,
    input.window_end_ms,
    input.client_version,
    input.os_version,
    body,
  ).run();
}

beforeEach(async () => {
  await db().prepare('DELETE FROM ops_customer_status').run();
  await db().prepare('DELETE FROM customer_activity_hours').run();
  await db().prepare('DELETE FROM customer_sessions').run();
  await db().prepare('DELETE FROM ops_customer_projection_cursor').run();
});

describe('sniffPlatform', () => {
  it('maps os_version strings to windows/macos/linux/android/ios', () => {
    expect(sniffPlatform('Windows 11 Pro 23H2')).toBe('windows');
    expect(sniffPlatform('macOS 15.1')).toBe('macos');
    expect(sniffPlatform('Ubuntu Linux 24.04')).toBe('linux');
    expect(sniffPlatform('Android 14')).toBe('android');
    expect(sniffPlatform('iOS 18.2')).toBe('ios');
    expect(sniffPlatform('mystery box')).toBeNull();
  });
});

describe('ops_customer_status upsert', () => {
  it('keeps last_seen on connected→disconnected and preserves connected_since on the same device', async () => {
    await seedUser();
    const t0 = HOUR + 10;
    const t1 = HOUR + 70;
    const t2 = HOUR + 130;

    await applyWindowToStatus(db(), windowInput({
      id: 'w-connect',
      received_at: t0,
      payload: payload({ uiState: 'connected' }),
    }), { asn: 13335, asOrg: 'Cloudflare', country: 'US', region: 'UT' }, t0 + 1);

    const connected = await customerStatus(db(), USER);
    expect(connected).toMatchObject({
      userId: USER,
      deviceId: DEVICE,
      platform: 'windows',
      appVersion: '0.0.19',
      connected: true,
      connectedSince: t0 + 1,
      lastSeenAt: t0,
      selectedServer: 'Salt Lake City · Summit',
      catalogRevision: 7,
      edgeAsn: 13335,
      edgeCountry: 'US',
      fails30m: 0,
    });

    await applyWindowToStatus(db(), windowInput({
      id: 'w-still',
      received_at: t1,
      payload: payload({ uiState: 'connected' }),
    }), null, t1 + 1);
    const still = await customerStatus(db(), USER);
    expect(still?.connected).toBe(true);
    expect(still?.connectedSince).toBe(t0 + 1);
    expect(still?.lastSeenAt).toBe(t1);
    expect(still?.edgeAsn).toBe(13335);

    await applyWindowToStatus(db(), windowInput({
      id: 'w-drop',
      received_at: t2,
      payload: payload({ uiState: 'notConnected' }),
    }), null, t2 + 1);
    const dropped = await customerStatus(db(), USER);
    expect(dropped?.connected).toBe(false);
    expect(dropped?.uiState).toBe('notConnected');
    expect(dropped?.lastSeenAt).toBe(t2);
    expect(dropped?.connectedSince).toBe(t0 + 1);
  });

  it('resets connected_since when the connected device changes', async () => {
    await seedUser();
    await applyWindowToStatus(db(), windowInput({
      id: 'w-a',
      device_id: 'd-a',
      received_at: HOUR,
      payload: payload({ uiState: 'connected' }),
    }), null, HOUR + 5);
    await applyWindowToStatus(db(), windowInput({
      id: 'w-b',
      device_id: 'd-b',
      received_at: HOUR + 20,
      payload: payload({ uiState: 'connected' }),
    }), null, HOUR + 25);
    const status = await customerStatus(db(), USER);
    expect(status?.deviceId).toBe('d-b');
    expect(status?.connectedSince).toBe(HOUR + 25);
  });

  it('counts connectFail events inside 30m and decays the previous fails_30m', async () => {
    await seedUser();
    const t0 = HOUR;
    await applyWindowToStatus(db(), windowInput({
      id: 'w-fail-1',
      received_at: t0,
      payload: payload({
        uiState: 'notConnected',
        events: [
          { ts: t0 * 1000 - 2_000, kind: 'connectFail', code: 'timeout', node: 'old' },
          { ts: t0 * 1000, kind: 'connectFail', code: 'tls', node: 'Salt Lake City · Summit' },
          { ts: (t0 - 2000) * 1000, kind: 'connectFail', code: 'stale', node: 'too-old' },
        ],
      }),
    }), null, t0);
    const first = await customerStatus(db(), USER);
    expect(first?.fails30m).toBe(2);
    expect(first?.lastFailAt).toBe(t0);
    expect(first?.lastFailCode).toBe('tls');
    expect(first?.lastFailNode).toBe('Salt Lake City · Summit');

    const t1 = t0 + 900;
    await applyWindowToStatus(db(), windowInput({
      id: 'w-fail-2',
      received_at: t1,
      payload: payload({ uiState: 'notConnected', events: [] }),
    }), null, t1);
    const decayed = await customerStatus(db(), USER);
    expect(decayed?.fails30m).toBe(Math.round(2 * (1800 - 900) / 1800));
    expect(decayed?.lastFailCode).toBe('tls');

    const t2 = t1 + 1800;
    await applyWindowToStatus(db(), windowInput({
      id: 'w-fail-3',
      received_at: t2,
      payload: payload({
        uiState: 'notConnected',
        events: [{ ts: t2 * 1000, kind: 'connectFail', code: 'dns', node: 'Tokyo · Kite' }],
      }),
    }), null, t2);
    const later = await customerStatus(db(), USER);
    expect(later?.fails30m).toBe(1);
    expect(later?.lastFailCode).toBe('dns');
    expect(later?.lastFailNode).toBe('Tokyo · Kite');
  });
});

describe('customer_activity_hours accrual', () => {
  it('splits overlap minutes across a UTC hour boundary', async () => {
    await seedUser();
    const hours = await accrueActivityHours(db(), windowInput({
      window_start_ms: (HOUR - 600) * 1000,
      window_end_ms: (HOUR + 600) * 1000,
      payload: payload({ uiState: 'connected' }),
    }), HOUR);
    expect(hours).toBe(2);

    const rows = await activityHours(db(), USER, { fromSec: HOUR - 3600, toSec: HOUR + 3600 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      hourAt: HOUR - 3600,
      onlineMinutes: 10,
      connectedMinutes: 10,
      windows: 1,
      node: 'Salt Lake City · Summit',
      platform: 'windows',
      appVersion: '0.0.19',
    });
    expect(rows[1]).toMatchObject({
      hourAt: HOUR,
      onlineMinutes: 10,
      connectedMinutes: 10,
      windows: 1,
    });

    await accrueActivityHours(db(), windowInput({
      id: 'w-idle',
      window_start_ms: HOUR * 1000,
      window_end_ms: (HOUR + 300) * 1000,
      client_version: '0.0.20',
      payload: payload({ uiState: 'notConnected', selectedServer: 'Tokyo · Kite' }),
    }), HOUR);
    const after = await activityHours(db(), USER, { fromSec: HOUR, toSec: HOUR + 3600 });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      hourAt: HOUR,
      onlineMinutes: 15,
      connectedMinutes: 10,
      windows: 2,
      node: 'Tokyo · Kite',
      appVersion: '0.0.20',
    });
  });
});

describe('projectBacklog cursor', () => {
  it('applies status and hours in received_at order and resumes from the cursor', async () => {
    await seedUser();
    await insertTelemetry(windowInput({
      id: 'w-a',
      received_at: HOUR + 1,
      window_start_ms: HOUR * 1000,
      window_end_ms: (HOUR + 60) * 1000,
    }));
    await insertTelemetry(windowInput({
      id: 'w-b',
      received_at: HOUR + 2,
      window_start_ms: (HOUR + 60) * 1000,
      window_end_ms: (HOUR + 120) * 1000,
    }));
    await insertTelemetry(windowInput({
      id: 'w-c',
      received_at: HOUR + 3,
      window_start_ms: (HOUR + 120) * 1000,
      window_end_ms: (HOUR + 180) * 1000,
      payload: payload({ uiState: 'notConnected' }),
    }));

    const first = await projectBacklog(db(), HOUR + 10, 2);
    expect(first.windows).toBe(2);
    expect(first.hours).toBe(2);
    expect((await customerStatus(db(), USER))?.lastWindowId).toBe('w-b');
    expect((await customerStatus(db(), USER))?.connected).toBe(true);

    const second = await projectBacklog(db(), HOUR + 11, 2);
    expect(second.windows).toBe(1);
    expect((await customerStatus(db(), USER))?.lastWindowId).toBe('w-c');
    expect((await customerStatus(db(), USER))?.connected).toBe(false);

    const third = await projectBacklog(db(), HOUR + 12, 2);
    expect(third).toEqual({ windows: 0, hours: 0 });
  });
});

describe('customer_sessions backfill and readers', () => {
  it('derives login/register/revoke events idempotently by kind:sourceRowId', async () => {
    await seedUser();
    await db().prepare(
      `INSERT INTO devices (
         id, user_id, installation_id, name, status, created_at, updated_at, confirmed_at
       ) VALUES
         ('dev-live', ?, 'inst-live', 'laptop', 'active', 100, 100, 110),
         ('dev-dead', ?, 'inst-dead', 'old', 'revoked', 50, 90, 55)`,
    ).bind(USER, USER).run();
    await db().prepare(
      `INSERT INTO sessions (id, user_id, refresh_hash, expires_at, created_at)
       VALUES ('sess-1', ?, 'hash-1', 99999, 120)`,
    ).bind(USER).run();

    expect(await backfillSessionsFromTables(db(), 50)).toBe(4);
    expect(await backfillSessionsFromTables(db(), 50)).toBe(0);

    const rows = await sessionsFor(db(), USER, { limit: 10 });
    expect(rows.map((row) => row.id).sort()).toEqual([
      'device_registered:dev-dead',
      'device_registered:dev-live',
      'device_revoked:dev-dead',
      'login:sess-1',
    ].sort());
    const login = rows.find((row) => row.id === 'login:sess-1');
    expect(login).toMatchObject({ kind: 'login', at: 120, source: 'sessions' });
    const registered = rows.find((row) => row.id === 'device_registered:dev-live');
    expect(registered).toMatchObject({ kind: 'device_registered', at: 110, source: 'devices' });
    const revoked = rows.find((row) => row.id === 'device_revoked:dev-dead');
    expect(revoked).toMatchObject({ kind: 'device_revoked', at: 90, source: 'devices' });

    const page = await sessionsFor(db(), USER, { limit: 1 });
    expect(page).toHaveLength(1);
    const rest = await sessionsFor(db(), USER, {
      cursor: { at: page[0].at, id: page[0].id },
      limit: 10,
    });
    expect(rest).toHaveLength(3);
    expect(rest.some((row) => row.id === page[0].id)).toBe(false);

    await recordSession(db(), {
      userId: USER,
      deviceId: 'dev-live',
      kind: 'logout',
      at: 200,
      source: 'ops',
      detail: 'operator',
    });
    const withLogout = await sessionsFor(db(), USER, { limit: 10 });
    expect(withLogout.some((row) => row.kind === 'logout')).toBe(true);
  });
});

describe('projection retention', () => {
  it('drops activity hours and sessions older than the retain window, honoring limit', async () => {
    await seedUser();
    const now = HOUR + 10;
    await db().prepare(
      `INSERT INTO customer_activity_hours (
         user_id, device_id, hour_at, online_minutes, connected_minutes, windows
       ) VALUES (?, '', ?, 1, 0, 1), (?, '', ?, 1, 0, 1), (?, '', ?, 1, 0, 1)`,
    ).bind(USER, now - 500 * 86400, USER, now - 401 * 86400, USER, now - 10 * 86400).run();
    await db().prepare(
      `INSERT INTO customer_sessions (id, user_id, kind, at)
       VALUES ('old-a', ?, 'login', ?), ('old-b', ?, 'login', ?), ('fresh', ?, 'login', ?)`,
    ).bind(USER, now - 500 * 86400, USER, now - 401 * 86400, USER, now - 10 * 86400).run();

    expect(await retainActivityHours(db(), now, 400, 1)).toBe(1);
    expect(await retainActivityHours(db(), now, 400, 10)).toBe(1);
    const keptHours = await activityHours(db(), USER, { fromSec: 0, toSec: now + 1 });
    expect(keptHours).toHaveLength(1);
    expect(keptHours[0].hourAt).toBe(now - 10 * 86400);

    expect(await retainSessions(db(), now, 400, 1)).toBe(1);
    expect(await retainSessions(db(), now, 400, 10)).toBe(1);
    const keptSessions = await sessionsFor(db(), USER, { limit: 10 });
    expect(keptSessions.map((row) => row.id)).toEqual(['fresh']);
  });
});
