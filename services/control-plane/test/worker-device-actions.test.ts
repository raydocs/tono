import {
  env,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  api,
  json,
  admin,
  operations,
  createAccount,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('stores the catalog revision a snapshot result reports and bounds it', async () => {
    const owner = await createAccount('snapshot-catalog-owner');
    const queued = await admin('device-actions', {
      deviceId: owner.device.id, action: 'diagnostic_snapshot', ttlSeconds: 300,
    });
    expect(queued.status).toBe(201);
    const command = (await queued.json() as any).action;
    const poll = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await poll.json() as any).actions[0].id).toBe(command.id);

    // Out of range is still refused, the same bounds the telemetry window uses.
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { connected: true, catalogRevision: -1 },
    }, owner.accessToken))).status).toBe(400);

    // Every signed-in client with a catalog installed puts this field in the
    // snapshot, and answering "which catalog is that Mac running" on demand is
    // what the action is for, so the result has to land rather than 400.
    const result = {
      outcome: 'succeeded',
      snapshot: { connected: true, catalogRevision: 41 },
    };
    expect((await api(`device-actions/${command.id}/result`, json(result, owner.accessToken))).status).toBe(200);
    const stored = await env.DB.prepare('SELECT result_json FROM device_actions WHERE id = ?')
      .bind(command.id).first<any>();
    expect(JSON.parse(stored.result_json)).toEqual(result);
  });

  it('isolates allowlisted device actions and safely replays bounded canonical results', async () => {
    const owner = await createAccount('action-owner');
    const other = await createAccount('action-other');
    expect((await admin('device-actions', {
      deviceId: owner.device.id, action: 'run_shell', code: 'id',
    })).status).toBe(400);
    expect((await admin('device-actions', {
      deviceId: owner.device.id, action: 'diagnostic_snapshot', parameters: {},
    })).status).toBe(400);
    expect((await admin('device-actions', {
      deviceId: owner.device.id, action: 'diagnostic_snapshot', code: 'id',
    })).status).toBe(400);
    expect((await admin('device-actions', null)).status).toBe(400);

    const queued = await admin('device-actions', {
      deviceId: owner.device.id, action: 'diagnostic_snapshot', ttlSeconds: 300,
    });
    expect(queued.status).toBe(201);
    const command = (await queued.json() as any).action;
    const otherPoll = await api('device-actions', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect((await otherPoll.json() as any).actions).toEqual([]);

    const first = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await first.json() as any).actions[0].status).toBe('delivered');
    const replay = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await replay.json() as any).actions[0].id).toBe(command.id);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { connected: true, shell: '/bin/sh' },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', message: 'x'.repeat(201),
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { lastErrorCategory: '/Users/customer/private' },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { lastCrashLabel: '/Users/customer/private' },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json(null, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${command.id}/result`, json({
      outcome: 'succeeded', snapshot: { connected: true, reconnectAttempt: 2 },
    }, other.accessToken))).status).toBe(404);

    const result = {
      outcome: 'succeeded',
      snapshot: {
        connected: true, reconnectAttempt: 2, lastErrorCategory: 'data_plane',
        lastCrashLabel: 'SIGSEGV',
      },
    };
    expect((await api(`device-actions/${command.id}/result`, json(result, owner.accessToken))).status).toBe(200);
    expect((await api(`device-actions/${command.id}/result`, json(result, owner.accessToken))).status).toBe(200);
    expect((await api(`device-actions/${command.id}/result`, json({ outcome: 'failed' }, owner.accessToken))).status).toBe(409);
    const stored = await env.DB.prepare('SELECT status, result_json FROM device_actions WHERE id = ?')
      .bind(command.id).first<any>();
    expect(stored.status).toBe('succeeded');
    expect(JSON.parse(stored.result_json)).toEqual(result);

    const trafficQueued = await admin('device-actions', {
      deviceId: owner.device.id, action: 'claude_traffic_snapshot', ttlSeconds: 300,
    });
    expect(trafficQueued.status).toBe(201);
    const trafficCommand = (await trafficQueued.json() as any).action;
    const trafficPoll = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await trafficPoll.json() as any).actions[0].id).toBe(trafficCommand.id);
    const trafficSummary = {
      observedSince: Math.floor(Date.now() / 1000) - 60,
      droppedEndpointCount: 0,
      observedConnectionCount: 8,
      identifiedProcessConnectionCount: 3,
      proxiedConnectionCount: 7,
      directConnectionCount: 0,
      blockedConnectionCount: 1,
      directRouteAttemptCount: 0,
      managedDirectRouteCount: 2,
      unclassifiedRouteCount: 0,
      unsafeProtectionObservationCount: 0,
      webManagedDirectConnectionCount: 0,
      weChatConnectionCount: 2,
      weChatManagedDirectConnectionCount: 0,
      weChatProxiedConnectionCount: 2,
      weChatBlockedConnectionCount: 0,
      weChatEndpointUnknownProcessConnectionCount: 1,
      unknownManagedDirectConnectionCount: 0,
      otherManagedDirectConnectionCount: 0,
      protectedDirectConnectionCount: 0,
      connectionLimitReached: false,
      connected: true,
      killSwitchArmed: true,
      tunPresent: true,
      protectedDNSConfigured: true,
      exitIdentityConsistency: 'MATCHED',
      physicalBypassProbe: 'BLOCKED',
    };
    expect((await api(`device-actions/${trafficCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        entries: [{
          service: 'claude', client: 'web', host: 'www.reclaude.ai',
          network: 'TCP', port: 443, route: 'PROXIED', connections: 1,
          upBytes: 10, downBytes: 20,
        }],
      },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${trafficCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        entries: [{
          service: 'anthropic', client: 'code', host: 'api.anthropic.com',
          network: 'TCP', port: 443, route: 'PROXIED', connections: 2,
          upBytes: 100, downBytes: 200, processPath: '/Users/customer/bin/claude',
        }],
      },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${trafficCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        protectedDirectConnectionCount: 1,
        entries: [],
      },
    }, owner.accessToken))).status).toBe(400);
    expect((await api(`device-actions/${trafficCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        physicalBypassProbe: 'IGNORED',
        entries: [],
      },
    }, owner.accessToken))).status).toBe(400);
    const trafficResult = {
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        entries: [
          {
            service: 'anthropic', client: 'code', host: 'api.anthropic.com',
            network: 'TCP', port: 443, route: 'PROXIED', connections: 2,
            upBytes: 100, downBytes: 200,
          },
          {
            service: 'claude', client: 'unknown', host: 'claude.ai',
            network: 'UDP', port: 443, route: 'PROXIED', connections: 3,
            upBytes: 300, downBytes: 400,
          },
          {
            service: 'other', client: 'code', host: 'example.com',
            network: 'TCP', port: 443, route: 'PROXIED', connections: 1,
            upBytes: 50, downBytes: 60,
          },
        ],
      },
    };
    expect((await api(`device-actions/${trafficCommand.id}/result`, json(
      trafficResult, owner.accessToken,
    ))).status).toBe(200);
    const storedTraffic = await env.DB.prepare('SELECT status, result_json FROM device_actions WHERE id = ?')
      .bind(trafficCommand.id).first<any>();
    expect(storedTraffic.status).toBe('succeeded');
    expect(JSON.parse(storedTraffic.result_json)).toEqual(trafficResult);

    const residentialQueued = await admin('device-actions', {
      deviceId: owner.device.id, action: 'claude_traffic_snapshot', ttlSeconds: 300,
    });
    const residentialCommand = (await residentialQueued.json() as any).action;
    const residentialPoll = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await residentialPoll.json() as any).actions[0].id).toBe(residentialCommand.id);

    // New clients split residential from the other mutually exclusive route
    // buckets. Merely adding the field without taking it out of proxied would
    // overstate the observed total and must be rejected.
    expect((await api(`device-actions/${residentialCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        residentialConnectionCount: 2,
        entries: [],
      },
    }, owner.accessToken))).status).toBe(400);
    // Retained endpoints are a bounded subset, but they can never claim more of
    // one route than the top-level snapshot observed.
    expect((await api(`device-actions/${residentialCommand.id}/result`, json({
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        residentialConnectionCount: 1,
        proxiedConnectionCount: 6,
        entries: [{
          service: 'claude', client: 'app', host: 'api.claude.ai',
          network: 'TCP', port: 443, route: 'RESIDENTIAL', connections: 2,
          upBytes: 10, downBytes: 20,
        }],
      },
    }, owner.accessToken))).status).toBe(400);

    const residentialResult = {
      outcome: 'succeeded',
      trafficResearch: {
        ...trafficSummary,
        residentialConnectionCount: 2,
        proxiedConnectionCount: 5,
        entries: [{
          service: 'claude', client: 'app', host: 'api.claude.ai',
          network: 'TCP', port: 443, route: 'RESIDENTIAL', connections: 2,
          upBytes: 10, downBytes: 20,
        }],
      },
    };
    expect((await api(`device-actions/${residentialCommand.id}/result`, json(
      residentialResult, owner.accessToken,
    ))).status).toBe(200);
    const storedResidential = await env.DB.prepare(
      'SELECT result_json FROM device_actions WHERE id = ?',
    ).bind(residentialCommand.id).first<any>();
    expect(JSON.parse(storedResidential.result_json)).toEqual(residentialResult);

    const detail = await operations(`users/${owner.user.id}/detail`);
    expect(detail.status).toBe(200);
    const visibleProof = (await detail.json() as any).protectedRouteProof;
    expect(visibleProof).toMatchObject({
      status: 'succeeded',
      evidence: {
        verdict: 'confirmed',
        residentialReported: true,
        routes: { observed: 8, residential: 2, proxied: 5, direct: 0, blocked: 1 },
        exitIdentityConsistency: 'MATCHED',
        physicalBypassProbe: 'BLOCKED',
      },
    });
    const listedActions = await admin(
      `device-actions?deviceId=${owner.device.id}`,
      undefined,
      'GET',
    );
    const visibleAction = (await listedActions.json() as any).actions.find(
      (entry: any) => entry.id === residentialCommand.id,
    );
    expect(visibleAction.result).toEqual({
      outcome: 'succeeded',
      protectedRouteProof: visibleProof.evidence,
    });
    // Routine operator APIs expose aggregate proof only. Endpoint samples stay
    // in the bounded canonical action record and never reach the ops browser.
    for (const serialized of [JSON.stringify(visibleProof), JSON.stringify(visibleAction)]) {
      expect(serialized).not.toContain('api.claude.ai');
      expect(serialized).not.toContain('entries');
      expect(serialized).not.toContain('host');
      expect(serialized).not.toContain('process');
      expect(serialized).not.toContain('profile');
      expect(serialized.toLowerCase()).not.toContain('doh');
    }

    const expiring = await admin('device-actions', {
      deviceId: owner.device.id, action: 'refresh_catalog', ttlSeconds: 1,
    });
    const expiringID = (await expiring.json() as any).action.id;
    await env.DB.prepare('UPDATE device_actions SET expires_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000) - 1, expiringID).run();
    const afterExpiry = await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await afterExpiry.json() as any).actions).toEqual([]);
    expect((await env.DB.prepare('SELECT status FROM device_actions WHERE id = ?').bind(expiringID).first<any>()).status).toBe('expired');
    expect((await api(`device-actions/${expiringID}/result`, json({
      outcome: 'succeeded',
    }, owner.accessToken))).status).toBe(409);

    await env.DB.prepare("UPDATE devices SET status = 'revoked' WHERE id = ?").bind(owner.device.id).run();
    expect((await admin('device-actions', {
      deviceId: owner.device.id, action: 'refresh_catalog',
    })).status).toBe(404);
    expect((await api('device-actions', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })).status).toBe(401);
  });
});
