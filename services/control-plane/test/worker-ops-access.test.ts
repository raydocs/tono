import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import adminWorker from '../src/admin-worker';
import {
  ADMIN_TOKEN,
  api,
  json,
  admin,
  ACCESS_TEAM_DOMAIN,
  ACCESS_ADMIN_EMAIL,
  absorbedHostFetches,
  oidcPublicKey,
  accessAssertion,
  operations,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('does not report success when an admin patches a missing user', async () => {
    const response = await admin(`users/${crypto.randomUUID()}`, { status: 'disabled' }, 'PATCH');
    expect(response.status).toBe(404);
    expect((await response.json() as any).error.code).toBe('NOT_FOUND');
  });

  it('fails the operations boundary closed and never accepts the legacy admin token', async () => {
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = undefined;
    const unconfigured = await api('ops/dashboard', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unconfigured.status).toBe(503);
    expect((await unconfigured.json() as any).error.code).toBe('ACCESS_MISCONFIGURED');

    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    for (const method of ['GET', 'OPTIONS']) {
      const legacyTokenOnly = await api('ops/dashboard', {
        method,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(legacyTokenOnly.status).toBe(401);
      expect((await legacyTokenOnly.json() as any).error.code).toBe('ACCESS_UNAUTHORIZED');
    }

    const staticContext = createExecutionContext();
    const staticWithoutAccess = await worker.fetch(
      new Request('https://test/ops/', { method: 'OPTIONS' }),
      env as unknown as Env,
      staticContext,
    );
    await waitOnExecutionContext(staticContext);
    expect(staticWithoutAccess.status).toBe(401);

    const nonAdmin = await operations('dashboard', 'viewer@example.com');
    expect(nonAdmin.status).toBe(403);
    expect((await nonAdmin.json() as any).error.code).toBe('ACCESS_FORBIDDEN');

    const currentTime = Math.floor(Date.now() / 1_000);
    const invalidAssertions = [
      'not-a-jwt',
      await accessAssertion(ACCESS_ADMIN_EMAIL, { iss: 'https://wrong.cloudflareaccess.com' }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, { aud: 'wrong-access-audience' }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, { exp: currentTime - 1 }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, { iat: currentTime + 120 }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, { nbf: currentTime + 120 }),
      await accessAssertion(ACCESS_ADMIN_EMAIL, {}, { kid: 'unknown-access-key' }),
    ];
    const valid = await accessAssertion(ACCESS_ADMIN_EMAIL);
    const [validHeader, validPayload, validSignature] = valid.split('.');
    invalidAssertions.push(`${validHeader}.${validPayload}.${validSignature[0] === 'A' ? 'B' : 'A'}${validSignature.slice(1)}`);
    for (const assertion of invalidAssertions) {
      const rejected = await api('ops/dashboard', {
        headers: { 'cf-access-jwt-assertion': assertion },
      });
      expect(rejected.status).toBe(401);
    }

    (env as unknown as Env).ACCESS_TEAM_DOMAIN = 'unavailable-team.cloudflareaccess.com';
    const unavailable = await api('ops/dashboard', {
      headers: { 'cf-access-jwt-assertion': valid },
    });
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json() as any).error.code).toBe('ACCESS_UNAVAILABLE');
  });

  it('reports unavailable when an Access key response body fails without rejecting the session', async () => {
    const team = 'body-failure.cloudflareaccess.com';
    const e = env as unknown as Env;
    const originalTeam = e.ACCESS_TEAM_DOMAIN;
    e.ACCESS_TEAM_DOMAIN = team;
    const originalFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
    let failBody = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `https://${team}/cdn-cgi/access/certs`) {
        if (failBody) {
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"keys":['));
              controller.error(new TypeError('Access key connection reset'));
            },
          }));
        }
        return Response.json({ keys: [oidcPublicKey] });
      }
      return originalFetch(input, init);
    });
    try {
      const assertion = await accessAssertion(ACCESS_ADMIN_EMAIL, { iss: `https://${team}` });
      const read = () => api('ops/dashboard', {
        headers: { 'cf-access-jwt-assertion': assertion },
      });
      const unavailable = await read();
      expect(unavailable.status).toBe(503);
      expect((await unavailable.json() as any).error.code).toBe('ACCESS_UNAVAILABLE');
      failBody = false;
      expect((await read()).status).toBe(200);
    } finally {
      fetchSpy.mockImplementation(originalFetch);
      e.ACCESS_TEAM_DOMAIN = originalTeam;
    }
  });

  it('reports an empty live state to Access admins without fetching an absorbed host', async () => {
    const unauthorized = await api('ops/live', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unauthorized.status).toBe(401);

    // No collector has pushed a snapshot yet in this suite's database.
    absorbedHostFetches.length = 0;
    const response = await operations('live');
    expect(response.status).toBe(200);
    const { live } = await response.json() as any;
    expect(live.quality).toBeNull();
    expect(live.agents).toBeNull();
    expect(live.qualityError).toBe('no quality snapshot');
    expect(live.agentsError).toBe('no agent snapshot');
    expect(live.qualityReceivedAt).toBeNull();
    expect(live.agentsReceivedAt).toBeNull();
    // The console showing "no snapshot" is the point: the previous code showed
    // a JSON parse error here, having fetched its own redirect.
    expect(absorbedHostFetches).toEqual([]);
  });

  it('lets the VPS collector store a live snapshot that ops/live serves without origin fetches', async () => {
    const missing = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ report: { nodes: [] } }),
    });
    expect(missing.status).toBe(503);
    expect((await missing.json() as any).error.code).toBe('OPS_INGEST_UNCONFIGURED');

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const unauthorized = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ report: { nodes: [] } }),
    });
    expect(unauthorized.status).toBe(401);

    const ingested = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer collector-test-token-with-at-least-32-chars',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        report: {
          updated_at: 1_786_270_932,
          updated_at_iso: '2026-08-09T10:00:00Z',
          cn_agents_configured: 3,
          nodes: [{
            name: 'Stored Node',
            host: '203.0.113.20',
            public_ip: '203.0.113.20',
            ok: true,
            quality: 'poor',
            risk_keywords: ['blacklist'],
            route_keywords: ['CN2 GIA'],
            block: {
              status: 'LIKELY_BLOCKED',
              label: '疑似被墙',
              rule: '大陆 agent ≥2/3 失败',
              mainland: { status: 'LIKELY_BLOCKED', success: 0, fail: 3, total: 3, authoritative: true },
              asia_edge: { ok: true, success: 3, total: 3 },
              overseas: { ok: true, success: 6, total: 6 },
            },
            security_check: 'IP quality body',
            backtrace: '163 / 4837',
            risk_signals: [
              { tag: 'attacker', yes: 1, no: 2 },
              { tag: 'spamhaus', yes: 1, no: 0 },
              { tag: '', yes: 9, no: 0 },
              { tag: 'negative', yes: -1, no: 0 },
            ],
            exposure: {
              clean: false,
              sshPorts: [30022, 70000],
              unexpected: [{ port: 25775, address: '0.0.0.0', process: 'python3' }],
              acknowledged: [
                { port: 8388, address: '0.0.0.0', process: 'ssserver', reason: 'family member' },
              ],
              expected: [{ port: 443, address: '*', process: 'xray' }],
            },
            secret: 'must-not-be-stored',
          }],
        },
        agents: {
          data: [{
            name: 'Stored Node', os: 'Debian', arch: 'amd64',
            token: 'must-not-leak', ipv4: '203.0.113.20',
            cpu_cores: 2, load_1: 3.5, load_5: 2.1, load_15: 1.0,
            swap_total: 1048576, swap_used: 524288,
            tcp_connections: 189, process: 71, observed_at: 1_786_715_907,
            carriers: {
              telecom: {
                latencyMs: 148.3, lossPct: 0, samples: 9,
                targets: ['三网-电信-上海', '三网-电信-天津'],
                history: [{ latencyMs: 148.3, lossPct: 0 }, { latencyMs: null, lossPct: null }],
              },
              // Komari reports a ping task no agent has run as `avg: 0,
              // loss: 0` — field for field a flawless result. It must not
              // survive as a carrier, or the console prints "0 ms, 0% loss"
              // for a path nothing has travelled.
              mobile: { latencyMs: 0, lossPct: 0, samples: 0, targets: [], history: [] },
            },
          }],
        },
      }),
    });
    expect(ingested.status).toBe(200);
    expect(await ingested.json()).toMatchObject({ ok: true, qualityNodes: 1, agentCount: 1 });

    absorbedHostFetches.length = 0;
    const response = await operations('live');
    expect(response.status).toBe(200);
    const { live } = await response.json() as any;
    expect(live.quality.nodes).toHaveLength(1);
    expect(live.quality.nodes[0]).toMatchObject({
      name: 'Stored Node',
      publicIp: '203.0.113.20',
      quality: 'poor',
      block: {
        status: 'LIKELY_BLOCKED',
        asiaEdge: { success: 3, total: 3 },
      },
    });
    expect(live.quality.nodes[0].secret).toBeUndefined();
    // The raw collector text bodies are stored but never shipped in the list
    // payloads the console polls; the drawer fetches them per node instead.
    expect(live.quality.nodes[0].securityCheck).toBeUndefined();
    expect(live.quality.nodes[0].backtrace).toBeUndefined();
    const qualityText = await operations('fleet-nodes/Stored%20Node/quality-text');
    expect(qualityText.status).toBe(200);
    expect(await qualityText.json()).toEqual({
      securityCheck: 'IP quality body',
      backtrace: '163 / 4837',
    });
    const unknownText = await operations('fleet-nodes/No%20Such%20Node/quality-text');
    expect(unknownText.status).toBe(200);
    expect(await unknownText.json()).toEqual({ securityCheck: null, backtrace: null });
    // The tally travels, so the console can say "1 of 3 databases" rather than
    // printing the word "attacker" as though it were settled.
    expect(live.quality.nodes[0].riskSignals).toEqual([
      { tag: 'attacker', yes: 1, no: 2 },
      { tag: 'spamhaus', yes: 1, no: 0 },
    ]);
    expect(live.quality.nodes[0].exposure).toMatchObject({
      clean: false,
      sshPorts: [30022],
      unexpected: [{ port: 25775, address: '0.0.0.0', process: 'python3' }],
      acknowledged: [{ port: 8388, reason: 'family member' }],
    });
    expect(live.quality.cnAgentsConfigured).toBe(3);
    expect(live.agents).toEqual([{
      name: 'Stored Node', os: 'Debian', arch: 'amd64', cpuName: null,
      cpu: null, memTotal: null, memUsed: null, diskTotal: null, diskUsed: null,
      netIn: null, netOut: null, uptime: null,
      // Pressure, not inventory: load against cores separates a busy node from
      // one failing to keep up, and `observedAt` is the only thing that tells a
      // stalled agent from a healthy idle one.
      cpuCores: 2, load1: 3.5, load5: 2.1, load15: 1.0,
      // Only the carrier that was actually probed. `mobile` came in with zero
      // samples and is absent rather than perfect.
      carriers: {
        telecom: {
          latencyMs: 148.3, lossPct: 0, samples: 9,
          targets: ['三网-电信-上海', '三网-电信-天津'],
          history: [{ latencyMs: 148.3, lossPct: 0 }, { latencyMs: null, lossPct: null }],
        },
      },
      swapTotal: 1048576, swapUsed: 524288,
      tcpConnections: 189, processes: 71, observedAt: 1_786_715_907,
      price: null, currency: null, billingCycle: null, expiredAt: null,
      trafficLimit: null, trafficLimitType: null,
    }]);
    // The address and the agent token must still never survive ingest.
    expect(JSON.stringify(live.agents)).not.toContain('must-not-leak');
    expect(JSON.stringify(live.agents)).not.toContain('203.0.113.20');
    expect(live.agentsError).toBeNull();
    expect(live.qualityError).toBeNull();
    expect(live.agentsReceivedAt).toEqual(expect.any(Number));
    expect(live.qualityReceivedAt).toEqual(expect.any(Number));
    expect(absorbedHostFetches).toEqual([]);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('keeps agent minutes and serves them as metrics instead of overwriting a singleton', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const token = {
      authorization: 'Bearer collector-test-token-with-at-least-32-chars',
      'content-type': 'application/json',
    };
    const t0 = Math.floor(Date.now() / 1000) - 120;
    const t1 = t0 + 60;
    for (const [cpu, observedAt] of [[10, t0], [40, t1]] as const) {
      const ingested = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: token,
        body: JSON.stringify({
          agents: {
            data: [{
              name: 'Trend Node',
              cpu,
              cpu_cores: 2,
              load_1: 1.2,
              mem_used: 512,
              mem_total: 1024,
              observed_at: observedAt,
              price: 5.5,
              currency: '$',
              billing_cycle: 30,
              expired_at: 1_790_000_000,
              traffic_limit: 1_000_000_000,
              traffic_limit_type: 'sum',
            }],
          },
        }),
      });
      expect(ingested.status).toBe(200);
    }

    const live = await operations('live');
    expect((await live.json() as any).live.agents[0]).toMatchObject({
      name: 'Trend Node',
      cpu: 40,
      price: 5.5,
      currency: '$',
      billingCycle: 30,
      expiredAt: 1_790_000_000,
      trafficLimit: 1_000_000_000,
      trafficLimitType: 'sum',
    });

    const metrics = await operations('metrics?range=24h&node=Trend%20Node');
    expect(metrics.status).toBe(200);
    const body = await metrics.json() as any;
    expect(body.metrics.series['Trend Node'].length).toBeGreaterThanOrEqual(2);
    expect(body.metrics.series['Trend Node'].map((p: { cpu: number }) => p.cpu)).toEqual(
      expect.arrayContaining([10, 40]),
    );
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('rejects an unknown metrics range instead of silently serving 24 hours', async () => {
    const response = await operations('metrics?range=24hours');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Unsupported metrics range' },
    });
  });

  it('pins future collector clocks to receipt time in live state and metrics', async () => {
    const collectorToken = 'collector-test-token-with-at-least-32-chars';
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = collectorToken;
    const before = Math.floor(Date.now() / 1_000);
    const futureMilliseconds = (before + 86_400) * 1_000;
    try {
      const ingested = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${collectorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          report: {
            updated_at: futureMilliseconds,
            updated_at_iso: '2126-01-01T00:00:00Z',
            nodes: [{ name: 'Future clock', ok: true }],
          },
          agents: {
            data: [{ name: 'Future clock', cpu: 15, observed_at: futureMilliseconds }],
          },
        }),
      });
      expect(ingested.status).toBe(200);
      const after = Math.floor(Date.now() / 1_000);

      const response = await operations('live');
      const { live } = await response.json() as any;
      const agent = live.agents.find((row: any) => row.name === 'Future clock');
      expect(agent.observedAt).toBeGreaterThanOrEqual(before);
      expect(agent.observedAt).toBeLessThanOrEqual(after);
      expect(live.agentsReceivedAt).toBeGreaterThanOrEqual(before);
      expect(live.agentsReceivedAt).toBeLessThanOrEqual(after);
      expect(live.quality.updatedAt).toBeGreaterThanOrEqual(before);
      expect(live.quality.updatedAt).toBeLessThanOrEqual(after);
      expect(live.qualityReceivedAt).toBeGreaterThanOrEqual(before);
      expect(live.qualityReceivedAt).toBeLessThanOrEqual(after);
      expect(live.quality.updatedAtIso)
        .toBe(new Date(live.quality.updatedAt * 1_000).toISOString());

      const sampleRow = await env.DB.prepare(
        `SELECT observed_at FROM operations_agent_samples
         WHERE node_name = 'Future clock'`,
      ).first<any>();
      expect(Number(sampleRow.observed_at)).toBe(Math.floor(agent.observedAt / 60) * 60);

      const metrics = await operations('metrics?range=24h&node=Future%20clock');
      const points = ((await metrics.json() as any).metrics.series['Future clock']) as any[];
      expect(points).toHaveLength(1);
      expect(points[0].t).toBe(Number(sampleRow.observed_at));
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('does not let a collector that predates exposure look like a clean node', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const ingested = await api('ops-ingest/snapshot', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer collector-test-token-with-at-least-32-chars',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ report: { nodes: [{ name: 'Old Collector', ok: true }] } }),
    });
    expect(ingested.status).toBe(200);

    const response = await operations('live');
    const { live } = await response.json() as any;
    const node = live.quality.nodes.find((n: any) => n.name === 'Old Collector');
    // Absent, not clean. A node nobody has looked at is precisely the state the
    // leak lived in, and rendering it as clean would recreate that blind spot.
    expect(node.exposure).toBeNull();
    expect(node.riskSignals).toEqual([]);
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('keeps the stored live snapshot when a collector push parses to empty lists', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const token = {
      authorization: 'Bearer collector-test-token-with-at-least-32-chars',
      'content-type': 'application/json',
    };
    try {
      // While nothing is stored yet an empty list is a legitimate answer.
      const first = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: token,
        body: JSON.stringify({ report: { nodes: [] }, agents: [] }),
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json() as any;
      expect(firstBody.reportIgnoredEmpty).toBeUndefined();
      expect(firstBody.agentsIgnoredEmpty).toBeUndefined();

      const seeded = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: token,
        body: JSON.stringify({
          report: { nodes: [{ name: 'Kept Node', ok: true }] },
          agents: { data: [{ name: 'Kept Node', cpu: 12 }] },
        }),
      });
      expect(seeded.status).toBe(200);

      // A Komari outage that answers with an empty list must not flip every
      // node to "missing" under a fresh timestamp.
      const emptied = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: token,
        body: JSON.stringify({ report: { nodes: [] }, agents: [] }),
      });
      expect(emptied.status).toBe(200);
      const emptiedBody = await emptied.json() as any;
      expect(emptiedBody.reportIgnoredEmpty).toBe(true);
      expect(emptiedBody.agentsIgnoredEmpty).toBe(true);

      const response = await operations('live');
      const { live } = await response.json() as any;
      expect(live.quality.nodes.map((n: any) => n.name)).toContain('Kept Node');
      expect(live.agents.map((a: any) => a.name)).toContain('Kept Node');
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('sends a path-style console link to the page it names instead of a 404', async () => {
    for (const [path, hash] of [
      ['/ops/monitor', '/ops/?legacy=ops1#/monitor'],
      ['/ops/users/', '/ops/?legacy=ops1#/users'],
      ['/ops/dashboard', '/ops/?legacy=ops1#/dashboard'],
    ] as const) {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request(`https://admin.afk.ccwu.cc${path}`),
        env as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(hash);
    }

    // Retired hashed assets cannot boot a second UI; modern assets still use
    // the guarded asset path rather than becoming page redirects.
    for (const path of ['/ops/assets/index-abc123.js', '/ops2/assets/index-abc123.js']) {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request(`https://admin.afk.ccwu.cc${path}`),
        env as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).not.toBe(302);
    }
  });

  it('requires an Access admin before serving the sole ops console assets', async () => {
    const request = async (assertion?: string) => {
      const context = createExecutionContext();
      const response = await worker.fetch(new Request('https://test/ops/', {
        headers: assertion ? { 'cf-access-jwt-assertion': assertion } : {},
      }), env as unknown as Env, context);
      await waitOnExecutionContext(context);
      return response;
    };
    expect((await request()).status).toBe(401);
    expect((await request(await accessAssertion('not-an-admin@example.com'))).status).toBe(403);
  });

  it('stops cross-site ops writes before the origin header is stripped for the API worker', async () => {
    const forwarded: Request[] = [];
    const adminEnv = {
      API: {
        fetch: async (request: Request) => {
          forwarded.push(request);
          return Response.json({ ok: true });
        },
      },
    } as unknown as Parameters<typeof adminWorker.fetch>[1];
    const attempt = async (method: string, headers: Record<string, string>) => {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request('https://admin.afk.ccwu.cc/api/v1/ops/signup-allowlist', {
          method,
          headers,
          ...(method === 'GET' ? {} : { body: '{"email":"csrf@example.com"}' }),
        }),
        adminEnv,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    };

    // The no-preflight vector: a cross-site form post carrying the Access
    // cookie. Sends both the foreign Origin and sec-fetch-site: cross-site.
    const formPost = await attempt('POST', {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'text/plain',
    });
    expect(formPost.status).toBe(403);
    expect((await formPost.json() as any).error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(forwarded).toHaveLength(0);

    // A write with no provenance at all is refused rather than assumed safe.
    const anonymous = await attempt('DELETE', { 'content-type': 'application/json' });
    expect(anonymous.status).toBe(403);
    expect(forwarded).toHaveLength(0);

    // The console's own writes carry sec-fetch-site: same-origin, or on older
    // browsers only an Origin matching the admin host — both pass, and the
    // Origin header is still stripped before the service binding.
    const sameOrigin = await attempt('POST', {
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    });
    expect(sameOrigin.status).toBe(200);
    const ownOrigin = await attempt('POST', {
      origin: 'https://admin.afk.ccwu.cc',
      'content-type': 'application/json',
    });
    expect(ownOrigin.status).toBe(200);
    expect(forwarded).toHaveLength(2);
    expect(forwarded[1].headers.get('origin')).toBeNull();

    // Reads are unaffected: a cross-site GET leaks no state and still forwards.
    const read = await attempt('GET', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    expect(read.status).toBe(200);
    expect(forwarded).toHaveLength(3);
  });
});
