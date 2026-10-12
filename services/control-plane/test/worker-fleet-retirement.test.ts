import {
  env,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { retirementCatalogPlan, type Env } from '../src/index';
import {
  ADMIN_TOKEN,
  api,
  json,
  ACCESS_ADMIN_EMAIL,
  accessAssertion,
  operations,
  createAccount,
  telemetryWindowPayload,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('retires a catalog node as text and keeps remaining UUID placeholders', () => {
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      '      - Tokyo · Sakura',
      '      - Tokyo · Fuji',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const plan = retirementCatalogPlan(yaml, 'Tokyo · Sakura');
    expect(plan.safe).toBe(true);
    expect(plan.changes.catalogEntryRemoved).toBe(true);
    expect(plan.changes.proxyGroupReferencesRemoved).toEqual(['Tono-Exit']);
    expect(plan.yaml).toContain('Tokyo · Fuji');
    expect(plan.yaml).not.toContain('Tokyo · Sakura');
    expect(plan.yaml).toContain('{{TONO_CLIENT_UUID}}');
    expect(plan.yaml.match(/\{\{TONO_CLIENT_UUID\}\}/g)).toHaveLength(1);
    expect(plan.yaml).not.toContain('\n  uuid:\n');
  });

  it('refuses to dump a catalog whose retirement would empty Tono-Exit', () => {
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    proxies:',
      '      - Tokyo · Sakura',
    ].join('\n') + '\n';
    const plan = retirementCatalogPlan(yaml, 'Tokyo · Sakura');
    expect(plan.safe).toBe(false);
    expect(plan.yaml).toContain('Tokyo · Sakura');
    expect(plan.warnings.some((warning) => warning.includes('清空代理组'))).toBe(true);
  });

  it('allows retirement when a flow-style proxy-group list keeps another member', () => {
    // Reproduction 1 from the bug report: the group is written `proxies: [A]`
    // (flow style) and does not reference the retired node, so retirement must
    // not be blocked by the block-style-only emptiness latch.
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies: [Tokyo · Fuji]',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const plan = retirementCatalogPlan(yaml, 'Tokyo · Sakura');
    expect(plan.safe).toBe(true);
    expect(plan.changes.catalogEntryRemoved).toBe(true);
    // The group never referenced Sakura, so no proxy-group rewrite is recorded.
    expect(plan.changes.proxyGroupReferencesRemoved).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.yaml).not.toContain('Tokyo · Sakura');
    expect(plan.yaml).toContain('Tokyo · Fuji');
    // The flow-style group survives intact with its single remaining member.
    expect(plan.yaml).toContain('proxies: [Tokyo · Fuji]');
    expect(plan.yaml.match(/\{\{TONO_CLIENT_UUID\}\}/g)).toHaveLength(1);
  });

  it('strips a retired node from a flow-style proxy-group list and stays safe', () => {
    // Reproduction 2 from the bug report: the flow-style list references the
    // retired node, so the member-line remover must rewrite the inline array
    // (not leave a dangling ref) and the latch must see the surviving member.
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies: [Tokyo · Sakura, Tokyo · Fuji]',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const plan = retirementCatalogPlan(yaml, 'Tokyo · Sakura');
    expect(plan.safe).toBe(true);
    expect(plan.changes.proxyGroupReferencesRemoved).toEqual(['Tono-Exit']);
    expect(plan.yaml).not.toContain('Tokyo · Sakura');
    expect(plan.yaml).toContain('Tokyo · Fuji');
    // The flow array is rewritten in place rather than leaving a dangling ref.
    expect(plan.yaml).toContain('proxies: [Tokyo · Fuji]');
    expect(plan.yaml).not.toContain('proxies: [Tokyo · Sakura');
    expect(plan.yaml.match(/\{\{TONO_CLIENT_UUID\}\}/g)).toHaveLength(1);
  });

  it('refuses retirement that would empty a flow-style proxy-group list', () => {
    // The safety latch must still fire when removing the only flow-style
    // member would actually empty the group — fixing the latch must not turn
    // a genuinely unsafe retire into a safe one.
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies: [Tokyo · Sakura]',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const plan = retirementCatalogPlan(yaml, 'Tokyo · Sakura');
    expect(plan.safe).toBe(false);
    // safe === false returns the original catalog untouched.
    expect(plan.yaml).toBe(yaml);
    expect(plan.yaml).toContain('Tokyo · Sakura');
    expect(plan.warnings.some((w) => w.includes('退役会清空代理组 Tono-Exit'))).toBe(true);
  });

  it('retires a fleet node whose exit group uses a flow-style member list over HTTP', async () => {
    // End-to-end: the publish path accepts flow-style proxy-group catalogs, and
    // the retire path must not turn that into a permanent 422 RETIRE_UNSAFE.
    const accessHeaders = async () => ({
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    });
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    server: 203.0.113.60',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    server: 203.0.113.61',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies: [Tokyo · Sakura, Tokyo · Fuji]',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const putCatalog = await api('ops/exit-catalog', {
      method: 'PUT',
      headers: await accessHeaders(),
      body: JSON.stringify({ yaml, expectedRevision: 0 }),
    });
    expect(putCatalog.status).toBe(200);
    expect((await putCatalog.json() as any).revision).toBe(1);

    const sakura = encodeURIComponent('Tokyo · Sakura');
    const previewResponse = await operations(`fleet-nodes/${sakura}/retire-preview`);
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as any;
    expect(preview.canRetire).toBe(true);
    expect(preview.warnings).toEqual([]);
    expect(preview.changes.proxyGroupReferencesRemoved).toEqual(['Tono-Exit']);

    const retired = await accessHeaders().then((base) => api(`ops/fleet-nodes/${sakura}/retire`, {
      method: 'POST',
      headers: base,
      body: JSON.stringify({ expectedRevision: preview.expectedRevision, confirmation: 'Tokyo · Sakura', reason: '机房到期' }),
    }));
    expect(retired.status).toBe(200);
    const outcome = await retired.json() as any;
    expect(outcome.node.catalogListed).toBe(false);

    const served = await api('ops/exit-catalog', {
      method: 'GET',
      headers: await accessHeaders(),
    });
    const servedBody = await served.json() as any;
    expect(servedBody.yaml).not.toContain('Tokyo · Sakura');
    expect(servedBody.yaml).toContain('Tokyo · Fuji');
    // The flow-style member list is rewritten in place, not dropped to block style.
    expect(servedBody.yaml).toContain('proxies: [Tokyo · Fuji]');
  });

  it('previews and retires a fleet node over HTTP, leaving an audit row', async () => {
    const accessHeaders = async () => ({
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    });
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    server: 203.0.113.60',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    server: 203.0.113.61',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      '      - Tokyo · Sakura',
      '      - Tokyo · Fuji',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const putCatalog = await api('ops/exit-catalog', {
      method: 'PUT',
      headers: await accessHeaders(),
      body: JSON.stringify({ yaml, expectedRevision: 0 }),
    });
    expect(putCatalog.status).toBe(200);
    expect((await putCatalog.json() as any).revision).toBe(1);

    const sakura = encodeURIComponent('Tokyo · Sakura');
    expect((await operations('fleet-nodes/NoSuchNode/retire-preview')).status).toBe(404);

    const previewResponse = await operations(`fleet-nodes/${sakura}/retire-preview`);
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as any;
    expect(preview.node.name).toBe('Tokyo · Sakura');
    expect(preview.node.catalogListed).toBe(true);
    expect(preview.expectedRevision).toBe(1);
    expect(preview.canRetire).toBe(true);
    expect(preview.warnings).toEqual([]);
    expect(preview.affectedUsers).toEqual([]);
    expect(preview.changes).toEqual({
      catalogEntryRemoved: true,
      proxyGroupReferencesRemoved: ['Tono-Exit'],
      profileMarkedRetired: true,
    });
    // The rewritten catalog is server state, never a preview payload.
    expect(preview.nextYaml).toBeUndefined();

    const retire = (value: unknown, headers?: Record<string, string>) =>
      accessHeaders().then((base) => api(`ops/fleet-nodes/${sakura}/retire`, {
        method: 'POST',
        headers: { ...base, ...headers },
        body: JSON.stringify(value),
      }));

    const formShaped = await retire(
      { expectedRevision: 1, confirmation: 'Tokyo · Sakura', reason: '机房到期' },
      { 'content-type': 'text/plain' },
    );
    expect(formShaped.status).toBe(415);

    const unconfirmed = await retire({ expectedRevision: 1, confirmation: 'Tokyo', reason: '机房到期' });
    expect(unconfirmed.status).toBe(400);
    expect((await unconfirmed.json() as any).error.code).toBe('RETIRE_CONFIRMATION_REQUIRED');

    const stale = await retire({ expectedRevision: 0, confirmation: 'Tokyo · Sakura', reason: '机房到期' });
    expect(stale.status).toBe(409);
    expect((await stale.json() as any).error.code).toBe('CATALOG_CONFLICT');
    expect(await env.DB.prepare(
      "SELECT id FROM ops_audit WHERE action = 'node.retire'",
    ).first()).toBeNull();

    const retired = await retire({ expectedRevision: 1, confirmation: 'Tokyo · Sakura', reason: '机房到期' });
    expect(retired.status).toBe(200);
    const outcome = await retired.json() as any;
    expect(outcome.previousRevision).toBe(1);
    expect(outcome.revision).toBe(2);
    expect(outcome.node.catalogListed).toBe(false);
    expect(outcome.node.profile.status).toBe('retired');

    const audit = await env.DB.prepare(
      "SELECT * FROM ops_audit WHERE action = 'node.retire'",
    ).all<any>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0].actor_email).toBe(ACCESS_ADMIN_EMAIL);
    expect(audit.results[0].target_type).toBe('fleet_node');
    expect(audit.results[0].target_id).toBe('Tokyo · Sakura');
    expect(String(audit.results[0].summary)).toContain('机房到期');

    const served = await api('ops/exit-catalog', {
      method: 'GET',
      headers: await accessHeaders(),
    });
    const servedBody = await served.json() as any;
    expect(servedBody.revision).toBe(2);
    expect(servedBody.yaml).not.toContain('Tokyo · Sakura');
    expect(servedBody.yaml).toContain('Tokyo · Fuji');

    // The node is out of the catalog but not out of sight: its retired profile
    // keeps it on the fleet list, and a second retirement has nothing to do.
    const again = await retire({ expectedRevision: 2, confirmation: 'Tokyo · Sakura', reason: '再来一次' });
    expect(again.status).toBe(422);
    expect((await again.json() as any).error.code).toBe('RETIRE_UNSAFE');
  });

  it('counts a customer offline for days among those a retirement would affect', async () => {
    const yaml = [
      'proxies:',
      '  - name: Tokyo · Sakura',
      '    type: vless',
      '    server: 203.0.113.60',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
      '  - name: Tokyo · Fuji',
      '    type: vless',
      '    server: 203.0.113.61',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      '      - Tokyo · Sakura',
      '      - Tokyo · Fuji',
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const putCatalog = await api('ops/exit-catalog', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
      },
      body: JSON.stringify({ yaml, expectedRevision: 0 }),
    });
    expect(putCatalog.status).toBe(200);

    const away = await createAccount('retire-away');
    const moved = await createAccount('retire-moved');
    const heartbeat = (
      rowId: string,
      account: { user: { id: string }; device: { id: string } },
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
      account.device.id,
      at,
      (at - 1_200) * 1_000,
      at * 1_000,
      JSON.stringify(telemetryWindowPayload({ selectedServer }).window),
    );

    const nowSec = Math.floor(Date.now() / 1_000);
    await env.DB.batch([
      // Telemetry is retained for thirty days; the activity view ranks one.
      heartbeat('retire-away-window', away, nowSec - 5 * 86_400, 'Tokyo · Sakura'),
      // This customer had it selected once and has since moved off it.
      heartbeat('retire-moved-old', moved, nowSec - 6 * 86_400, 'Tokyo · Sakura'),
      heartbeat('retire-moved-new', moved, nowSec - 4 * 86_400, 'Tokyo · Fuji'),
    ]);

    const sakura = encodeURIComponent('Tokyo · Sakura');
    const preview = await (await operations(`fleet-nodes/${sakura}/retire-preview`)).json() as any;
    // Being asleep is not being unaffected: this exit is still their selection
    // and they are still the ones who lose it.
    expect(preview.affectedUsers).toHaveLength(1);
    expect(preview.affectedUsers[0]).toMatchObject({
      userId: away.user.id,
      selectedServer: 'Tokyo · Sakura',
      online: false,
    });

    const incidents = await (await operations(`incidents/node/${sakura}`)).json() as any;
    expect(incidents.affected.map((row: any) => row.userId)).toEqual([away.user.id]);

    // The activity endpoint is a liveness view and stays inside its day.
    const { activity } = await (await operations('activity')).json() as any;
    expect(activity.users.map((row: any) => row.userId)).toEqual([]);
  });

  it('keeps collector text bodies out of the fleet list but reachable per node', async () => {
    expect((await api('ops/fleet-nodes', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    try {
      const ingested = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer collector-test-token-with-at-least-32-chars',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          report: {
            nodes: [{
              name: 'Fleet Text Node',
              ok: true,
              block: { status: 'OK', label: '正常' },
              security_check: 'fleet security body',
              backtrace: 'fleet backtrace body',
            }],
          },
          agents: {
            data: [{ name: 'Fleet Text Node', cpu: 12, observed_at: Math.floor(Date.now() / 1000) }],
          },
        }),
      });
      expect(ingested.status).toBe(200);

      const response = await operations('fleet-nodes');
      expect(response.status).toBe(200);
      const fleet = await response.json() as any;
      expect(fleet.sources).toMatchObject({
        catalog: { state: 'ready' },
        quality: { state: 'ready' },
        agents: { state: 'ready' },
      });
      const node = fleet.nodes.find((row: any) => row.name === 'Fleet Text Node');
      expect(node).toMatchObject({
        catalogListed: false,
        qualityStatus: 'OK',
        qualityLabel: '正常',
        agentStatus: 'online',
      });
      expect(node.quality.securityCheck).toBeUndefined();
      expect(node.quality.backtrace).toBeUndefined();

      const text = await operations(`fleet-nodes/${encodeURIComponent('Fleet Text Node')}/quality-text`);
      expect(text.status).toBe(200);
      expect(await text.json()).toEqual({
        securityCheck: 'fleet security body',
        backtrace: 'fleet backtrace body',
      });
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('serves only the metrics fields a caller asks for and rejects unknown ones', async () => {
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    try {
      const ingested = await api('ops-ingest/snapshot', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer collector-test-token-with-at-least-32-chars',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agents: {
            data: [{
              name: 'Field Node',
              cpu: 33,
              mem_used: 512,
              mem_total: 1024,
              load_1: 0.5,
              observed_at: Math.floor(Date.now() / 1000) - 60,
            }],
          },
        }),
      });
      expect(ingested.status).toBe(200);

      const thin = await operations('metrics?range=24h&node=Field%20Node&fields=cpu,memUsed');
      expect(thin.status).toBe(200);
      const { metrics } = await thin.json() as any;
      const points = metrics.series['Field Node'] as any[];
      expect(points.length).toBeGreaterThanOrEqual(1);
      for (const point of points) {
        expect(Object.keys(point).sort()).toEqual(['cpu', 'memUsed', 't']);
      }
      expect(points[0].cpu).toBe(33);
      expect(points[0].memUsed).toBe(512);

      for (const bad of ['fields=cpu,bogus', 'fields=', 'fields=%20']) {
        const rejected = await operations(`metrics?range=24h&${bad}`);
        expect(rejected.status).toBe(400);
        expect((await rejected.json() as any).error.message).toBe('Unsupported metrics field');
      }
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('serves hourly usage deltas on the ops route and rejects unknown ranges', async () => {
    expect((await api('ops/usage-hours', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);

    const rejected = await operations('usage-hours?range=90days');
    expect(rejected.status).toBe(400);
    expect((await rejected.json() as any).error.message).toBe('Unsupported usage-hours range');

    await env.DB.prepare('DELETE FROM operations_user_usage_hours').run();
    const hour = Math.floor(Date.now() / 1000 / 3600) * 3600;
    for (const [at, bytes] of [[hour - 7200, 1000], [hour - 3600, 1600]] as const) {
      await env.DB.prepare(
        'INSERT INTO operations_user_usage_hours(user_id, hour_at, usage_bytes) VALUES(?, ?, ?)',
      ).bind('usage-hours-route-user', at, bytes).run();
    }

    const response = await operations('usage-hours');
    expect(response.status).toBe(200);
    const { usageHours } = await response.json() as any;
    expect(usageHours.resolutionSeconds).toBe(3600);
    expect(usageHours.to - usageHours.from).toBe(24 * 3600);
    expect(usageHours.users).toEqual([{
      userId: 'usage-hours-route-user',
      points: [
        // The first hour has no predecessor: unmeasured, never zero.
        { t: hour - 7200, bytes: null },
        { t: hour - 3600, bytes: 600 },
      ],
    }]);
    expect(usageHours.fleet).toEqual([
      { t: hour - 7200, bytes: null },
      { t: hour - 3600, bytes: 600 },
    ]);

    const week = await operations('usage-hours?range=7d');
    expect(week.status).toBe(200);
    const weekBody = await week.json() as any;
    expect(weekBody.usageHours.to - weekBody.usageHours.from).toBe(7 * 24 * 3600);
  });

  it('pages and filters the ops audit log', async () => {
    expect((await api('ops/audit', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);

    const seed = (rowId: string, at: number, actor: string, action: string, targetId: string) =>
      env.DB.prepare(
        `INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary)
         VALUES(?, ?, ?, ?, 'user', ?, ?)`,
      ).bind(rowId, at, actor, action, targetId, `${action} ${targetId}`).run();
    await seed('aud-1', 1000, 'a@example.com', 'user.onboard', 'usr_a');
    await seed('aud-2', 2000, 'b@example.com', 'user.update', 'usr_b');
    await seed('aud-3', 3000, 'a@example.com', 'user.update', 'usr_a');
    await seed('aud-4', 4000, 'a@example.com', 'user.close', 'usr_a');

    const plain = await operations('audit');
    expect(plain.status).toBe(200);
    const plainBody = await plain.json() as any;
    expect(plainBody.entries.map((entry: any) => entry.id)).toEqual(['aud-4', 'aud-3', 'aud-2', 'aud-1']);
    expect(plainBody.entries[0]).toMatchObject({
      at: 4000,
      actorEmail: 'a@example.com',
      action: 'user.close',
      targetType: 'user',
      targetId: 'usr_a',
    });
    expect(plainBody.hasMore).toBe(false);
    expect(plainBody.nextBefore).toBeNull();

    const firstPage = await operations('audit?limit=2');
    const firstBody = await firstPage.json() as any;
    expect(firstBody.entries.map((entry: any) => entry.id)).toEqual(['aud-4', 'aud-3']);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextBefore).toBe(3000);

    const secondPage = await operations(`audit?limit=2&before=${firstBody.nextBefore}`);
    const secondBody = await secondPage.json() as any;
    expect(secondBody.entries.map((entry: any) => entry.id)).toEqual(['aud-2', 'aud-1']);
    expect(secondBody.hasMore).toBe(false);

    const byTarget = await operations('audit?targetId=usr_b');
    expect(((await byTarget.json() as any).entries as any[]).map((entry) => entry.id)).toEqual(['aud-2']);

    const byActor = await operations(`audit?actorEmail=${encodeURIComponent('a@example.com')}`);
    expect(((await byActor.json() as any).entries as any[]).map((entry) => entry.id))
      .toEqual(['aud-4', 'aud-3', 'aud-1']);

    for (const bad of ['limit=0', 'limit=501', 'limit=ten', 'before=0', 'before=soon']) {
      expect((await operations(`audit?${bad}`)).status).toBe(400);
    }
  });

  it('pages the audit log past rows written in the same second', async () => {
    // A PATCH that both resets usage and changes a field writes two rows one
    // after the other, and the log's clock has no room between them.
    const seed = (rowId: string, at: number) =>
      env.DB.prepare(
        `INSERT INTO ops_audit(id, at, actor_email, action, target_type, target_id, summary)
         VALUES(?, ?, 'a@example.com', 'user.update', 'user', 'usr_tie', ?)`,
      ).bind(rowId, at, `update ${rowId}`).run();
    await seed('aud-tie-a', 5000);
    await seed('aud-tie-b', 5000);
    await seed('aud-tie-older', 4000);

    const walk = async () => {
      const ids: string[] = [];
      let cursor = '';
      for (let page = 0; page < 10; page += 1) {
        const body = await (await operations(`audit?limit=1${cursor}`)).json() as any;
        ids.push(...body.entries.map((entry: any) => entry.id));
        if (!body.hasMore) return ids;
        cursor = `&before=${body.nextBefore}&beforeId=${encodeURIComponent(body.nextBeforeId)}`;
      }
      throw new Error('audit paging did not terminate');
    };

    // One row per page, so the boundary falls inside the pair. Neither of them
    // may be skipped, and the newest-first order stays deterministic.
    expect(await walk()).toEqual(['aud-tie-b', 'aud-tie-a', 'aud-tie-older']);

    // The timestamp alone is still a valid cursor for a hand-written request.
    const older = await (await operations('audit?before=5000')).json() as any;
    expect(older.entries.map((entry: any) => entry.id)).toEqual(['aud-tie-older']);
    expect((await operations('audit?beforeId=aud-tie-a')).status).toBe(400);
  });

  it('lists the customers currently on a node for incident triage', async () => {
    expect((await api('ops/incidents/node/Some%20Node', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);

    const account = await createAccount('incident-node');
    const posted = await api('telemetry/windows', json(telemetryWindowPayload({
      selectedServer: 'Incident · Node',
    }), account.accessToken));
    expect(posted.status).toBe(201);

    const response = await operations(`incidents/node/${encodeURIComponent('Incident · Node')}`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.node).toBe('Incident · Node');
    expect(body.onlineWindowSeconds).toBe(40 * 60);
    expect(body.affected).toHaveLength(1);
    expect(body.affected[0]).toMatchObject({
      userId: account.user.id,
      deviceId: account.device.id,
      online: true,
      selectedServer: 'Incident · Node',
    });

    const quiet = await operations('incidents/node/Quiet%20Node');
    expect(((await quiet.json() as any).affected)).toEqual([]);

    expect((await operations(`incidents/node/${encodeURIComponent('x'.repeat(201))}`)).status).toBe(400);
  });
});
