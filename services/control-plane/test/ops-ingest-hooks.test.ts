import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtSign } from '../src/crypto';
import worker, { type Env } from '../src/index';
import { enqueueJob } from '../src/ops/jobs';

const JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
const COLLECTOR = 'collector-test-token-with-at-least-32-chars';
const db = () => (env as unknown as Env).DB;

const api = async (path: string, init: RequestInit = {}) => {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://test/api/v1/${path}`, init),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
};

const json = (value: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(value),
});

const gzip = async (text: string): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );

async function seedAccount(prefix: string) {
  const t = Math.floor(Date.now() / 1000);
  const userId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'x', 'active', 0, ?, ?)`,
  ).bind(userId, `${prefix}@example.com`, t, t).run();
  await db().prepare(
    `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
     VALUES(?, ?, ?, 'Test', 'active', ?, ?)`,
  ).bind(deviceId, userId, `${prefix}-install`, t, t).run();
  await db().prepare(
    `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, userId, `h-${sessionId}`, t + 86_400, t, deviceId).run();
  const token = await jwtSign({ sub: userId, sid: sessionId, exp: t + 3600 }, JWT_SECRET);
  return { userId, deviceId, token };
}

function telemetryWindow() {
  const nowMs = Date.now();
  return {
    window: {
      schemaVersion: 1,
      kind: 'periodic_window',
      windowStartMs: nowMs - 20 * 60 * 1000,
      windowEndMs: nowMs,
      appVersion: '0.0.72',
      osVersion: 'Windows 11 Pro 23H2',
      osArch: 'x86_64',
      uiState: 'connected',
      selectedServer: 'Salt Lake City · Summit',
      catalogRevision: 7,
      eventCount: 2,
      eventsDropped: 0,
      events: [
        { ts: nowMs - 60_000, kind: 'networkChange', counter: 1 },
        { ts: nowMs - 30_000, kind: 'connectOk', node: 'Salt Lake City · Summit', elapsedMs: 2100 },
      ],
    },
  };
}

