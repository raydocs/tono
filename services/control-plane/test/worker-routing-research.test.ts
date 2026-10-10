import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  api,
  json,
  routingResearchJson,
  admin,
  createAccount,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  const routingResearchPayload = (overrides: Record<string, unknown> = {}) => {
    const observedUntil = Math.floor(Date.now() / 1000) - 60;
    return {
      schemaVersion: 1,
      snapshotId: crypto.randomUUID(),
      observedSince: observedUntil - 6 * 60 * 60,
      observedUntil,
      appVersion: '0.0.1',
      build: '40',
      osVersion: '26.4',
      architecture: 'arm64',
      observedConnectionCount: 3,
      identifiedAppConnectionCount: 2,
      connectionLimitReached: false,
      entries: [
        {
          app: 'other', connectionCount: 1, directConnectionCount: 0,
          proxiedConnectionCount: 1, blockedConnectionCount: 0,
          trafficVolume: 'under_1_mib',
        },
        {
          app: 'wechat', connectionCount: 2, directConnectionCount: 1,
          proxiedConnectionCount: 1, blockedConnectionCount: 0,
          trafficVolume: '10_to_100_mib',
        },
      ],
      ...overrides,
    };
  };

  const routingResearchV2Payload = (overrides: Record<string, unknown> = {}) => ({
    ...routingResearchPayload(),
    schemaVersion: 2,
    bundleComponents: [
      {
        app: 'wechat', bundleComponent: 'main_executable',
        connectionCount: 1, directConnectionCount: 1,
        proxiedConnectionCount: 0, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      },
      {
        app: 'wechat', bundleComponent: 'framework_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: '10_to_100_mib',
      },
    ],
    ...overrides,
  });

  it('upgrades the routing-research table from the 4 KiB v1 constraint', async () => {
    const definition = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'routing_research_snapshots'",
    ).first<any>();
    expect(definition.sql).toContain('length(aggregate_json) <= 8192');

    const account = await createAccount('routing-research-migration');
    const observedUntil = Math.floor(Date.now() / 1000) - 60;
    await expect(env.DB.prepare(
      `INSERT INTO routing_research_snapshots(
         id, snapshot_id, user_id, device_id, received_at, observed_since,
         observed_until, app_version, build, os_version, architecture,
         aggregate_json
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), crypto.randomUUID(), account.user.id,
      account.device.id, observedUntil, observedUntil - 6 * 60 * 60,
      observedUntil, '0.0.1', '40', '26.4', 'arm64', 'x'.repeat(5_000),
    ).run()).resolves.toBeDefined();
  });

  it('stores only a canonical authenticated routing-research aggregate and replays it idempotently', async () => {
    const account = await createAccount('routing-research-happy');
    const payload = routingResearchPayload();
    expect((await api('routing-research/snapshots', json(payload))).status).toBe(401);
    expect((await api(
      'routing-research/snapshots',
      json(payload, account.accessToken),
    )).status).toBe(409);
    const mismatchedOwner = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, 'a-different-account',
      ),
    );
    expect(mismatchedOwner.status).toBe(409);
    expect((await mismatchedOwner.json() as any).error.code).toBe(
      'ROUTING_RESEARCH_OWNER_MISMATCH',
    );

    const accepted = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect(accepted.status).toBe(201);
    const receipt = await accepted.json() as any;
    expect(Object.keys(receipt).sort()).toEqual(['receivedAt', 'snapshotId']);
    expect(receipt.snapshotId).toBe(payload.snapshotId);

    const stored = await env.DB.prepare(
      'SELECT * FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).first<any>();
    expect(stored.user_id).toBe(account.user.id);
    expect(stored.device_id).toBe(account.device.id);
    expect(stored.app_version).toBe('0.0.1');
    expect(stored.build).toBe('40');
    expect(JSON.parse(stored.aggregate_json)).toEqual({
      ...payload,
      snapshotId: payload.snapshotId.toLowerCase(),
      entries: [...payload.entries].sort((left, right) => left.app.localeCompare(right.app)),
    });

    const replay = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(receipt);
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(1);

    const conflict = routingResearchPayload({
      snapshotId: payload.snapshotId,
      observedConnectionCount: 4,
      identifiedAppConnectionCount: 3,
      entries: [
        payload.entries[0],
        {
          ...payload.entries[1], connectionCount: 3,
          proxiedConnectionCount: 2,
        },
      ],
    });
    // Keep the immutable window fields identical so this tests ID reuse rather
    // than an unrelated timestamp difference.
    conflict.observedSince = payload.observedSince;
    conflict.observedUntil = payload.observedUntil;
    const rejectedConflict = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        conflict, account.accessToken, account.user.id,
      ),
    );
    expect(rejectedConflict.status).toBe(409);
    expect((await rejectedConflict.json() as any).error.code).toBe('SNAPSHOT_ID_CONFLICT');

    await expect(env.DB.prepare(
      'UPDATE routing_research_snapshots SET build = ? WHERE snapshot_id = ?',
    ).bind('41', payload.snapshotId).run()).rejects.toThrow(
      /ROUTING_RESEARCH_SNAPSHOT_IMMUTABLE/,
    );
  });

  it('accepts only fixed schema-v2 native bundle component categories', async () => {
    const account = await createAccount('routing-research-components');
    const payload = routingResearchV2Payload({
      bundleComponents: [
        {
          app: 'wechat', bundleComponent: 'main_executable',
          connectionCount: 1, directConnectionCount: 1,
          proxiedConnectionCount: 0, blockedConnectionCount: 0,
          trafficVolume: 'under_1_mib',
        },
        {
          app: 'wechat', bundleComponent: 'framework_helper',
          connectionCount: 1, directConnectionCount: 0,
          proxiedConnectionCount: 1, blockedConnectionCount: 0,
          trafficVolume: '10_to_100_mib',
        },
      ],
    });
    const response = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect(response.status).toBe(201);
    const stored = await env.DB.prepare(
      'SELECT aggregate_json FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).first<any>();
    expect(JSON.parse(stored.aggregate_json).bundleComponents).toEqual([
      payload.bundleComponents[1], payload.bundleComponents[0],
    ]);
  });

  it('accepts the expanded reviewed app families and keeps snapshots bounded', async () => {
    const account = await createAccount('routing-research-expanded-apps');
    const apps = [
      'wechat', 'qq', 'feishu', 'lark', 'dingtalk', 'trae', 'chrome', 'edge',
      'safari', 'firefox', 'arc', 'brave', 'claude', 'wecom',
      'tencent_meeting', 'wps', 'baidu_netdisk', 'alipan', 'douyin',
      'bilibili',
    ];
    const entries = apps.map((app) => ({
      app, connectionCount: 1, directConnectionCount: 0,
      proxiedConnectionCount: 1, blockedConnectionCount: 0,
      trafficVolume: 'under_1_mib',
    }));
    const payload = routingResearchV2Payload({
      observedConnectionCount: entries.length,
      identifiedAppConnectionCount: entries.length,
      connectionLimitReached: true,
      entries,
      bundleComponents: [{
        app: 'tencent_meeting', bundleComponent: 'framework_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      }],
    });
    const accepted = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect(accepted.status).toBe(201);
    const stored = await env.DB.prepare(
      'SELECT aggregate_json FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).first<any>();
    const canonical = JSON.parse(stored.aggregate_json);
    expect(canonical.entries).toHaveLength(20);
    expect(canonical.bundleComponents).toEqual(payload.bundleComponents);
  });

  it('rejects raw metadata, covert strings, malformed totals, timestamps, and oversized research bodies', async () => {
    const account = await createAccount('routing-research-validation');
    const submit = async (payload: unknown) => api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    );
    expect((await submit({
      ...routingResearchPayload(),
      processPath: '/Users/customer/Applications/Private.app',
    })).status).toBe(400);
    expect((await submit({
      ...routingResearchPayload(),
      bundleComponents: [],
    })).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{
        app: 'wechat', bundleComponent: '/Users/customer/WeChat.app',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'none',
      }],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{
        app: 'chrome', bundleComponent: 'framework_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'none',
      }],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{
        app: 'wechat', bundleComponent: 'customer_named_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'none',
      }],
    }))).status).toBe(400);
    const duplicateComponent = routingResearchV2Payload().bundleComponents[0];
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [duplicateComponent, duplicateComponent],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{
        ...duplicateComponent,
        connectionCount: 3, directConnectionCount: 1,
        proxiedConnectionCount: 2,
      }],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      bundleComponents: [{ ...duplicateComponent, executable: 'WeChat' }],
    }))).status).toBe(400);
    expect((await submit(routingResearchV2Payload({
      entries: [
        routingResearchPayload().entries[0],
        { ...routingResearchPayload().entries[1], trafficVolume: 'none' },
      ],
      bundleComponents: [duplicateComponent],
    }))).status).toBe(400);
    const rawEntry = routingResearchPayload();
    rawEntry.entries = [{ ...rawEntry.entries[0], host: 'private.example.com' } as any];
    rawEntry.observedConnectionCount = 1;
    rawEntry.identifiedAppConnectionCount = 0;
    expect((await submit(rawEntry)).status).toBe(400);
    expect((await submit(routingResearchPayload({
      entries: [{
        app: 'private-editor', connectionCount: 3, directConnectionCount: 0,
        proxiedConnectionCount: 3, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      }],
      identifiedAppConnectionCount: 3,
    }))).status).toBe(400);
    const tooManyFixedApps = [
      'wechat', 'qq', 'feishu', 'lark', 'dingtalk', 'trae', 'chrome', 'edge',
      'safari', 'firefox', 'arc', 'brave', 'claude', 'wecom',
      'tencent_meeting', 'wps', 'baidu_netdisk', 'alipan', 'douyin',
      'bilibili', 'netease_music',
    ].map((app) => ({
      app, connectionCount: 1, directConnectionCount: 0,
      proxiedConnectionCount: 1, blockedConnectionCount: 0,
      trafficVolume: 'under_1_mib',
    }));
    expect((await submit(routingResearchPayload({
      observedConnectionCount: tooManyFixedApps.length,
      identifiedAppConnectionCount: tooManyFixedApps.length,
      connectionLimitReached: true,
      entries: tooManyFixedApps,
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      appVersion: '/Users/customer/Documents',
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      build: 'private.example.com',
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      observedConnectionCount: 4,
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      entries: [{
        app: 'wechat', connectionCount: 3, directConnectionCount: 1,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: '10_to_100_mib',
      }],
      identifiedAppConnectionCount: 3,
    }))).status).toBe(400);
    expect((await submit(routingResearchPayload({
      entries: [{
        app: 'wechat', connectionCount: 3, directConnectionCount: 1,
        proxiedConnectionCount: 2, blockedConnectionCount: 0,
        trafficVolume: 'exactly_123_bytes',
      }],
      identifiedAppConnectionCount: 3,
    }))).status).toBe(400);
    const fiveHourUntil = Math.floor(Date.now() / 1000) - 60;
    expect((await submit(routingResearchPayload({
      observedSince: fiveHourUntil - 5 * 60 * 60,
      observedUntil: fiveHourUntil,
    }))).status).toBe(400);
    const staleUntil = Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60;
    expect((await submit(routingResearchPayload({
      observedSince: staleUntil - 6 * 60 * 60,
      observedUntil: staleUntil,
    }))).status).toBe(400);
    expect((await submit({
      ...routingResearchPayload(),
      padding: 'x'.repeat(9 * 1024),
    })).status).toBe(413);
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(0);
  });

  it('caps distinct routing-research snapshots per device without blocking an exact retry', async () => {
    const account = await createAccount('routing-research-rate');
    const accepted: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const payload = routingResearchPayload();
      accepted.push(payload);
      expect((await api(
        'routing-research/snapshots',
        await routingResearchJson(
          payload, account.accessToken, account.user.id,
        ),
      )).status).toBe(201);
    }
    const limited = await api(
      'routing-research/snapshots',
      await routingResearchJson(
        routingResearchPayload(), account.accessToken, account.user.id,
      ),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json() as any).error.code).toBe('RATE_LIMITED');
    expect((await api(
      'routing-research/snapshots',
      await routingResearchJson(
        accepted[0], account.accessToken, account.user.id,
      ),
    )).status).toBe(200);
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(4);
  });

  it('suppresses all routing-research metadata below the cohort minimum', async () => {
    const accounts = await Promise.all([
      createAccount('routing-suppressed-one'),
      createAccount('routing-suppressed-two'),
    ]);
    for (const account of accounts) {
      const payload = routingResearchV2Payload();
      expect((await api(
        'routing-research/snapshots',
        await routingResearchJson(
          payload, account.accessToken, account.user.id,
        ),
      )).status).toBe(201);
    }
    const response = await admin(
      'routing-research/summary?days=30', undefined, 'GET',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      days: 30,
      cohortMinimum: 3,
      suppressed: true,
      byApp: [],
      byBundleComponent: [],
      byBuild: [],
    });
  });

  it('returns only cohort-safe app, route, volume, and build research summaries', async () => {
    const accounts = await Promise.all([
      createAccount('routing-summary-one'),
      createAccount('routing-summary-two'),
      createAccount('routing-summary-three'),
    ]);
    for (const [index, account] of accounts.entries()) {
      const entries = [{
        app: 'wechat', connectionCount: 2, directConnectionCount: 1,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: '10_to_100_mib',
      }];
      if (index === 0) entries.push({
        app: 'safari', connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      });
      const bundleComponents = [{
        app: 'wechat', bundleComponent: 'main_executable',
        connectionCount: 1, directConnectionCount: 1,
        proxiedConnectionCount: 0, blockedConnectionCount: 0,
        trafficVolume: 'under_1_mib',
      }];
      if (index === 0) bundleComponents.push({
        app: 'wechat', bundleComponent: 'framework_helper',
        connectionCount: 1, directConnectionCount: 0,
        proxiedConnectionCount: 1, blockedConnectionCount: 0,
        trafficVolume: '10_to_100_mib',
      });
      const payload = routingResearchV2Payload({
        observedConnectionCount: index === 0 ? 3 : 2,
        identifiedAppConnectionCount: index === 0 ? 3 : 2,
        entries,
        bundleComponents,
      });
      expect((await api(
        'routing-research/snapshots',
        await routingResearchJson(
          payload, account.accessToken, account.user.id,
        ),
      )).status).toBe(201);
    }

    expect((await api('admin/routing-research/summary?days=30')).status).toBe(401);
    const response = await admin(
      'routing-research/summary?days=30',
      undefined,
      'GET',
    );
    expect(response.status).toBe(200);
    const summary = await response.json() as any;
    expect(summary).toMatchObject({
      days: 30,
      cohortMinimum: 3,
      participantCount: 3,
      deviceCount: 3,
      snapshotCount: 3,
      byApp: [{
        app: 'wechat', participantCount: 3, deviceCount: 3,
        snapshotCount: 3, connectionCount: 6,
        directConnectionCount: 3, proxiedConnectionCount: 3,
        blockedConnectionCount: 0,
        trafficVolumes: { '10_to_100_mib': 3 },
      }],
      byBundleComponent: [{
        app: 'wechat', bundleComponent: 'main_executable',
        participantCount: 3, deviceCount: 3, snapshotCount: 3,
        connectionCount: 3, directConnectionCount: 3,
        proxiedConnectionCount: 0, blockedConnectionCount: 0,
        trafficVolumes: { under_1_mib: 3 },
      }],
      byBuild: [{
        appVersion: '0.0.1', build: '40', participantCount: 3,
        deviceCount: 3, snapshotCount: 3,
      }],
    });
    const encoded = JSON.stringify(summary);
    for (const account of accounts) {
      expect(encoded).not.toContain(account.user.id);
      expect(encoded).not.toContain(account.device.id);
    }
    expect(encoded).not.toContain('snapshotId');
    expect(encoded).not.toContain('aggregate_json');
    expect((await admin(
      'routing-research/summary?days=91', undefined, 'GET',
    )).status).toBe(400);
    expect((await admin(
      'routing-research/summary?days=30&deviceId=secret', undefined, 'GET',
    )).status).toBe(400);
  });

  it('deletes routing research at retention and with its account', async () => {
    const account = await createAccount('routing-research-retention');
    const payload = routingResearchPayload();
    expect((await api(
      'routing-research/snapshots',
      await routingResearchJson(
        payload, account.accessToken, account.user.id,
      ),
    )).status).toBe(201);
    const row = await env.DB.prepare(
      'SELECT * FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).first<any>();
    await env.DB.prepare(
      'DELETE FROM routing_research_snapshots WHERE snapshot_id = ?',
    ).bind(payload.snapshotId).run();
    const oldUntil = Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60;
    await env.DB.prepare(
      `INSERT INTO routing_research_snapshots(
         id, snapshot_id, user_id, device_id, received_at, observed_since,
         observed_until, app_version, build, os_version, architecture,
         aggregate_json
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), crypto.randomUUID(), account.user.id,
      account.device.id, oldUntil, oldUntil - 6 * 60 * 60, oldUntil,
      row.app_version, row.build, row.os_version, row.architecture,
      row.aggregate_json,
    ).run();
    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(0);

    const fresh = routingResearchPayload();
    expect((await api(
      'routing-research/snapshots',
      await routingResearchJson(
        fresh, account.accessToken, account.user.id,
      ),
    )).status).toBe(201);
    await env.DB.prepare('DELETE FROM users WHERE id = ?')
      .bind(account.user.id).run();
    expect(Number((await env.DB.prepare(
      'SELECT COUNT(*) total FROM routing_research_snapshots',
    ).first<any>()).total)).toBe(0);
  });
});
