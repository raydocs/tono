import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jwtSign } from '../src/crypto';
import worker, { type Env } from '../src/index';
import {
  ALERT_HOUR_CAP,
  clusterAlertDecision,
  clusterSeverity,
  isSafeAlertUrl,
  recordFailureCluster,
  type ClusterEnv,
} from '../src/telemetry/failure-clusters';

const JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
const READ = 'diagnostics-read-token-with-32-characters-min';
const HOOK = 'https://bot.example.com/hooks/tono';
const SECRET = 'failure-alert-secret-with-32-characters';
const db = () => (env as unknown as Env).DB;
const clusterEnv = () => env as unknown as ClusterEnv;

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
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(value),
});

async function seedAccount() {
  const t = Math.floor(Date.now() / 1000);
  const userId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const email = `cluster-${userId}@example.com`;
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'x', 'active', 0, ?, ?)`,
  ).bind(userId, email, t, t).run();
  await db().prepare(
    `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
     VALUES(?, ?, ?, 'Test', 'active', ?, ?)`,
  ).bind(deviceId, userId, `inst-${userId}`, t, t).run();
  await db().prepare(
    `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, userId, `h-${sessionId}`, t + 86_400, t, deviceId).run();
  const token = await jwtSign({ sub: userId, sid: sessionId, exp: t + 3600 }, JWT_SECRET);
  return { userId, deviceId, email, token };
}

function bundle(nowMs = Date.now()) {
  return {
    schemaVersion: 1,
    aiServicesConsent: false,
    client: {
      appVersion: '0.0.74',
      appBuild: '74',
      gitCommit: 'abc123',
      platform: 'macos',
      osVersion: 'macOS 15.1',
      coreVersion: '1.8.0',
      channel: 'release',
    },
    session: {
      id: 'sess-0001',
      startedAtMs: nowMs - 10_000,
      node: 'Tokyo',
      entryNodeId: 'entry-a',
      residentialExitId: 'home-1',
      bytesUp: 100,
      bytesDown: 400,
      outcome: 'fail',
    },
    hops: [
      { index: 0, role: 'entry', nodeId: 'entry-a', connected: true, handshakeMs: 40, atMs: nowMs - 9_000 },
      { index: 1, role: 'residential', nodeId: 'home-1', connected: false, failureCode: 'timeout', atMs: nowMs - 8_000 },
    ],
    exitObservations: [{
      atMs: nowMs - 8_000,
      ipPrefix: '203.0.113.0/24',
      ipHash: 'ab'.repeat(32),
      asn: 64512,
      country: 'JP',
      city: 'Tokyo',
      networkKind: 'residential',
    }],
    dnsCheck: {
      atMs: nowMs - 7_000,
      resolver: 'tunnel',
      leakOutside: false,
      geoMatchesExit: true,
      mode: 'fake-ip',
      ipv6Leak: false,
      resolverCountry: 'JP',
      exitCountry: 'JP',
    },
    events: [{
      ts: nowMs - 6_000,
      kind: 'connectFail',
      stage: 'handshake',
      code: 'timeout',
      node: 'Tokyo',
    }],
  };
}

type HookCall = { body: string; timestamp: string; signature: string };

function hookSpy() {
  const calls: HookCall[] = [];
  const original = globalThis.fetch;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === HOOK) {
      const headers = new Headers(init?.headers);
      calls.push({
        body: String(init?.body ?? ''),
        timestamp: headers.get('x-tono-timestamp') ?? '',
        signature: headers.get('x-tono-signature') ?? '',
      });
      return new Response(null, { status: 204 });
    }
    return original(input, init);
  });
  return { calls, spy };
}

function failureInput(code: string, atMs: number) {
  return {
    atMs,
    code,
    stage: 'handshake',
    appVersion: '0.0.74',
    platform: 'macos',
    node: 'Tokyo',
    userId: 'user-cluster',
    deviceId: 'device-cluster',
    appBuild: '74',
    channel: 'release',
    error: 'dial failed for ada@example.com via 203.0.113.9 password=s3cret',
  };
}

