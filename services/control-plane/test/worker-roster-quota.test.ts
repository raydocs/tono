import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  HOME_TOKEN,
  EXIT_NODE_TOKENS,
  api,
  json,
  admin,
  MGMT_ID,
  API_NODE_ID,
  STABLE_ID,
  PUBLIC_KEY,
  sequence,
  resetMockInventory,
  createAccount,
  emailSignIn,
  confirm,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('serves an exit identity roster that excludes accounts an exit must drop', async () => {
    await env.DB.prepare("UPDATE exit_nodes SET name = 'Metered' WHERE id = 'exit-default'").run();
    const yaml = `proxies:
  - name: "Metered"
    type: vless
    server: 8.8.4.4
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    // A roster entry only exists once an account has been issued an identity,
    // which happens on its first catalog fetch.
    const active = await createAccount('roster-active');
    const capped = await createAccount('roster-capped');
    for (const account of [active, capped]) {
      expect((await api('exit-catalog', {
        headers: { authorization: `Bearer ${account.accessToken}` },
      })).status).toBe(200);
    }

    expect((await api('home/exit-identities')).status).toBe(401);

    const listed = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect(listed.status).toBe(200);
    const roster = await listed.json() as any;
    expect(typeof roster.observedAt).toBe('number');
    const identities = roster.identities as Array<{ userId: string; clientUUID: string }>;
    expect(identities.map((entry) => entry.userId).sort())
      .toEqual([active.user.id, capped.user.id].sort());
    // Two accounts, two identities: a roster that repeated one would put both on
    // the same counter and make usage unattributable again.
    expect(new Set(identities.map((entry) => entry.clientUUID)).size).toBe(2);

    // Passing the quota removes the account from the roster, because removal is
    // what stops traffic — an enforcement that only stops counting stops nothing.
    await env.DB.prepare(
      'UPDATE users SET quota_bytes = 100, usage_bytes = 100 WHERE id = ?',
    ).bind(capped.user.id).run();
    const afterQuota = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect((await afterQuota.json() as any).identities.map((e: any) => e.userId))
      .toEqual([active.user.id]);

    // So does being disabled.
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .bind(active.user.id).run();
    const afterSuspend = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect((await afterSuspend.json() as any).identities).toEqual([]);
  });

  it('names each exit identity with this node source watermark', async () => {
    await env.DB.prepare("UPDATE exit_nodes SET name = 'Metered' WHERE id = 'exit-default'").run();
    const yaml = `proxies:
  - name: "Metered"
    type: vless
    server: 8.8.4.4
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    const billed = await createAccount('roster-watermark');
    const quiet = await createAccount('roster-watermark-quiet');
    for (const account of [billed, quiet]) {
      expect((await api('exit-catalog', {
        headers: { authorization: `Bearer ${account.accessToken}` },
      })).status).toBe(200);
    }
    const observedAt = Math.floor(Date.now() / 1000);
    expect((await api('home/usage', json({
      reports: [{
        reportId: `roster-watermark-${observedAt}`,
        userId: billed.user.id,
        sourceId: 'exit-default',
        protocolVersion: 2,
        totalBytes: 1050,
        observedAt,
      }],
    }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);

    const listed = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-default']}` },
    });
    expect(listed.status).toBe(200);
    const identities = (await listed.json() as { identities: Array<{ userId: string; sourceUsageBytes: number }> }).identities;
    expect(identities.find((entry) => entry.userId === billed.user.id)?.sourceUsageBytes).toBe(1050);
    expect(identities.find((entry) => entry.userId === quiet.user.id)?.sourceUsageBytes).toBe(0);
  });

  it('returns inactive-user recovery watermarks without authorizing them and scopes them to this exit', async () => {
    const billed = await createAccount('inactive-roster-watermark');
    const observedAt = Math.floor(Date.now() / 1000);
    expect((await api('home/usage', json({ reports: [{
      reportId: 'inactive-watermark-default', userId: billed.user.id, sourceId: 'exit-default',
      protocolVersion: 2, totalBytes: 1050, observedAt,
    }] }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);
    expect((await api('home/usage', json({ reports: [{
      reportId: 'inactive-watermark-other', userId: billed.user.id, sourceId: 'exit-a',
      protocolVersion: 2, totalBytes: 630, observedAt,
    }] }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(200);
    await env.DB.prepare('UPDATE users SET expires_at = ? WHERE id = ?')
      .bind(observedAt - 1, billed.user.id).run();

    const listed = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-default']}` },
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      identities: [], sourceUsageWatermarks: [{ userId: billed.user.id, sourceUsageBytes: 1050 }],
    });
    const other = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-a']}` },
    });
    expect(await other.json()).toMatchObject({
      identities: [], sourceUsageWatermarks: [{ userId: billed.user.id, sourceUsageBytes: 630 }],
    });
    expect((await api('home/usage', json({ reports: [{
      reportId: 'inactive-watermark-recovery', userId: billed.user.id, sourceId: 'exit-default',
      protocolVersion: 2, totalBytes: 1050, observedAt: observedAt + 1,
    }] }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);
    expect(await env.DB.prepare('SELECT usage_bytes FROM users WHERE id = ?').bind(billed.user.id)
      .first()).toEqual({ usage_bytes: 1680 });
  });

  it('revokes sessions and devices as soon as a usage report reaches quota', async () => {
    const account = await createAccount('quota');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    expect((await admin(`users/${account.user.id}`, { quotaBytes: 100 }, 'PATCH')).status).toBe(200);
    const usage = await api('home/usage', json({ reports: [{
      reportId: `report-${sequence}`,
      userId: account.user.id,
      sourceId: 'exit-default',
      totalBytes: 100,
      observedAt: Math.floor(Date.now() / 1000),
    }] }, EXIT_NODE_TOKENS['exit-default']));
    expect(usage.status).toBe(200);
    expect((await api('me', { headers: { authorization: `Bearer ${account.accessToken}` } })).status).toBe(401);
    const device = await env.DB.prepare('SELECT status FROM devices WHERE id=?').bind(account.device.id).first<any>();
    expect(device.status).toBe('revoked');
  });

  it('sets, updates, and clears expiresAt through the admin PATCH route', async () => {
    const account = await createAccount('expiry');
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86_400;

    const set = await admin(`users/${account.user.id}`, { expiresAt }, 'PATCH');
    expect(set.status).toBe(200);
    let row = await env.DB.prepare('SELECT expires_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(Number(row.expires_at)).toBe(expiresAt);

    const updated = await admin(`users/${account.user.id}`, { expiresAt: expiresAt + 3_600 }, 'PATCH');
    expect(updated.status).toBe(200);
    row = await env.DB.prepare('SELECT expires_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(Number(row.expires_at)).toBe(expiresAt + 3_600);

    const cleared = await admin(`users/${account.user.id}`, { expiresAt: null }, 'PATCH');
    expect(cleared.status).toBe(200);
    row = await env.DB.prepare('SELECT expires_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(row.expires_at).toBeNull();
  });

  // Provisional policy (2026-09-24): expiry revokes every device, session and
  // exit credential; renewing restores nothing by itself, and each device
  // signing in again does. The ops console copy promises exactly this.
  it('expiry revokes every device within a cron tick and only a fresh sign-in restores service after renewal', async () => {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = 'false';
    const account = await createAccount('expiry-renew');
    await env.DB.prepare('UPDATE users SET expires_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000) - 60, account.user.id).run();
    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);
    const credentials = () => env.DB.prepare('SELECT COUNT(*) AS count FROM device_exit_credentials WHERE device_id = ?')
      .bind(account.device.id).first<any>();
    expect((await env.DB.prepare('SELECT status FROM devices WHERE id = ?').bind(account.device.id).first<any>()).status)
      .toBe('revoked');
    expect((await credentials()).count).toBe(0);

    const renewed = await admin(`users/${account.user.id}`, {
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 86_400,
    }, 'PATCH');
    expect(renewed.status).toBe(200);
    expect((await api('auth/refresh', json({ refreshToken: account.refreshToken }))).status).toBe(401);

    const again = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expiry-renew-installation-one',
    });
    expect(again.status).toBe(200);
    const signedIn = await again.json() as any;
    expect(signedIn.device.id).toBe(account.device.id);
    expect((await api('me', { headers: { authorization: `Bearer ${signedIn.accessToken}` } })).status).toBe(200);
    expect((await credentials()).count).toBe(1);
  });

  it('rejects invalid expiresAt values with 400', async () => {
    const account = await createAccount('expiry-invalid');
    for (const expiresAt of [0, -100, 1.5, 'tomorrow', Number.MAX_SAFE_INTEGER + 1]) {
      const response = await admin(`users/${account.user.id}`, { expiresAt }, 'PATCH');
      expect(response.status).toBe(400);
      expect((await response.json() as any).error.code).toBe('VALIDATION_ERROR');
    }
    const row = await env.DB.prepare('SELECT expires_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(row.expires_at).toBeNull();
  });

  it('exposes only verified peer usage mappings to the authenticated home agent', async () => {
    const account = await createAccount('home-inventory');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);

    const unauthorized = await api('home/inventory');
    expect(unauthorized.status).toBe(401);

    const nodeResponse = await api('home/inventory', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-default']}` },
    });
    expect(nodeResponse.status).toBe(200);
    expect(await nodeResponse.json()).toMatchObject({
      nodeId: 'exit-default',
      observedAt: expect.any(Number),
    });

    // The shared token remains read-only during dual rollout for old inventory
    // consumers, but deliberately has no node identity suitable for metering.
    const response = await api('home/inventory', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.nodeId).toBeUndefined();
    expect(payload.devices).toEqual([{
      stableNodeId: STABLE_ID,
      publicKey: PUBLIC_KEY.replace(/^nodekey:/, ''),
      userId: account.user.id,
      status: 'active',
      usageBytes: 0,
      sourceUsageBytes: 0,
    }]);
    expect(JSON.stringify(payload)).not.toContain(account.email);
    expect(JSON.stringify(payload)).not.toContain(account.device.installationId);
    expect(JSON.stringify(payload)).not.toContain(MGMT_ID);
    expect(JSON.stringify(payload)).not.toContain(API_NODE_ID);
  });

  it('returns a node-local usage baseline instead of seeding every exit from the account total', async () => {
    const account = await createAccount('home-inventory-source-total');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    const observedAt = Math.floor(Date.now() / 1000);
    expect((await api('home/usage', json({ reports: [{
      reportId: `source-seed-${sequence}`,
      userId: account.user.id,
      sourceId: 'exit-default',
      protocolVersion: 2,
      totalBytes: 125,
      observedAt,
    }] }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);

    const created = await admin('exit-nodes', { id: 'exit-second', name: 'Second Exit' });
    expect(created.status).toBe(201);
    const secondToken = String((await created.json() as any).token);

    const firstInventory = await api('home/inventory', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-default']}` },
    });
    const firstDevice = (await firstInventory.json() as any).devices.find(
      (device: any) => device.userId === account.user.id,
    );
    expect(firstDevice).toMatchObject({ usageBytes: 125, sourceUsageBytes: 125 });

    const secondInventory = await api('home/inventory', {
      headers: { authorization: `Bearer ${secondToken}` },
    });
    const secondDevice = (await secondInventory.json() as any).devices.find(
      (device: any) => device.userId === account.user.id,
    );
    expect(secondDevice).toMatchObject({ usageBytes: 125, sourceUsageBytes: 0 });
  });

  it('treats reportId as an immutable idempotency key', async () => {
    const account = await createAccount('usage-idempotency');
    const observedAt = Math.floor(Date.now() / 1000);
    const reportId = `immutable-report-${sequence}`;
    const original = {
      reportId,
      userId: account.user.id,
      sourceId: 'exit-default',
      totalBytes: 25,
      observedAt,
    };
    expect((await api('home/usage', json({ reports: [original] }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);
    await env.DB.prepare('UPDATE users SET updated_at = 1 WHERE id = ?')
      .bind(account.user.id).run();
    expect((await api('home/usage', json({ reports: [original] }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);
    expect(await env.DB.prepare('SELECT updated_at FROM users WHERE id = ?')
      .bind(account.user.id).first<any>()).toMatchObject({ updated_at: 1 });

    const conflict = await api('home/usage', json({ reports: [{
      ...original,
      totalBytes: 50,
    }] }, EXIT_NODE_TOKENS['exit-default']));
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as any).error.code).toBe('USAGE_REPORT_CONFLICT');

    const user = await env.DB.prepare('SELECT usage_bytes FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(user.usage_bytes).toBe(25);
    const stored = await env.DB.prepare('SELECT total_bytes FROM usage_reports WHERE report_id = ?')
      .bind(reportId).first<any>();
    expect(stored.total_bytes).toBe(25);
  });

  it('rejects non-object usage report entries as validation errors', async () => {
    const response = await api('home/usage', json({ reports: [null] }, EXIT_NODE_TOKENS['exit-default']));
    expect(response.status).toBe(400);
    expect((await response.json() as any).error.code).toBe('VALIDATION_ERROR');
  });
});
