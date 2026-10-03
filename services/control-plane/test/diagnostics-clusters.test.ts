import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jwtSign } from '../src/crypto';
import worker, { type Env } from '../src/index';
import { storeDiagnosticsBundle } from '../src/telemetry/diagnostics';
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

  it('keeps a live outage together when a delayed report arrives out of order', async () => {
    const atMs = 1_800_000_000_000;
    const first = await recordFailureCluster(db(), failureInput('delayed', atMs), clusterEnv(), atMs / 1000);
    const delayed = await recordFailureCluster(
      db(), failureInput('delayed', atMs - 3_600_000), clusterEnv(), atMs / 1000 + 30,
    );
    const latest = await recordFailureCluster(
      db(), failureInput('delayed', atMs + 60_000), clusterEnv(), atMs / 1000 + 60,
    );
    expect(delayed.clusterId).toBe(first.clusterId);
    expect(latest.clusterId).toBe(first.clusterId);
    const cluster = await db().prepare(
      'SELECT last_seen_ms, event_count, status FROM failure_clusters WHERE id = ?',
    ).bind(first.clusterId).first();
    expect(cluster).toMatchObject({ last_seen_ms: atMs + 60_000, event_count: 3, status: 'open' });
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
      cluster: { id: string; count: number; sample: Record<string, unknown> };
      detailPath: string;
    };
    expect(opened.schemaVersion).toBe(1);
    expect(opened.kind).toBe('failure_cluster');
    expect(opened.reason).toBe('opened');
    expect(opened.severity).toBe('normal');
    expect(opened.cluster.id).toBe(first.clusterId);
    expect(opened.cluster.count).toBe(1);
    expect(opened.detailPath).toBe(`/api/v1/diagnostics/clusters/${first.clusterId}`);
    expect(opened.cluster.sample).toEqual({
      appBuild: '74', gitCommit: null, coreVersion: null, channel: 'release',
    });
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

  /// Codex pre-deploy review (57c1c64c..66a5bc5c): regex redaction kept a
  /// hostname and an IPv6 resolver in the cluster sample, and the webhook sent
  /// them to a third party. An alert carries classified fields only.
  it('alerts and stores a failure report without its error text', async () => {
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_URL = HOOK;
    (env as unknown as Env).FAILURE_ALERT_WEBHOOK_SECRET = SECRET;
    const { calls } = hookSpy();
    const account = await seedAccount();
    // Every client-supplied field, not only `error`: a length check is not a class.
    const response = await api('telemetry/failures', json({
      ts: Date.now(), stage: 'securingDNS', code: 'DNS_PRIVACY_PROBE', node: 'private.example.com',
      appVersion: '203.0.113.9', osVersion: 'Windows 10', osArch: 'x86_64', platform: 'windows',
      appBuild: 'password=s3cret', gitCommit: 'private.example.com', coreVersion: 'peer 2001:db8::53',
      error: 'lookup private.example.com on [2001:db8::53]:53 failed',
    }, account.token));
    expect(response.status).toBe(202);
    expect(calls).toHaveLength(1);
    for (const leaked of ['private.example.com', '2001:db8', '203.0.113.9', 's3cret']) {
      expect(calls[0].body).not.toContain(leaked);
    }
    expect((JSON.parse(calls[0].body) as { cluster: Record<string, unknown> }).cluster).toMatchObject({
      code: 'DNS_PRIVACY_PROBE', stage: 'securingDNS', platform: 'windows',
      node: '[unlisted]', appVersion: '[unclassified]',
    });
    const cluster = await db().prepare(
      "SELECT sample_json FROM failure_clusters WHERE code = 'DNS_PRIVACY_PROBE'",
    ).first<{ sample_json: string }>();
    expect(cluster?.sample_json).not.toContain('private.example.com');
    expect(cluster?.sample_json).not.toContain('2001:db8');
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

  it('stores no partial bundle when a later hop is invalid', async () => {
    const account = await seedAccount();
    const payload = bundle();
    const hop = payload.hops[1];
    if (!hop) throw new Error('Missing second hop in bundle fixture');
    hop.role = 'invalid';
    const response = await api('telemetry/diagnostics', json(payload, account.token));
    expect(response.status).toBe(400);
    const session = await db().prepare(
      'SELECT COUNT(*) AS count FROM client_sessions WHERE user_id = ?',
    ).bind(account.userId).first();
    const hops = await db().prepare(
      'SELECT COUNT(*) AS count FROM chain_hops WHERE user_id = ?',
    ).bind(account.userId).first();
    expect(session?.count).toBe(0);
    expect(hops?.count).toBe(0);
  });

  it('acknowledges committed diagnostic facts when derived clustering fails', async () => {
    const account = await seedAccount();
    const real = db();
    const unavailable = new Proxy(real, {
      get(target, prop) {
        if (prop === 'prepare') return (sql: string) => {
          if (sql.includes('failure_clusters')) throw new Error('cluster storage unavailable');
          return target.prepare(sql);
        };
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(storeDiagnosticsBundle(
      unavailable, account.userId, account.deviceId, bundle(), clusterEnv(),
    )).resolves.toMatchObject({ events: 1 });
    const event = await real.prepare(
      'SELECT COUNT(*) AS count FROM connection_events WHERE user_id = ?',
    ).bind(account.userId).first();
    expect(event?.count).toBe(1);
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

  it('keeps a completed session when its delayed start report arrives', async () => {
    const account = await seedAccount();
    const atMs = Date.now();
    const payload = bundle(atMs);
    const completed = { ...payload, session: { ...payload.session, endedAtMs: atMs, outcome: 'ok' } };
    expect((await api('telemetry/diagnostics', json(completed, account.token))).status).toBe(202);
    const { bytesUp: _up, bytesDown: _down, outcome: _outcome, ...started } = payload.session;
    expect((await api('telemetry/diagnostics', json({ ...payload, session: started }, account.token))).status).toBe(202);
    const session = await db().prepare(
      'SELECT ended_at_ms, bytes_up, bytes_down, outcome FROM client_sessions WHERE user_id = ?',
    ).bind(account.userId).first();
    expect(session).toMatchObject({ ended_at_ms: atMs, bytes_up: 100, bytes_down: 400, outcome: 'ok' });
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

describe('automatic diagnostic excerpt privacy', () => {
  it('stores structured facts without an arbitrary IPv6 and token log excerpt', async () => {
    const account = await seedAccount();
    const payload = {
      ...bundle(),
      logExcerpt: 'dial tcp [2001:db8:1234::9]:443 failed token=private-token',
    };
    expect((await api('telemetry/diagnostics', json(payload, account.token))).status).toBe(202);
    const session = await db().prepare(
      'SELECT log_excerpt, bytes_down, outcome FROM client_sessions WHERE user_id = ?',
    ).bind(account.userId).first();
    expect(session).toMatchObject({ log_excerpt: null, bytes_down: 400, outcome: 'fail' });
  });

  /// The same review: `session.reason` took 80 characters of prose, so a core
  /// line with a password and a peer address was stored. It is a classified
  /// token or the bundle is refused.
  it('refuses a session reason that is prose and stores a classified one', async () => {
    const account = await seedAccount();
    const withReason = (reason: string) => {
      const base = bundle();
      return { ...base, session: { ...base.session, reason } };
    };
    const prose = await api('telemetry/diagnostics', json(
      withReason('SOCKS5 password=s3cret peer=203.0.113.9'), account.token,
    ));
    expect(prose.status).toBe(400);
    // A hostname is one token to a charset that allows dots; the class has none.
    expect((await api('telemetry/diagnostics', json(withReason('private.example.com'), account.token))).status).toBe(400);
    expect((await api('telemetry/diagnostics', json(withReason('tunnel_lost'), account.token))).status).toBe(202);
    const session = await db().prepare(
      'SELECT reason FROM client_sessions WHERE user_id = ?',
    ).bind(account.userId).first();
    expect(session).toMatchObject({ reason: 'tunnel_lost' });
  });
});