describe('failure cluster decisions', () => {
  it('opens on the first event, joins a live cluster, and opens again after the quiet gap', () => {
    const now = 1_700_000_000_000;
    expect(clusterAlertDecision(null, now, 1_700_000_000)).toEqual({ action: 'open', alert: 'opened' });
    const live = { count: 4, countAtAlert: 1, alertedAt: 1_700_000_000, lastSeenMs: now - 60_000 };
    expect(clusterAlertDecision(live, now, 1_700_000_060).alert).toBeNull();
    expect(clusterAlertDecision(
      { ...live, lastSeenMs: now - 31 * 60 * 1000 },
      now,
      1_700_000_000,
    )).toEqual({ action: 'open', alert: 'opened' });
  });

  it('alerts a network-loss cluster on the first event and does not wait for a spike', () => {
    expect(clusterSeverity('TONO_KILL_SWITCH_STUCK')).toBe('p0');
    expect(clusterSeverity('timeout')).toBe('normal');
    const now = 1_700_000_000_000;
    const nowSec = 1_700_000_000;
    expect(clusterAlertDecision(null, now, nowSec, 'p0')).toEqual({ action: 'open', alert: 'opened' });
    const opened = { count: 1, countAtAlert: 1, alertedAt: nowSec, lastSeenMs: now };
    expect(clusterAlertDecision(opened, now + 1000, nowSec + 1, 'p0')).toEqual({
      action: 'join', alert: null,
    });
    expect(clusterAlertDecision(
      { ...opened, count: 20, countAtAlert: 1, alertedAt: nowSec - 20 * 60 },
      now + 20 * 60 * 1000,
      nowSec + 20 * 60,
      'p0',
    ).alert).toBeNull();
  });

  it('rejects webhook URLs that are not public https', () => {
    expect(isSafeAlertUrl(HOOK)).toBe(true);
    expect(isSafeAlertUrl('http://bot.example.com/hooks/tono')).toBe(false);
    expect(isSafeAlertUrl('https://127.0.0.1/hooks')).toBe(false);
    expect(isSafeAlertUrl('https://169.254.169.254/latest')).toBe(false);
    expect(isSafeAlertUrl('https://metadata.google.internal/computeMetadata/v1')).toBe(false);
  });
});

