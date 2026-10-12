import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  ADMIN_TOKEN,
  api,
  json,
  admin,
  operations,
  createAccount,
  emailSignIn,
  telemetryWindowPayload,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('scheduled cleanup purges expired and revoked sessions older than 24 hours while keeping active sessions', async () => {
    const account = await createAccount('session-cleanup');
    const now = Math.floor(Date.now() / 1000);

    // Insert an expired session, an old revoked session, and a fresh revoked session
    await env.DB.prepare(
      `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, revoked_at, created_at)
       VALUES('sess-expired', ?, 'hash1', ?, NULL, ?),
             ('sess-revoked-old', ?, 'hash2', ?, ?, ?),
             ('sess-revoked-fresh', ?, 'hash3', ?, ?, ?)`,
    ).bind(
      account.user.id, now - 100, now - 500,
      account.user.id, now + 1000, now - 90_000, now - 100_000,
      account.user.id, now + 1000, now - 3600, now - 5000,
    ).run();

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);

    // Expired session and old revoked session should be purged
    const expired = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind('sess-expired').first();
    const revokedOld = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind('sess-revoked-old').first();
    const revokedFresh = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind('sess-revoked-fresh').first();

    expect(expired).toBeNull();
    expect(revokedOld).toBeNull();
    expect(revokedFresh).not.toBeNull();
  });

  it('accepts periodic telemetry windows and lists them for admin forensics', async () => {
    const account = await createAccount('telemetry-window');
    const response = await api('telemetry/windows', json(telemetryWindowPayload(), account.accessToken));
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(typeof body.id).toBe('string');
    expect(typeof body.receivedAt).toBe('number');

    const stored = await env.DB.prepare(
      'SELECT * FROM telemetry_windows WHERE id = ?',
    ).bind(body.id).first<any>();
    expect(stored.user_id).toBe(account.user.id);
    expect(JSON.parse(stored.payload_json).events).toHaveLength(2);

    expect((await api('telemetry/windows', json(telemetryWindowPayload()))).status).toBe(401);

    const withEmail = await api('telemetry/windows', json(telemetryWindowPayload({
      eventCount: 1,
      events: [{ ts: Date.now(), kind: 'signInOk', email: 'user@example.com' }],
    }), account.accessToken));
    expect(withEmail.status).toBe(400);

    const listed = await admin(`telemetry/windows?userId=${account.user.id}`, undefined, 'GET');
    expect(listed.status).toBe(200);
    const listBody = await listed.json() as any;
    expect(listBody.windows.length).toBeGreaterThanOrEqual(1);
    expect(listBody.windows[0].userId).toBe(account.user.id);
  });

  it('projects Windows residential route telemetry into privacy-safe ops evidence', async () => {
    const account = await createAccount('telemetry-residential-proof');
    const nowMs = Date.now();
    const events = [
      {
        ts: nowMs - 4_000,
        kind: 'protectedRouteAggregate',
        outcome: 'RESIDENTIAL',
        counter: 7,
        generation: 12,
      },
      {
        ts: nowMs - 3_000,
        kind: 'protectedRouteInvariantViolation',
        outcome: 'PROXIED',
        counter: 1,
        generation: 12,
      },
      {
        ts: nowMs - 2_000,
        kind: 'protectedRouteAggregate',
        outcome: 'BLOCKED',
        counter: 1,
        generation: 12,
      },
      {
        ts: nowMs - 1_000,
        kind: 'protectedRouteAggregate',
        outcome: 'UNKNOWN',
        counter: 1,
        generation: 12,
      },
    ];
    const posted = await api('telemetry/windows', json(telemetryWindowPayload({
      eventCount: events.length,
      events,
      dnsEnabled: undefined,
    }), account.accessToken));
    expect(posted.status).toBe(201);

    const detail = await operations(`users/${account.user.id}/detail`);
    expect(detail.status).toBe(200);
    const proof = (await detail.json() as any).protectedRouteProof;
    expect(proof).toMatchObject({
      source: 'periodic_telemetry',
      status: 'observed',
      evidence: {
        verdict: 'unsafe',
        residentialReported: true,
        routes: {
          observed: 10,
          residential: 7,
          proxied: 1,
          direct: 0,
          blocked: 1,
          unknown: 1,
        },
        connected: true,
        killSwitchArmed: true,
        tunPresent: true,
        protectedDNSConfigured: null,
        exitIdentityConsistency: 'INCONCLUSIVE',
        physicalBypassProbe: 'INCONCLUSIVE',
      },
    });
    const serialized = JSON.stringify(proof).toLowerCase();
    for (const forbidden of ['host', 'destination', 'process', 'profile', 'template', 'rule', 'proxy']) {
      expect(serialized).not.toContain(forbidden);
    }

    // Route evidence is cumulative but appears only when the protected sample
    // changes. A newer ordinary heartbeat must not erase the last proof from
    // the operator drawer.
    const heartbeat = telemetryWindowPayload().window as any;
    await env.DB.prepare(
      `INSERT INTO telemetry_windows(
         id, user_id, device_id, received_at, window_start_ms, window_end_ms,
         client_version, os_version, payload_json
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), account.user.id, account.device.id,
      Math.floor(Date.now() / 1000) + 1,
      heartbeat.windowStartMs, heartbeat.windowEndMs,
      heartbeat.appVersion, heartbeat.osVersion, JSON.stringify(heartbeat),
    ).run();
    const afterHeartbeat = await operations(`users/${account.user.id}/detail`);
    expect((await afterHeartbeat.json() as any).protectedRouteProof).toMatchObject({
      source: 'periodic_telemetry',
      evidence: {
        verdict: 'unsafe',
        routes: { observed: 10, residential: 7, proxied: 1, blocked: 1, unknown: 1 },
      },
    });
  });

  it('reports per-user online activity with device attribution to Access admins', async () => {
    const account = await createAccount('activity');
    const posted = await api('telemetry/windows', json(telemetryWindowPayload(), account.accessToken));
    expect(posted.status).toBe(201);
    const stored = await env.DB.prepare(
      'SELECT device_id FROM telemetry_windows ORDER BY received_at DESC LIMIT 1',
    ).first<any>();
    expect(stored.device_id).toBe(account.device.id);

    const unauthorized = await api('ops/activity', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unauthorized.status).toBe(401);

    const response = await operations('activity');
    expect(response.status).toBe(200);
    const { activity } = await response.json() as any;
    expect(activity.onlineUsers).toBeGreaterThanOrEqual(1);
    expect(activity.onlineDevices).toBeGreaterThanOrEqual(1);
    const me = activity.users.find((u: any) => u.userId === account.user.id);
    expect(me).toBeDefined();
    expect(me.online).toBe(true);
    expect(me.deviceId).toBe(account.device.id);
    expect(me.selectedServer).toBe('Salt Lake City · Summit');
    expect(me.uiState).toBe('connected');
    expect(me.catalogRevision).toBe(7);
    expect(me.payloadJson).toBeUndefined();
    expect(me.exitDelayMs).toBeNull();
    expect(me.tcpDelayMs).toBeNull();
    expect(me.nodeHealth).toBe('unknown');
  });

  it('caps future client path clocks at receipt time without rewriting forensic JSON', async () => {
    const account = await createAccount('activity-future-clock');
    const futureAtMs = Date.now() + 365 * 86_400_000;
    const posted = await api('telemetry/windows', json(telemetryWindowPayload({
      exitDelayMs: 900,
      tcpDelayMs: 500,
      exitDelayAtMs: futureAtMs,
      tcpDelayAtMs: futureAtMs,
    }), account.accessToken));
    expect(posted.status).toBe(201);
    const created = await posted.json() as any;

    const stored = await env.DB.prepare(
      'SELECT payload_json FROM telemetry_windows WHERE id = ?',
    ).bind(created.id).first<any>();
    expect(JSON.parse(stored.payload_json).exitDelayAtMs).toBe(futureAtMs);

    const activityResponse = await operations('activity');
    const { activity } = await activityResponse.json() as any;
    const me = activity.users.find((user: any) => user.userId === account.user.id);
    expect(me.exitDelayAtMs).toBe(me.lastSeenAt * 1_000);
    expect(me.tcpDelayAtMs).toBe(me.lastSeenAt * 1_000);

    const detailResponse = await operations(`users/${account.user.id}/detail`);
    const detail = await detailResponse.json() as any;
    expect(detail.heartbeat.exitDelayAtMs).toBe(detail.heartbeat.lastSeenAt * 1_000);
    expect(detail.heartbeat.tcpDelayAtMs).toBe(detail.heartbeat.lastSeenAt * 1_000);
  });

  it('returns one deterministic latest heartbeat per device without inflating user occupancy', async () => {
    const account = await createAccount('activity-multi-device');
    const secondLogin = await emailSignIn({
      email: account.email,
      deviceName: 'Second Mac',
      installationId: 'activity-multi-device-installation-two',
    });
    expect(secondLogin.status).toBe(200);
    const second = await secondLogin.json() as any;
    const receivedAt = Math.floor(Date.now() / 1_000);
    const windowStartMs = (receivedAt - 1_200) * 1_000;
    const windowEndMs = receivedAt * 1_000;
    const heartbeat = (
      rowId: string,
      deviceId: string,
      at: number,
      selectedServer: string,
    ) => env.DB.prepare(
      `INSERT INTO telemetry_windows(
         id, user_id, device_id, received_at, window_start_ms, window_end_ms,
         client_version, os_version, payload_json
       ) VALUES(?, ?, ?, ?, ?, ?, '0.0.90', 'macOS 26', ?)`,
    ).bind(
      rowId,
      account.user.id,
      deviceId,
      at,
      windowStartMs,
      windowEndMs,
      JSON.stringify(telemetryWindowPayload({ selectedServer }).window),
    );

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
         VALUES('profile-shared-node', 'Shared Node', 'active', ?, ?)`,
      ).bind(receivedAt, receivedAt),
      heartbeat('activity-primary-old', account.device.id, receivedAt - 10, 'Old Node'),
      // Same second, same device: highest id must win rather than returning both
      // rows or whichever SQLite happened to encounter first.
      heartbeat('activity-primary-a', account.device.id, receivedAt, 'Wrong Node'),
      heartbeat('activity-primary-z', account.device.id, receivedAt, 'Shared Node'),
      heartbeat('activity-secondary', second.device.id, receivedAt, 'Shared Node'),
    ]);

    const response = await operations('activity');
    expect(response.status).toBe(200);
    const { activity } = await response.json() as any;
    const mine = activity.users.filter((row: any) => row.userId === account.user.id);
    expect(mine).toHaveLength(2);
    expect(activity.onlineUsers).toBe(1);
    expect(activity.onlineDevices).toBe(2);
    expect(mine.find((row: any) => row.deviceId === account.device.id)?.selectedServer)
      .toBe('Shared Node');
    expect(mine.find((row: any) => row.deviceId === second.device.id)?.selectedServer)
      .toBe('Shared Node');

    const fleet = await operations('fleet-nodes');
    const shared = ((await fleet.json() as any).nodes as any[])
      .find((node) => node.name === 'Shared Node');
    expect(shared.occupancy).toBe(1);
    expect(shared.affectedUsers).toHaveLength(1);
    expect(shared.affectedUsers[0].userId).toBe(account.user.id);
  });

  it('accepts split path delays on a telemetry window and joins node health for every customer', async () => {
    const account = await createAccount('path-status');
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const ingested = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer collector-test-token-with-at-least-32-chars',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        report: {
          updated_at: 1_786_270_932,
          nodes: [
            {
              name: 'Tokyo · Fuji',
              host: '203.0.113.40',
              ok: true,
              block: { status: 'OK', label: '正常', overseas: { ok: true, success: 5, total: 5 } },
            },
            {
              name: 'Tokyo · Sakura',
              host: '203.0.113.41',
              ok: false,
              block: { status: 'LIKELY_BLOCKED', label: '疑似被墙', overseas: { ok: false, success: 0, total: 5 } },
            },
          ],
        },
      }),
    });
    expect(ingested.status).toBe(200);

    const posted = await api('telemetry/windows', json(telemetryWindowPayload({
      selectedServer: 'Tokyo · Fuji',
      exitDelayMs: 816,
      tcpDelayMs: 42,
      exitDelayAtMs: Date.now() - 5_000,
      tcpDelayAtMs: Date.now() - 60_000,
    }), account.accessToken));
    expect(posted.status).toBe(201);

    const unknownKey = await api('telemetry/windows', json(telemetryWindowPayload({
      pingMs: 12,
    }), account.accessToken));
    expect(unknownKey.status).toBe(400);

    const response = await operations('activity');
    const { activity } = await response.json() as any;
    const me = activity.users.find((u: any) => u.userId === account.user.id);
    expect(me.selectedServer).toBe('Tokyo · Fuji');
    expect(me.exitDelayMs).toBe(816);
    expect(me.tcpDelayMs).toBe(42);
    expect(me.nodeHealth).toBe('ok');
    expect(me.nodeHealthLabel).toBe('大陆正常');

    const other = await createAccount('path-status-down');
    const sakura = await api('telemetry/windows', json(telemetryWindowPayload({
      selectedServer: 'Tokyo · Sakura',
      exitDelayMs: 775,
    }), other.accessToken));
    expect(sakura.status).toBe(201);
    const after = await operations('activity');
    const { activity: next } = await after.json() as any;
    const onSakura = next.users.find((u: any) => u.userId === other.user.id);
    expect(onSakura.nodeHealth).toBe('down');
    expect(onSakura.nodeHealthLabel).toBe('整机失联');
    expect(onSakura.exitDelayMs).toBe(775);
    expect(onSakura.tcpDelayMs).toBeNull();
  });
});
