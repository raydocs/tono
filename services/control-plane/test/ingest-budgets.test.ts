import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jwtSign } from '../src/crypto';
import worker, { type Env } from '../src/index';
import { afterLogSegment, LOG_INFLATED_MAX_BYTES } from '../src/ops/ingest-hooks';
import { resetKnownExitAsnsCache } from '../src/ops/exit-asns';
import {
  MAX_DISTINCT_ETLD1,
  MAX_SEGMENT_LINES,
  parseAuditSegment,
} from '../src/ops/traffic-parse';

const JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
const db = () => (env as unknown as Env).DB;

// Measured 2026-09-10 on a fresh seedAccount (setup.ts has wiped ops_alert_rules
// and incidents). Cache reset so loadKnownExitAsns pays its SELECT. Budgets =
// ceil(measured × 1.2).
//   windows: 17 prepare / 2 batch (2-event window)
//   failures: 13 prepare / 1 batch
//   logs: 8 prepare / 1 batch (single-line gzip, access row pre-inserted)
const WINDOWS_PREPARE_BUDGET = 21;
const FAILURES_PREPARE_BUDGET = 16;
const LOGS_PREPARE_BUDGET = 10;
// Measured 2026-09-10: parseAuditSegment(gunzip) of 20_500 JSONL lines
// (1_576_196 gzip bytes, under the 2 MiB route cap) took 191 ms.
// Ceiling is 10× that: a wall-clock bound has to survive a loaded CI runner or
// a laptop building Xcode beside it, and still catches a parser gone quadratic.
const PARSE_CEILING_MS = 2_000;

type Counts = { prepare: number; batch: number };

function countingEnv(base: Env): { e: Env; counts: Counts } {
  const counts: Counts = { prepare: 0, batch: 0 };
  const target = base.DB;
  const proxy = new Proxy(target, {
    get(t, p, r) {
      if (p === 'prepare') {
        return (...args: Parameters<D1Database['prepare']>) => {
          counts.prepare += 1;
          return t.prepare(...args);
        };
      }
      if (p === 'batch') {
        return (...args: Parameters<D1Database['batch']>) => {
          counts.batch += 1;
          return t.batch(...args);
        };
      }
      const value = Reflect.get(t, p, r);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
  });
  return { e: { ...base, DB: proxy }, counts };
}

async function fetchPath(e: Env, path: string, init: RequestInit): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://test/api/v1/${path}`, init),
    e,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const json = (value: unknown, token: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
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

describe('ingest statement-count budgets', () => {
  beforeEach(() => {
    resetKnownExitAsnsCache();
  });

  it('windows, failures and log segments stay within their measured prepare budgets', async () => {
    const win = await seedAccount('budg-win');
    let c = countingEnv(env as unknown as Env);
    expect((await fetchPath(c.e, 'telemetry/windows', json(telemetryWindow(), win.token))).status).toBe(201);
    expect(c.counts.prepare, `windows prepare=${c.counts.prepare}`).toBeLessThanOrEqual(WINDOWS_PREPARE_BUDGET);

    const fail = await seedAccount('budg-fail');
    c = countingEnv(env as unknown as Env);
    expect((await fetchPath(c.e, 'telemetry/failures', json({
      ts: Date.now(), stage: 'handshake', code: 'ETIMEDOUT', node: 'Tokyo · Kite',
      appVersion: '0.0.72', osVersion: 'macOS 14.4', osArch: 'arm64',
    }, fail.token))).status).toBe(202);
    expect(c.counts.prepare, `failures prepare=${c.counts.prepare}`).toBeLessThanOrEqual(FAILURES_PREPARE_BUDGET);

    const logs = await seedAccount('budg-logs');
    const t = Math.floor(Date.now() / 1000);
    await db().prepare(
      `INSERT INTO diagnostics_log_access(device_id, user_id, expires_at, created_at, updated_at) VALUES(?, ?, ?, ?, ?)`,
    ).bind(logs.deviceId, logs.userId, t + 3600, t, t).run();
    const payload = await gzip(JSON.stringify({
      kind: 'connection', timestamp: new Date().toISOString(), host: 'api.anthropic.com',
      process: 'Claude', route: 'Tono-Exit', bytes_up: 11, bytes_down: 22,
    }));
    c = countingEnv(env as unknown as Env);
    const response = await fetchPath(c.e, 'diagnostics/logs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${logs.token}`, 'content-type': 'application/gzip',
        'X-Tono-Log-Session': 'FE5919D3-405E-4538-9C4C-1866E088F24F', 'X-Tono-Log-Sequence': '0',
        'X-Tono-Log-Lines': '1', 'X-Tono-Log-Client-Version': '0.0.72', 'X-Tono-Log-Os-Version': 'macOS 14.4',
      },
      body: new Blob([payload]),
    });
    expect(response.status).toBe(201);
    expect(c.counts.prepare, `logs prepare=${c.counts.prepare}`).toBeLessThanOrEqual(LOGS_PREPARE_BUDGET);
  });
});

describe('parse-cost ceiling', () => {
  it('a max-size segment parses under the ceiling and hits the line cap; an over-inflating one is skipped', async () => {
    const lines: string[] = [];
    for (let i = 0; i < MAX_SEGMENT_LINES + 500; i++) {
      const rand = crypto.getRandomValues(new Uint8Array(64));
      let bin = '';
      for (const byte of rand) bin += String.fromCharCode(byte);
      lines.push(JSON.stringify({
        kind: 'connection',
        timestamp: '2026-09-08T20:36:26.618Z',
        host: `h${i}.n${i}.example.test`,
        process: 'Chrome',
        route: 'Tono-Exit',
        bytes_up: i % 100,
        bytes_down: i % 200,
        pad: btoa(bin),
      }));
    }
    const gzipped = await gzip(lines.join('\n'));
    expect(gzipped.byteLength).toBeGreaterThan(1 * 1024 * 1024);
    expect(gzipped.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);

    const t0 = Date.now();
    const parsed = await parseAuditSegment(gzipped, {
      userId: 'u-parse-ceiling',
      deviceId: 'd-parse-ceiling',
      receivedAt: Math.floor(Date.parse('2026-09-08T20:36:26.618Z') / 1000),
      gunzip: true,
    });
    const ms = Date.now() - t0;
    expect(
      ms,
      `parseAuditSegment took ${ms} ms on ${gzipped.byteLength} gzip bytes / ${lines.length} lines`,
    ).toBeLessThanOrEqual(PARSE_CEILING_MS);
    expect(parsed.lines).toBe(MAX_SEGMENT_LINES);
    expect(parsed.candidates.size).toBeLessThanOrEqual(MAX_DISTINCT_ETLD1);
    expect(parsed.destinations.size).toBeLessThanOrEqual(parsed.lines);


    const inflated = 'a'.repeat(LOG_INFLATED_MAX_BYTES + 4096);
    const bytes = await gzip(inflated);
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
    await afterLogSegment(env as unknown as Env, {
      userId: 'u-inflate',
      deviceId: 'd-inflate',
      bytes,
      receivedAt: Math.floor(Date.now() / 1000),
    });
    const row = await db().prepare(
      'SELECT COUNT(*) AS c FROM traffic_destination_daily WHERE user_id = ?',
    ).bind('u-inflate').first<{ c: number }>();
    expect(Number(row?.c)).toBe(0);
  });
});