describe('failure cluster webhook', () => {
  afterEach(() => {
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_URL = undefined;
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_SECRET = undefined;
    (env as unknown as Env).DIAGNOSTICS_READ_TOKEN = undefined;
    vi.restoreAllMocks();
  });

  it('sends one signed alert for an outage and a second only after a spike', async () => {
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_URL = HOOK;
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_SECRET = SECRET;
    const { calls } = hookSpy();
    const baseMs = 1_800_000_000_000;
    const baseSec = 1_800_000_000;
    const first = await recordFailureCluster(db(), failureInput('timeout', baseMs), clusterEnv(), baseSec);
    expect(first.alerted).toBe(true);
    for (let index = 1; index < 10; index++) {
      const joined = await recordFailureCluster(
        db(),
        failureInput('timeout', baseMs + index * 1000),
        clusterEnv(),
        baseSec + index,
      );
      expect(joined.clusterId).toBe(first.clusterId);
      expect(joined.alerted).toBe(false);
    }
    const spiked = await recordFailureCluster(
      db(),
      failureInput('timeout', baseMs + 20 * 60 * 1000),
      clusterEnv(),
      baseSec + 20 * 60,
    );
    expect(spiked.alerted).toBe(true);
    expect(spiked.clusterId).toBe(first.clusterId);
    const quiet = await recordFailureCluster(
      db(),
      failureInput('timeout', baseMs + 21 * 60 * 1000),
      clusterEnv(),
      baseSec + 20 * 60 + 30,
    );
    expect(quiet.alerted).toBe(false);
    expect(calls).toHaveLength(2);
    const opened = JSON.parse(calls[0].body) as {
      schemaVersion: number;
      kind: string;
      severity: string;
      reason: string;
      cluster: { id: string; count: number; sample: { error: string } };
      detailPath: string;
    };
    expect(opened.schemaVersion).toBe(1);
    expect(opened.kind).toBe('failure_cluster');
    expect(opened.reason).toBe('opened');
    expect(opened.severity).toBe('normal');
    expect(opened.cluster.id).toBe(first.clusterId);
    expect(opened.cluster.count).toBe(1);
    expect(opened.detailPath).toBe(`/api/v1/diagnostics/clusters/${first.clusterId}`);
    expect(opened.cluster.sample.error).toContain('[redacted]');
    expect(opened.cluster.sample.error).not.toContain('ada@example.com');
    expect(opened.cluster.sample.error).not.toContain('203.0.113.9');
    expect(opened.cluster.sample.error).not.toContain('s3cret');
    expect(calls[0].signature.startsWith('sha256=')).toBe(true);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${calls[0].timestamp}.${calls[0].body}`),
    );
    const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(calls[0].signature).toBe(`sha256=${hex}`);
    expect(JSON.parse(calls[1].body).reason).toBe('spike');
  });

  it('does not call the webhook when the URL or secret is unset or the URL is private', async () => {
    const { calls } = hookSpy();
    const atMs = 1_800_000_100_000;
    await recordFailureCluster(db(), failureInput('unset', atMs), clusterEnv(), 1_800_000_100);
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_URL = 'https://10.0.0.8/hooks';
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_SECRET = SECRET;
    await recordFailureCluster(db(), failureInput('private', atMs + 1), clusterEnv(), 1_800_000_101);
    expect(calls).toHaveLength(0);
    const sends = await db().prepare('SELECT COUNT(*) AS n FROM failure_alert_sends').first<{ n: number }>();
    expect(Number(sends?.n)).toBe(0);
  });

  it('stops sending after the hourly alert cap', async () => {
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_URL = HOOK;
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_SECRET = SECRET;
    const { calls } = hookSpy();
    const atMs = 1_800_000_200_000;
    for (let index = 0; index < ALERT_HOUR_CAP + 1; index++) {
      await recordFailureCluster(db(), failureInput(`cap-${index}`, atMs + index), clusterEnv(), 1_800_000_200);
    }
    expect(calls).toHaveLength(ALERT_HOUR_CAP);
  });

  it('sends a p0 network-loss alert on the first event even after the hourly cap', async () => {
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_URL = HOOK;
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_SECRET = SECRET;
    const { calls } = hookSpy();
    const atMs = 1_800_000_300_000;
    for (let index = 0; index < ALERT_HOUR_CAP; index++) {
      await recordFailureCluster(db(), failureInput(`cap-p0-${index}`, atMs + index), clusterEnv(), 1_800_000_300);
    }
    expect(calls).toHaveLength(ALERT_HOUR_CAP);
    const p0 = await recordFailureCluster(
      db(),
      failureInput('TONO_NETWORK_LOSS', atMs + 100),
      clusterEnv(),
      1_800_000_300,
    );
    expect(p0.alerted).toBe(true);
    const second = await recordFailureCluster(
      db(),
      failureInput('TONO_NETWORK_LOSS', atMs + 200),
      clusterEnv(),
      1_800_000_301,
    );
    expect(second.alerted).toBe(false);
    expect(second.clusterId).toBe(p0.clusterId);
    expect(calls).toHaveLength(ALERT_HOUR_CAP + 1);
    const body = JSON.parse(calls[ALERT_HOUR_CAP].body) as { severity: string; reason: string; cluster: { code: string; count: number } };
    expect(body.severity).toBe('p0');
    expect(body.reason).toBe('opened');
    expect(body.cluster.code).toBe('TONO_NETWORK_LOSS');
    expect(body.cluster.count).toBe(1);
  });
});

describe('diagnostics read API', () => {
  afterEach(() => {
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_URL = undefined;
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_SECRET = undefined;
    (env as unknown as Env).DIAGNOSTICS_READ_TOKEN = undefined;
  });

  it('stores a privacy-safe bundle and rejects a full IP or an AI route without consent', async () => {
    const account = await seedAccount();
    const accepted = await api('telemetry/diagnostics', json(bundle(), account.token));
    expect(accepted.status).toBe(202);
    const session = await db().prepare(
      'SELECT app_version, channel, bytes_down FROM client_sessions WHERE user_id = ?',
    ).bind(account.userId).first<{ app_version: string; channel: string; bytes_down: number }>();
    expect(session).toMatchObject({ app_version: '0.0.74', channel: 'release', bytes_down: 400 });
    const prefix = await db().prepare(
      'SELECT ip_prefix FROM session_exit_observations WHERE user_id = ?',
    ).bind(account.userId).first<{ ip_prefix: string }>();
    expect(prefix?.ip_prefix).toBe('203.0.113.0/24');

    const leaked = bundle();
    leaked.exitObservations[0].ipPrefix = '203.0.113.9';
    expect((await api('telemetry/diagnostics', json(leaked, account.token))).status).toBe(400);

    const consented = bundle();
    (consented as { aiRoutes?: unknown[]; aiServicesConsent: boolean }).aiServicesConsent = false;
    (consented as { aiRoutes?: unknown[] }).aiRoutes = [{
      bucketStartMs: Date.now() - 5_000,
      service: 'claude',
      exitKind: 'residential',
      exitId: 'home-1',
      exitCountry: 'JP',
      routingLeak: false,
      exitSwitched: false,
    }];
    expect((await api('telemetry/diagnostics', json(consented, account.token))).status).toBe(400);
    const ai = await db().prepare(
      'SELECT COUNT(*) AS n FROM ai_service_routes WHERE user_id = ?',
    ).bind(account.userId).first<{ n: number }>();
    expect(Number(ai?.n)).toBe(0);
  });

  it('lists a window and returns the cluster timeline only to the read token', async () => {
    const account = await seedAccount();
    expect((await api('telemetry/diagnostics', json(bundle(), account.token))).status).toBe(202);
    (env as unknown as Env).DIAGNOSTICS_READ_TOKEN = undefined;
    expect((await api('diagnostics/clusters')).status).toBe(503);
    (env as unknown as Env).DIAGNOSTICS_READ_TOKEN = READ;
    expect((await api('diagnostics/clusters')).status).toBe(401);
    expect((await api('diagnostics/clusters', { headers: { authorization: `Bearer ${account.token}` } })).status).toBe(401);
    expect((await api('diagnostics/clusters/not-a-cluster', {
      method: 'POST',
      headers: { authorization: `Bearer ${READ}` },
    })).status).toBe(405);

    const list = await api('diagnostics/clusters', { headers: { authorization: `Bearer ${READ}` } });
    expect(list.status).toBe(200);
    const listed = await list.json() as { clusters: Array<{ id: string; detailPath: string; count: number }> };
    expect(listed.clusters).toHaveLength(1);
    expect(listed.clusters[0].count).toBe(1);
    const detail = await api(
      `diagnostics/clusters/${listed.clusters[0].id}`,
      { headers: { authorization: `Bearer ${READ}` } },
    );
    expect(detail.status).toBe(200);
    const body = await detail.json() as {
      cluster: { appVersion: string; platform: string; node: string };
      sessions: Array<{ appVersion: string; channel: string }>;
      hops: Array<{ role: string }>;
      dnsChecks: Array<{ resolver: string; leakOutside: boolean }>;
      exits: Array<{ ipPrefix: string }>;
    };
    const text = JSON.stringify(body);
    expect(text).not.toContain(account.email);
    expect(text).not.toContain('203.0.113.9');
    expect(body.cluster).toMatchObject({ appVersion: '0.0.74', platform: 'macos', node: 'Tokyo' });
    expect(body.sessions[0]).toMatchObject({ appVersion: '0.0.74', channel: 'release' });
    expect(body.hops.map((hop) => hop.role).sort()).toEqual(['entry', 'residential']);
    expect(body.dnsChecks[0]).toMatchObject({ resolver: 'tunnel', leakOutside: false });
    expect(body.exits[0].ipPrefix).toBe('203.0.113.0/24');
  });
});

// Both callers finish the "is there an open cluster?" read before either
// insert. That is the window where the partial unique index rejects the
// second INSERT and the diagnostics upload 500s.
function holdOpenSelectsUntilBoth(real: D1Database): D1Database {
  let openSelects = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    prepare(sql: string) {
      const statement = real.prepare(sql);
      const holds = sql.includes('FROM failure_clusters')
        && sql.includes("status = 'open'")
        && sql.trimStart().startsWith('SELECT');
      return {
        bind(...values: unknown[]) {
          const bound = statement.bind(...values);
          if (!holds) return bound;
          return new Proxy(bound, {
            get(target, property, receiver) {
              if (property !== 'first') {
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return async () => {
                const row = await target.first();
                openSelects += 1;
                if (openSelects === 2) release();
                if (openSelects <= 2) await gate;
                return row;
              };
            },
          });
        },
      };
    },
  } as unknown as D1Database;
}

describe('failure cluster open race', () => {
  it('counts both events when two opens pass the empty read together', async () => {
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_URL = undefined;
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_SECRET = undefined;
    const atMs = 1_800_100_000_000;
    const raced = holdOpenSelectsUntilBoth(db());
    const [left, right] = await Promise.all([
      recordFailureCluster(raced, failureInput('race-open', atMs), clusterEnv(), 1_800_100_000),
      recordFailureCluster(raced, failureInput('race-open', atMs + 1), clusterEnv(), 1_800_100_000),
    ]);
    expect(left.clusterId).toBe(right.clusterId);
    const row = await db().prepare(
      `SELECT COUNT(*) AS clusters, SUM(event_count) AS events
       FROM failure_clusters WHERE code = 'race-open' AND status = 'open'`,
    ).first<{ clusters: number; events: number }>();
    expect(Number(row?.clusters)).toBe(1);
    expect(Number(row?.events)).toBe(2);
  });
});