describe('ops ingest hooks', () => {
  beforeEach(async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    (env as unknown as Env).OPS_TRAFFIC_PARSE = undefined;
  });

  it('POST telemetry/windows writes connection_events and customer status', async () => {
    const account = await seedAccount('tel');
    const response = await api('telemetry/windows', json(telemetryWindow(), account.token));
    expect(response.status).toBe(201);
    const body = await response.json() as { id: string };
    const events = await db().prepare(
      'SELECT COUNT(*) AS c FROM connection_events WHERE window_id = ?',
    ).bind(body.id).first<{ c: number }>();
    expect(Number(events?.c)).toBeGreaterThan(0);
    const status = await db().prepare(
      'SELECT selected_server, connected FROM ops_customer_status WHERE user_id = ?',
    ).bind(account.userId).first<{ selected_server: string; connected: number }>();
    expect(status?.selected_server).toBe('Salt Lake City · Summit');
    expect(Number(status?.connected)).toBe(1);
  });

  it('PUT ops-ingest/snapshot writes ops_node_status', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = COLLECTOR;
    const observedAt = Math.floor(Date.now() / 1000);
    const response = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: { authorization: `Bearer ${COLLECTOR}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        report: { nodes: [{ name: 'Tokyo · Kite', ok: true, block: { status: 'OK' } }] },
        agents: [{ name: 'Tokyo · Kite', observedAt, cpu: 12 }],
      }),
    });
    expect(response.status).toBe(200);
    const row = await db().prepare(
      'SELECT node_name, verdict FROM ops_node_status WHERE node_name = ?',
    ).bind('Tokyo · Kite').first<{ node_name: string; verdict: string }>();
    expect(row?.node_name).toBe('Tokyo · Kite');
    expect(typeof row?.verdict).toBe('string');
  });

  it('a window that names its platform is flattened under that platform, not the os_version guess', async () => {
    const account = await seedAccount('plat');
    const body = telemetryWindow();
    body.window.osVersion = '14.4 (23E214)';
    (body.window as Record<string, unknown>).platform = 'macos';
    (body.window as Record<string, unknown>).bytesByRoute = { cloud: 1_500, residential: 0, direct: 42 };
    const response = await api('telemetry/windows', json(body, account.token));
    expect(response.status).toBe(201);
    const stored = await db().prepare(
      'SELECT payload_json FROM telemetry_windows WHERE user_id = ? ORDER BY received_at DESC LIMIT 1',
    ).bind(account.userId).first<{ payload_json: string }>();
    const payload = JSON.parse(stored?.payload_json ?? '{}');
    expect(payload.platform).toBe('macos');
    expect(payload.bytesByRoute).toEqual({ cloud: 1_500, residential: 0, direct: 42 });
    const rows = await db().prepare(
      'SELECT DISTINCT platform FROM connection_events WHERE user_id = ?',
    ).bind(account.userId).all<{ platform: string }>();
    expect(rows.results.map((row) => row.platform)).toEqual(['macos']);

    const badPlatform = telemetryWindow();
    (badPlatform.window as Record<string, unknown>).platform = 'amiga';
    expect((await api('telemetry/windows', json(badPlatform, account.token))).status).toBe(400);
    const badRoute = telemetryWindow();
    (badRoute.window as Record<string, unknown>).bytesByRoute = { cloud: 1, tunnel: 2 };
    expect((await api('telemetry/windows', json(badRoute, account.token))).status).toBe(400);
    const negative = telemetryWindow();
    (negative.window as Record<string, unknown>).bytesByRoute = { direct: -1 };
    expect((await api('telemetry/windows', json(negative, account.token))).status).toBe(400);
  });

  it('failure reports spend their own rate-limit bucket, not the heartbeat one', async () => {
    const account = await seedAccount('bucket');
    const limits = env as unknown as Env;
    limits.RATE_LIMIT_TELEMETRY_USER_HOUR = '1';
    try {
      expect((await api('telemetry/windows', json(telemetryWindow(), account.token))).status).toBe(201);
      expect((await api('telemetry/windows', json(telemetryWindow(), account.token))).status).toBe(429);
      const failure = await api('telemetry/failures', json({
        ts: Date.now(), stage: 'handshake', code: 'ETIMEDOUT', node: 'Tokyo · Kite',
        appVersion: '0.0.72', osVersion: 'macOS 14.4', osArch: 'arm64', platform: 'macos',
      }, account.token));
      expect(failure.status).toBe(202);
    } finally {
      limits.RATE_LIMIT_TELEMETRY_USER_HOUR = undefined;
    }
  });

  it('a customer incident opened on a heartbeat reaches a user-subject alert rule', async () => {
    const account = await seedAccount('alert');
    const t = Math.floor(Date.now() / 1000);
    await db().prepare(
      `INSERT INTO ops_alert_rules(
         id, name, enabled, match_kind, match_subject_type, match_subject_id,
         min_severity, min_impact, fire_on, delay_seconds, cooldown_seconds,
         channel, target, template, secret_ref, created_at, updated_at
       ) VALUES(?, ?, 1, NULL, 'user', NULL, 'notice', 0, 'open', 0, 0,
                'webhook', ?, 'slack', NULL, ?, ?)`,
    ).bind('rule-user', 'customers', 'https://hooks.slack.com/services/test', t, t).run();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    try {
      const body = telemetryWindow();
      const nowMs = Date.now();
      body.window.events = [1, 2, 3].map((n) => ({
        ts: nowMs - n * 60_000, kind: 'connectFail', node: 'Salt Lake City · Summit', stage: 'handshake', code: 'ETIMEDOUT',
      })) as unknown as typeof body.window.events;
      body.window.eventCount = 3;
      const response = await api('telemetry/windows', json(body, account.token));
      expect(response.status).toBe(201);
      const incident = await db().prepare(
        "SELECT id FROM ops_incidents WHERE dedupe_key = ? AND status <> 'resolved'",
      ).bind(`customer-repeat-fail:${account.userId}`).first<{ id: string }>();
      expect(incident?.id).toBeTruthy();
      const delivery = await db().prepare(
        'SELECT transition, status FROM ops_alert_deliveries WHERE incident_id = ?',
      ).bind(incident?.id ?? '').first<{ transition: string; status: string }>();
      expect(delivery?.transition).toBe('open');
      expect(['sent', 'pending']).toContain(delivery?.status);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a failure report cannot be dated past receipt or past the diagnostics clock bound', async () => {
    const account = await seedAccount('clock');
    const base = {
      stage: 'handshake', code: 'ETIMEDOUT', node: 'Tokyo · Kite',
      appVersion: '0.0.72', osVersion: 'macOS 14.4', osArch: 'arm64',
    };
    expect((await api('telemetry/failures', json({ ...base, ts: 9_007_199_254_740_991 }, account.token))).status).toBe(400);
    const ahead = Date.now() + 36 * 3_600 * 1_000;
    expect((await api('telemetry/failures', json({ ...base, ts: ahead }, account.token))).status).toBe(202);
    const row = await db().prepare(
      "SELECT at_ms, received_at FROM connection_events WHERE user_id = ? AND source = 'failure'",
    ).bind(account.userId).first<{ at_ms: number; received_at: number }>();
    expect(Number(row?.at_ms)).toBeLessThanOrEqual(Number(row?.received_at) * 1000);
  });

  it('POST telemetry/failures validates and records a connectFail', async () => {
    const account = await seedAccount('fail');
    const extra = await api('telemetry/failures', json({
      ts: Date.now(), stage: 'handshake', code: 'ETIMEDOUT', node: 'Tokyo',
      appVersion: '0.0.72', osVersion: 'macOS 14', osArch: 'arm64', surprise: true,
    }, account.token));
    expect(extra.status).toBe(400);

    const missing = await api('telemetry/failures', json({
      ts: Date.now(), code: 'ETIMEDOUT', node: 'Tokyo',
      appVersion: '0.0.72', osVersion: 'macOS 14', osArch: 'arm64',
    }, account.token));
    expect(missing.status).toBe(400);

    const ok = await api('telemetry/failures', json({
      ts: Date.now(),
      stage: 'handshake',
      code: 'ETIMEDOUT',
      node: 'Tokyo · Kite',
      appVersion: '0.0.72',
      osVersion: 'macOS 14.4',
      osArch: 'arm64',
      coreErrors: ['dial tcp 203.0.113.9:443: i/o timeout'],
    }, account.token));
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ accepted: true });
    const row = await db().prepare(
      `SELECT source, kind, node, error FROM connection_events
       WHERE user_id = ? AND source = 'failure'`,
    ).bind(account.userId).first<{ source: string; kind: string; node: string; error: string }>();
    expect(row).toMatchObject({ source: 'failure', kind: 'connectFail', node: 'Tokyo · Kite' });
    expect(row?.error).toContain('[redacted]');
    const status = await db().prepare(
      'SELECT last_fail_code, last_fail_node FROM ops_customer_status WHERE user_id = ?',
    ).bind(account.userId).first<{ last_fail_code: string; last_fail_node: string }>();
    expect(status).toMatchObject({ last_fail_code: 'ETIMEDOUT', last_fail_node: 'Tokyo · Kite' });
  });

  it('stores attemptId on failures and window events', async () => {
    const account = await seedAccount('attempt');
    const fail = await api('telemetry/failures', json({
      ts: Date.now(), stage: 'handshake', code: 'ETIMEDOUT', node: 'Tokyo · Kite',
      appVersion: '0.0.72', osVersion: 'macOS 14.4', osArch: 'arm64',
      attemptId: 'att-abc-001',
    }, account.token));
    expect(fail.status).toBe(202);
    const storedFail = await db().prepare(
      "SELECT attempt_id FROM connection_events WHERE user_id = ? AND source = 'failure'",
    ).bind(account.userId).first<{ attempt_id: string }>();
    expect(storedFail?.attempt_id).toBe('att-abc-001');
    const tooLong = await api('telemetry/failures', json({
      ts: Date.now(), stage: 'handshake', code: 'ETIMEDOUT', node: 'Tokyo · Kite',
      appVersion: '0.0.72', osVersion: 'macOS 14.4', osArch: 'arm64',
      attemptId: 'x'.repeat(65),
    }, account.token));
    expect(tooLong.status).toBe(400);

    const body = telemetryWindow();
    body.window.events = [
      { ts: Date.now() - 30_000, kind: 'connectFail', node: 'Tokyo · Kite', stage: 'handshake', code: 'ETIMEDOUT', attemptId: 'att-win-1' },
    ] as unknown as typeof body.window.events;
    body.window.eventCount = 1;
    const posted = await api('telemetry/windows', json(body, account.token));
    expect(posted.status).toBe(201);
    const stored = await db().prepare(
      'SELECT payload_json FROM telemetry_windows WHERE user_id = ? ORDER BY received_at DESC LIMIT 1',
    ).bind(account.userId).first<{ payload_json: string }>();
    const payload = JSON.parse(stored?.payload_json ?? '{}') as { events: Array<{ attemptId?: string }> };
    expect(payload.events[0]?.attemptId).toBe('att-win-1');
    const flattened = await db().prepare(
      "SELECT attempt_id FROM connection_events WHERE user_id = ? AND source = 'window' AND kind = 'connectFail'",
    ).bind(account.userId).first<{ attempt_id: string }>();
    expect(flattened?.attempt_id).toBe('att-win-1');
  });

  it('keeps one connection_events row when a failure POST and a later window share attemptId', async () => {
    const account = await seedAccount('dedupe');
    const attemptId = 'att-same-001';
    const fail = await api('telemetry/failures', json({
      ts: Date.now(), stage: 'handshake', code: 'ETIMEDOUT', node: 'Tokyo · Kite',
      appVersion: '0.0.72', osVersion: 'Windows 11 Pro 23H2', osArch: 'x86_64',
      attemptId,
    }, account.token));
    expect(fail.status).toBe(202);

    const body = telemetryWindow();
    body.window.uiState = 'notConnected';
    body.window.events = [
      { ts: Date.now() - 5_000, kind: 'connectFail', node: 'Tokyo · Kite', stage: 'handshake', code: 'ETIMEDOUT', attemptId },
    ] as unknown as typeof body.window.events;
    body.window.eventCount = 1;
    const posted = await api('telemetry/windows', json(body, account.token));
    expect(posted.status).toBe(201);

    const events = await db().prepare(
      'SELECT COUNT(*) AS c FROM connection_events WHERE user_id = ? AND attempt_id = ?',
    ).bind(account.userId, attemptId).first<{ c: number }>();
    expect(Number(events?.c)).toBe(1);
    const status = await db().prepare(
      'SELECT fails_30m FROM ops_customer_status WHERE user_id = ?',
    ).bind(account.userId).first<{ fails_30m: number }>();
    expect(Number(status?.fails_30m)).toBe(1);
    const device = await db().prepare(
      'SELECT fails_30m, last_fail_code FROM ops_device_status WHERE user_id = ? AND device_id = ?',
    ).bind(account.userId, account.deviceId).first<{ fails_30m: number; last_fail_code: string }>();
    expect(Number(device?.fails_30m)).toBe(1);
    expect(device?.last_fail_code).toBe('ETIMEDOUT');
  });

  it('POST diagnostics/logs parses a gzip fixture into traffic rows', async () => {
    const account = await seedAccount('logs');
    const t = Math.floor(Date.now() / 1000);
    await db().prepare(
      `INSERT INTO diagnostics_log_access(device_id, user_id, expires_at, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?)`,
    ).bind(account.deviceId, account.userId, t + 3600, t, t).run();
    const payload = await gzip(JSON.stringify({
      kind: 'connection',
      timestamp: new Date().toISOString(),
      host: 'api.anthropic.com',
      process: 'Claude',
      route: 'Tono-Exit',
      bytes_up: 11,
      bytes_down: 22,
    }));
    const response = await api('diagnostics/logs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.token}`,
        'content-type': 'application/gzip',
        'X-Tono-Log-Session': 'FE5919D3-405E-4538-9C4C-1866E088F24F',
        'X-Tono-Log-Sequence': '0',
        'X-Tono-Log-Lines': '1',
        'X-Tono-Log-Client-Version': '0.0.72',
        'X-Tono-Log-Os-Version': 'macOS 14.4',
      },
      body: new Blob([payload]),
    });
    expect(response.status).toBe(201);
    const dest = await db().prepare(
      `SELECT etld1, connections, bytes_up, bytes_down FROM traffic_destination_daily
       WHERE user_id = ?`,
    ).bind(account.userId).first<{ etld1: string; connections: number; bytes_up: number; bytes_down: number }>();
    expect(dest?.etld1).toBe('anthropic.com');
    expect(Number(dest?.connections)).toBe(1);
    expect(Number(dest?.bytes_up)).toBe(11);
    expect(Number(dest?.bytes_down)).toBe(22);
  });

  it('a replayed log segment is answered from the index and parsed exactly once', async () => {
    const account = await seedAccount('replay');
    const t = Math.floor(Date.now() / 1000);
    await db().prepare(
      `INSERT INTO diagnostics_log_access(device_id, user_id, expires_at, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?)`,
    ).bind(account.deviceId, account.userId, t + 3600, t, t).run();
    const session = crypto.randomUUID().toUpperCase();
    const payload = await gzip(JSON.stringify({
      kind: 'connection',
      timestamp: new Date().toISOString(),
      host: 'www.baidu.com',
      process: 'Safari',
      route: 'Tono-Exit',
      bytes_up: 11,
      bytes_down: 22,
    }));
    const upload = (sequence: number) => api('diagnostics/logs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.token}`,
        'content-type': 'application/gzip',
        'X-Tono-Log-Session': session,
        'X-Tono-Log-Sequence': String(sequence),
        'X-Tono-Log-Lines': '1',
        'X-Tono-Log-Client-Version': '0.0.72',
        'X-Tono-Log-Os-Version': 'macOS 14.4',
      },
      body: new Blob([payload]),
    });
    const rows = async () => {
      const row = await db().prepare(
        `SELECT
           (SELECT COALESCE(SUM(connections), 0) FROM traffic_destination_daily WHERE user_id = ?) AS conns,
           (SELECT COALESCE(SUM(bytes), 0) FROM direct_candidate_daily WHERE user_id = ?) AS bytes,
           (SELECT COUNT(*) FROM ops_traffic_segments WHERE user_id = ?) AS segments`,
      ).bind(account.userId, account.userId, account.userId).first<Record<string, number>>();
      return { conns: Number(row?.conns), bytes: Number(row?.bytes), segments: Number(row?.segments) };
    };

    const first = await upload(0);
    expect(first.status).toBe(201);
    const firstId = (await first.json() as { segment: { id: string } }).segment.id;
    expect(await rows()).toEqual({ conns: 1, bytes: 33, segments: 1 });

    const replay = await upload(0);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { segment: { id: string } }).segment.id).toBe(firstId);
    expect(await rows()).toEqual({ conns: 1, bytes: 33, segments: 1 });

    const next = await upload(1);
    expect(next.status).toBe(201);
    expect(await rows()).toEqual({ conns: 2, bytes: 66, segments: 2 });
    const stored = await db().prepare(
      'SELECT COUNT(*) AS c FROM diagnostics_log_objects WHERE user_id = ?',
    ).bind(account.userId).first<{ c: number }>();
    expect(Number(stored?.c)).toBe(2);
  });

  it('ops-ingest jobs lease, heartbeat, and complete behind the collector token', async () => {
    const missing = await api('ops-ingest/jobs?executor=hub&max=1');
    expect(missing.status).toBe(503);
    expect((await missing.json() as { error: { code: string } }).error.code).toBe('OPS_INGEST_UNCONFIGURED');

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = COLLECTOR;
    const t = Math.floor(Date.now() / 1000);
    const { job } = await enqueueJob(db(), {
      nodeName: 'Tokyo · Kite',
      type: 'identity_sync',
      requestedBy: 'ops@example.com',
      idempotencyKey: 'ingest-job-1',
    }, t);

    const headers = { authorization: `Bearer ${COLLECTOR}`, 'content-type': 'application/json' };
    const leased = await api('ops-ingest/jobs?executor=hub&max=5', { headers });
    expect(leased.status).toBe(200);
    const claimed = await leased.json() as { leaseId: string; jobs: Array<{ id: string; status: string }> };
    expect(claimed.jobs.map((row) => row.id)).toEqual([job.id]);
    expect(claimed.jobs[0].status).toBe('leased');

    const beat = await api(`ops-ingest/jobs/${job.id}/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ leaseId: claimed.leaseId }),
    });
    expect(beat.status).toBe(200);

    const conflict = await api(`ops-ingest/jobs/${job.id}/result`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ leaseId: 'not-this-lease', status: 'ok' }),
    });
    expect(conflict.status).toBe(409);

    const done = await api(`ops-ingest/jobs/${job.id}/result`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ leaseId: claimed.leaseId, status: 'ok', summary: 'synced' }),
    });
    expect(done.status).toBe(200);
    const body = await done.json() as { job: { status: string; resultStatus: string } };
    expect(body.job).toMatchObject({ status: 'succeeded', resultStatus: 'ok' });
  });
});
