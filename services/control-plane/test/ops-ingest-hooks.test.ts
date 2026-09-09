import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
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
