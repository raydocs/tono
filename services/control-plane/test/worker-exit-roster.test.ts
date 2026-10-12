import {
  env,
} from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../src/crypto';
import { type Env } from '../src/index';
import { revokeExitToken } from '../src/ops/retire-dependencies';
import {
  ADMIN_TOKEN,
  HOME_TOKEN,
  EXIT_NODE_TOKENS,
  api,
  json,
  admin,
  ACCESS_ADMIN_EMAIL,
  accessAssertion,
  createAccount,
  acknowledgeServedExits,
  emailSignIn,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('serves a stable node roster without minting new legacy user credentials', async () => {
    const unconfigured = await api('ops-ingest/node-clients', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unconfigured.status).toBe(503);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';

    // A user with no registered device must not make this compatibility route
    // mint another legacy identity during the device-credential cutover.
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_roster', 'roster@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    await (env as unknown as Env).DB.batch([
      (env as unknown as Env).DB.prepare(
        `INSERT INTO devices(
           id, user_id, installation_id, name, status, created_at, updated_at
         ) VALUES('dev_roster', 'usr_roster', 'install_roster', 'Roster device', 'active', ?, ?)`,
      ).bind(seeded, seeded),
      (env as unknown as Env).DB.prepare(
        `INSERT INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
         VALUES('dev_roster', 'usr_roster', '11111111-1111-4111-8111-111111111111', ?)`,
      ).bind(seeded),
    ]);

    const wrongToken = await api('ops-ingest/node-clients', {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(wrongToken.status).toBe(401);

    const response = await api('ops-ingest/node-clients', {
      headers: { authorization: 'Bearer collector-test-token-with-at-least-32-chars' },
    });
    expect(response.status).toBe(200);
    const roster = await response.json() as any;
    // `observedAt` is what lets a reconciler tell a stale response from a real
    // empty roster; applying an empty list as current would strip every managed
    // client from every node.
    expect(roster.observedAt).toBeGreaterThan(0);
    expect(Array.isArray(roster.clients)).toBe(true);
    expect(roster.clients.some((c: { userId: string }) => c.userId === 'usr_roster')).toBe(true);
    expect(await env.DB.prepare(
      'SELECT client_uuid FROM exit_credentials WHERE user_id = ?',
    ).bind('usr_roster').first()).toBeNull();
    // Reconciliation is deterministic: a second read cannot change the roster.
    const again = await api('ops-ingest/node-clients', {
      headers: { authorization: 'Bearer collector-test-token-with-at-least-32-chars' },
    });
    expect(await again.json()).toMatchObject({ clients: roster.clients });
    for (const client of roster.clients) {
      const generation = Array.from(new Uint8Array(await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(client.clientUUID),
      ))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(client.email).toBe(
        client.deviceId
          ? `u:${client.userId}:${client.deviceId}:${generation}`
          : `u:${client.userId}`,
      );
      expect(client.email).not.toContain(client.clientUUID);
      expect(client.clientUUID).toMatch(/^[0-9a-f-]{36}$/);
    }
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('keeps shared legacy retirement disabled until the device credential rollout is ready', async () => {
    const homeRoster = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect(homeRoster.status).toBe(200);
    expect((await homeRoster.json() as any).retireSharedLegacy).toBe(false);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    try {
      const collectorRoster = await api('ops-ingest/node-clients', {
        headers: { authorization: 'Bearer collector-test-token-with-at-least-32-chars' },
      });
      expect(collectorRoster.status).toBe(200);
      expect((await collectorRoster.json() as any).retireSharedLegacy).toBe(false);
    } finally {
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
    }
  });

  it('keeps catalogs on an acknowledged legacy user credential while the device credential propagates', async () => {
    await env.DB.prepare('DELETE FROM exit_nodes').run();
    const account = await createAccount('dual-rollout-fallback');
    const yaml = `proxies:\n  - name: Tono-Exit\n    type: vless\n    server: exit.example.com\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    // The served exit acknowledged a roster after the shared credential was
    // created but before this device's credential existed.
    const deviceCreated = Number((await env.DB.prepare(
      'SELECT created_at FROM device_exit_credentials WHERE device_id = ?',
    ).bind(account.device.id).first<any>()).created_at);
    await env.DB.prepare(
      'INSERT INTO exit_credentials(user_id, client_uuid, created_at) VALUES(?, ?, ?)',
    ).bind(account.user.id, crypto.randomUUID(), deviceCreated - 100).run();
    await env.DB.prepare(
      `INSERT INTO exit_nodes(id, name, token_hash, status, last_roster_at, created_at, updated_at)
       VALUES('exit-tono', 'Tono-Exit', ?, 'active', ?, ?, ?)`,
    ).bind(await sha256('exit-tono-token-with-at-least-32-characters'), deviceCreated - 50, deviceCreated, deviceCreated).run();

    const catalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(catalog.status).toBe(200);
    const servedUUID = /uuid: ([0-9a-f-]{36})/.exec((await catalog.json() as any).yaml)?.[1];
    const legacy = await env.DB.prepare(
      'SELECT client_uuid FROM exit_credentials WHERE user_id = ?',
    ).bind(account.user.id).first<any>();
    const device = await env.DB.prepare(
      'SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?',
    ).bind(account.device.id).first<any>();
    expect(servedUUID).toBe(legacy.client_uuid);
    expect(device.client_uuid).not.toBe(legacy.client_uuid);

    const roster = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    const identities = (await roster.json() as any).identities
      .filter((entry: any) => entry.userId === account.user.id)
      .map((entry: any) => entry.clientUUID);
    expect(identities).toEqual(expect.arrayContaining([legacy.client_uuid, device.client_uuid]));
  });

  it('never serves a new dual account an exit identity no served exit has acknowledged', async () => {
    await env.DB.prepare('DELETE FROM exit_nodes').run();
    const account = await createAccount('dual-unacked-shared');
    const yaml = `proxies:\n  - name: Tono-Exit\n    type: vless\n    server: exit.example.com\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    const node = await admin('exit-nodes', { id: 'exit-unacked', name: 'Tono-Exit' });
    const nodeToken = String((await node.json() as any).token);

    const propagating = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(propagating.status).toBe(503);
    expect((await propagating.json() as any).error.code).toBe('EXIT_IDENTITY_PROPAGATING');
    expect(await env.DB.prepare(
      'SELECT client_uuid FROM exit_credentials WHERE user_id = ?',
    ).bind(account.user.id).first()).toBeNull();

    const device = await env.DB.prepare(
      'SELECT client_uuid, created_at FROM device_exit_credentials WHERE device_id = ?',
    ).bind(account.device.id).first<any>();
    expect((await api('home/roster-ack', json({
      observedAt: Number(device.created_at) + 1,
    }, nodeToken))).status).toBe(200);
    const ready = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(ready.status).toBe(200);
    expect(String((await ready.json() as any).yaml)).toContain(device.client_uuid);
  });

  it('removes the shared legacy credential from the exit roster once any device of the account is revoked', async () => {
    await env.DB.prepare('DELETE FROM exit_nodes').run();
    const account = await createAccount('dual-rollout-revoke');
    const second = await emailSignIn({
      email: account.email,
      deviceName: 'Second Mac',
      installationId: 'dual-rollout-revoke-installation-two',
    });
    expect(second.status).toBe(200);
    const survivor = await second.json() as any;
    const yaml = `proxies:\n  - name: Tono-Exit\n    type: vless\n    server: exit.example.com\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    // The shared credential a revoked device may hold.
    const leakedUUID = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO exit_credentials(user_id, client_uuid, created_at) VALUES(?, ?, 1)',
    ).bind(account.user.id, leakedUUID).run();

    const revoked = await api(`devices/${account.device.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${survivor.accessToken}` },
    });
    expect(revoked.status).toBeLessThan(300);

    const roster = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    const identities = (await roster.json() as any).identities.map((entry: any) => entry.clientUUID);
    expect(identities).not.toContain(leakedUUID);
    // With no acknowledging exit the retired account waits; it never falls back.
    const survivorCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${survivor.accessToken}` },
    });
    expect(survivorCatalog.status).toBe(503);
    expect((await survivorCatalog.json() as any).error.code).toBe('EXIT_IDENTITY_PROPAGATING');

    const survivorCredential = await env.DB.prepare(
      'SELECT client_uuid, created_at FROM device_exit_credentials WHERE device_id = ?',
    ).bind(survivor.device.id).first<any>();
    const node = await admin('exit-nodes', { id: 'exit-tono', name: 'Tono-Exit' });
    const nodeToken = String((await node.json() as any).token);
    expect((await api('home/roster-ack', json({
      observedAt: Number(survivorCredential.created_at) + 1,
    }, nodeToken))).status).toBe(200);
    const acknowledged = await api('exit-catalog', {
      headers: { authorization: `Bearer ${survivor.accessToken}` },
    });
    expect(acknowledged.status).toBe(200);
    const acknowledgedYaml = String((await acknowledged.json() as any).yaml);
    expect(acknowledgedYaml).toContain(survivorCredential.client_uuid);
    expect(acknowledgedYaml).not.toContain(leakedUUID);

    const onboarded = await api('ops/users/onboard', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
      },
      body: JSON.stringify({ email: account.email }),
    });
    expect(onboarded.status).toBe(202);
    expect((await onboarded.json() as any).exitIdentityIssued).toBe(true);
  });

  it('holds a retired account only on exit nodes its catalog serves', async () => {
    const account = await createAccount('unpublished-exit');
    await env.DB.prepare(
      'INSERT INTO exit_credentials(user_id, client_uuid, created_at, retired_at) VALUES(?, ?, 1, 1)',
    ).bind(account.user.id, crypto.randomUUID()).run();
    const served = '  - name: Tono-Exit\n    type: vless\n    server: exit.example.com\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n';
    const published = await admin('exit-catalog', { yaml: `proxies:\n${served}`, expectedRevision: 0 }, 'PUT');
    expect(published.status).toBe(200);
    const timestamp = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO exit_nodes(id, name, token_hash, status, last_roster_at, created_at, updated_at)
       VALUES('exit-served', 'Tono-Exit', ?, 'active', ?, ?, ?)`,
    ).bind(await sha256('exit-served-token-with-at-least-32-characters'), timestamp + 3600, timestamp, timestamp).run();
    // Registered and active (last_roster_at 0) but not yet published.
    expect((await admin('exit-nodes', { id: 'exit-unpublished', name: 'Unpublished Exit' })).status).toBe(201);

    const catalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(catalog.status).toBe(200);
    const device = await env.DB.prepare(
      'SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?',
    ).bind(account.device.id).first<any>();
    expect((await catalog.json() as any).yaml).toContain(device.client_uuid);

    const unpublished = served.replace('Tono-Exit', 'Unpublished Exit').replace('exit.example.com', 'late.example.com');
    expect((await admin('exit-catalog', {
      yaml: `proxies:\n${served}${unpublished}`,
      expectedRevision: (await published.json() as any).revision,
    }, 'PUT')).status).toBe(200);
    const held = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(held.status).toBe(503);
    expect((await held.json() as any).error.code).toBe('EXIT_IDENTITY_PROPAGATING');
  });

  it('serves the device identity to a bound catalog-home user once the served exit nodes ack', async () => {
    const account = await createAccount('catalog-home-ready');
    const block = (name: string, server: string) => `  - name: ${name}\n    type: vless\n    server: ${server}\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n`;
    expect((await admin('exit-catalog', {
      yaml: `proxies:\n${block('Tono-Exit', 'exit.example.com')}${block('Home Residential A', 'home.example.com')}`,
      expectedRevision: 0,
    }, 'PUT')).status).toBe(200);
    // exit-default is seeded active with an acknowledgement an hour ahead.
    await env.DB.prepare("UPDATE exit_nodes SET name = 'Tono-Exit' WHERE id = 'exit-default'").run();
    const home = await admin('home-exits', { proxyName: 'Home Residential A', displayName: 'Home A' });
    expect((await admin(
      `users/${account.user.id}/home-binding`,
      { homeExitId: ((await home.json()) as any).homeExit.id },
      'PUT',
    )).status).toBe(201);

    const catalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(catalog.status).toBe(200);
    const yaml = String((await catalog.json() as any).yaml);
    const device = await env.DB.prepare(
      'SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?',
    ).bind(account.device.id).first<any>();
    expect(yaml).toContain('Home Residential A');
    expect(yaml).toContain(device.client_uuid);
  });

  it('keeps an unacked exit node in readiness when a bound catalog home shares its name', async () => {
    const account = await createAccount('home-exit-collision');
    await env.DB.prepare(
      'INSERT INTO exit_credentials(user_id, client_uuid, created_at, retired_at) VALUES(?, ?, 1, 1)',
    ).bind(account.user.id, crypto.randomUUID()).run();
    const block = (name: string, server: string) => `  - name: ${name}\n    type: vless\n    server: ${server}\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n`;
    expect((await admin('exit-catalog', {
      yaml: `proxies:\n${block('Tono-Exit', 'exit.example.com')}${block('Collision', 'collision.example.com')}`,
      expectedRevision: 0,
    }, 'PUT')).status).toBe(200);
    // exit-default is seeded active with an acknowledgement an hour ahead.
    await env.DB.prepare("UPDATE exit_nodes SET name = 'Tono-Exit' WHERE id = 'exit-default'").run();
    // Registered and active, but it has never acknowledged a roster.
    expect((await admin('exit-nodes', { id: 'exit-collision', name: 'Collision' })).status).toBe(201);
    const home = await admin('home-exits', { proxyName: 'Collision', displayName: 'Collision home' });
    expect((await admin(
      `users/${account.user.id}/home-binding`,
      { homeExitId: ((await home.json()) as any).homeExit.id },
      'PUT',
    )).status).toBe(201);

    const catalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(catalog.status).toBe(503);
    expect((await catalog.json() as any).error.code).toBe('EXIT_IDENTITY_PROPAGATING');
    // Same when the exit row itself carries the hy2 suffix and only the base block is served.
    await env.DB.prepare("UPDATE exit_nodes SET name = 'Collision · hy2' WHERE id = 'exit-collision'").run();
    const suffixed = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(suffixed.status).toBe(503);
  });

  it('issues no exit identity when the served catalog filters down to no proxies', async () => {
    const account = await createAccount('empty-served');
    await env.DB.prepare(
      'INSERT INTO exit_credentials(user_id, client_uuid, created_at, retired_at) VALUES(?, ?, 1, 1)',
    ).bind(account.user.id, crypto.randomUUID()).run();
    const yaml = `proxies:
  - name: Tono-Exit · hy2
    type: hysteria2
    server: 8.8.8.8
    port: 443
    password: {{TONO_CLIENT_UUID}}
    sni: www.microsoft.com
    fingerprint: e3aa4a745aa90539ab1a493d940eeba7b4305b7516ab84167e46c98ad9fed3db
rules: []
# identity placeholder: {{TONO_CLIENT_UUID}}
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const catalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(catalog.status).toBe(200);
    expect(String((await catalog.json() as any).yaml)).toMatch(/^proxies: \[\]\n/);
  });

  it('provisions and rotates a node token that is bound to its usage source', async () => {
    const created = await admin('exit-nodes', { id: 'exit-new', name: 'New Exit' });
    expect(created.status).toBe(201);
    const firstToken = String((await created.json() as any).token);
    expect(firstToken.length).toBeGreaterThanOrEqual(32);
    const firstRoster = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(firstRoster.status).toBe(200);
    expect((await firstRoster.json() as any).nodeId).toBe('exit-new');

    const mismatch = await api('home/usage', json({ reports: [{
      reportId: 'wrong-source',
      userId: 'not-reached',
      sourceId: 'exit-default',
      totalBytes: 1,
      observedAt: Math.floor(Date.now() / 1000),
    }] }, firstToken));
    expect(mismatch.status).toBe(403);
    expect((await mismatch.json() as any).error.code).toBe('SOURCE_ID_MISMATCH');

    const omitted = await api('home/usage', json({ reports: [{
      reportId: 'missing-source',
      userId: 'not-reached',
      protocolVersion: 2,
      totalBytes: 1,
      observedAt: Math.floor(Date.now() / 1000),
    }] }, firstToken));
    expect(omitted.status).toBe(400);
    expect((await omitted.json() as any).error.code).toBe('SOURCE_ID_REQUIRED');

    const rotated = await admin('exit-nodes/exit-new/token', {});
    expect(rotated.status).toBe(200);
    const secondToken = String((await rotated.json() as any).token);
    expect(secondToken).not.toBe(firstToken);
    expect((await api('home/exit-identities', {
      headers: { authorization: `Bearer ${firstToken}` },
    })).status).toBe(401);
    expect((await api('home/exit-identities', {
      headers: { authorization: `Bearer ${secondToken}` },
    })).status).toBe(200);
  });

  it('acknowledges a reconciled roster only with a provisioned node token', async () => {
    const token = EXIT_NODE_TOKENS['exit-default'];
    const roster = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${token}` },
    });
    const observedAt = Number((await roster.json() as any).observedAt);
    await env.DB.prepare(
      "UPDATE exit_nodes SET last_roster_at = 0 WHERE id = 'exit-default'",
    ).run();
    const ack = await api('home/roster-ack', json({ observedAt }, token));
    expect(ack.status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT last_roster_at FROM exit_nodes WHERE id = 'exit-default'",
    ).first<any>()).toMatchObject({ last_roster_at: observedAt });
    expect((await api('home/roster-ack', json({ observedAt }, HOME_TOKEN))).status).toBe(401);
  });

  it('records metering readiness independently without renewing roster readiness', async () => {
    const token = EXIT_NODE_TOKENS['exit-default'];
    const inventory = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${token}` },
    });
    const observedAt = Number((await inventory.json() as any).observedAt);
    await env.DB.prepare(
      `UPDATE exit_nodes
       SET last_roster_at = 17, metering_protocol_version = 1, metering_last_seen_at = 0
       WHERE id = 'exit-default'`,
    ).run();

    const ack = await api('home/metering-ack', json({
      meteringProtocolVersion: 2,
      observedAt,
    }, token));
    expect(ack.status).toBe(200);
    expect(await env.DB.prepare(
      `SELECT last_roster_at, metering_protocol_version, metering_last_seen_at
       FROM exit_nodes WHERE id = 'exit-default'`,
    ).first()).toMatchObject({
      last_roster_at: 17,
      metering_protocol_version: 2,
      metering_last_seen_at: observedAt,
    });
    expect((await api('home/metering-ack', json({
      meteringProtocolVersion: 2, observedAt,
    }, HOME_TOKEN))).status).toBe(401);
  });

  it('does not renew metering readiness from a replayed or stale observation', async () => {
    const token = EXIT_NODE_TOKENS['exit-default'];
    const observedAt = Math.floor(Date.now() / 1000);
    const send = (value: number) => api('home/metering-ack', json({
      meteringProtocolVersion: 2, observedAt: value,
    }, token));
    expect((await send(observedAt)).status).toBe(200);
    await env.DB.prepare(
      "UPDATE exit_nodes SET updated_at = 11 WHERE id = 'exit-default'",
    ).run();
    expect((await send(observedAt)).status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT metering_last_seen_at, updated_at FROM exit_nodes WHERE id = 'exit-default'",
    ).first()).toMatchObject({ metering_last_seen_at: observedAt, updated_at: 11 });
    expect((await send(observedAt - 1)).status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT metering_last_seen_at, updated_at FROM exit_nodes WHERE id = 'exit-default'",
    ).first()).toMatchObject({ metering_last_seen_at: observedAt, updated_at: 11 });
    expect((await send(observedAt - 901)).status).toBe(400);
    expect((await send(observedAt + 600)).status).toBe(400);
    expect((await api('home/metering-ack', json({
      meteringProtocolVersion: 2, observedAt, extra: true,
    }, token))).status).toBe(400);
  });

  it('requires a fresh roster acknowledgement when a disabled exit node is re-enabled', async () => {
    const token = EXIT_NODE_TOKENS['exit-default'];
    const roster = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${token}` },
    });
    const observedAt = Number((await roster.json() as any).observedAt);
    expect((await api('home/roster-ack', json({ observedAt }, token))).status).toBe(200);
    const acknowledgedAt = Number((await env.DB.prepare(
      "SELECT last_roster_at FROM exit_nodes WHERE id = 'exit-default'",
    ).first<any>())?.last_roster_at);

    // An idempotent active PATCH must not throw away a valid acknowledgement.
    expect((await admin('exit-nodes/exit-default', { status: 'active' }, 'PATCH')).status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT last_roster_at FROM exit_nodes WHERE id = 'exit-default'",
    ).first<any>()).toMatchObject({ last_roster_at: acknowledgedAt });

    expect((await admin('exit-nodes/exit-default', { status: 'disabled' }, 'PATCH')).status).toBe(200);
    expect((await admin('exit-nodes/exit-default', { status: 'active' }, 'PATCH')).status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT last_roster_at FROM exit_nodes WHERE id = 'exit-default'",
    ).first<any>()).toMatchObject({ last_roster_at: 0 });
  });

  it('tells a disabled or retired exit node apart from an unknown token', async () => {
    const roster = (token: string) => api('home/exit-identities', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await admin('exit-nodes/exit-a', { status: 'disabled' }, 'PATCH')).status).toBe(200);
    expect(await revokeExitToken(env as unknown as Env, 'Test exit-b', 'ops@example.com', 1)).toBe(true);
    for (const token of [EXIT_NODE_TOKENS['exit-a'], EXIT_NODE_TOKENS['exit-b']]) {
      const response = await roster(token);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'EXIT_NODE_DISABLED' } });
    }
    expect((await roster('unknown-exit-token-with-at-least-32-characters')).status).toBe(401);
  });

  it('keeps telling a disabled exit node to withdraw after its token is rotated', async () => {
    // TF-opus-5: rotating a disabled node's token dropped the hash its agent
    // still holds, so the agent got 401, kept its last roster and never withdrew.
    const roster = (token: string) => api('home/exit-identities', {
      headers: { authorization: `Bearer ${token}` },
    });
    const deployed = EXIT_NODE_TOKENS['exit-a'];
    expect((await admin('exit-nodes/exit-a', { status: 'disabled' }, 'PATCH')).status).toBe(200);
    expect((await admin('exit-nodes/exit-a/token', {})).status).toBe(200);
    expect((await admin('exit-nodes/exit-a/token', {})).status).toBe(200);
    const withdrawn = await roster(deployed);
    expect(withdrawn.status).toBe(403);
    expect(await withdrawn.json()).toMatchObject({ error: { code: 'EXIT_NODE_DISABLED' } });
    // Re-enabled, the rotated-away token authenticates nothing.
    expect((await admin('exit-nodes/exit-a', { status: 'active' }, 'PATCH')).status).toBe(200);
    expect((await roster(deployed)).status).toBe(401);
  });

  it('enforces device-only rollout readiness at the database boundary', async () => {
    await env.DB.prepare(
      "UPDATE exit_nodes SET last_roster_at = 0 WHERE id = 'exit-default'",
    ).run();
    await expect(env.DB.prepare(
      "UPDATE exit_credential_rollout SET phase = 'device_only' WHERE singleton_id = 1",
    ).run()).rejects.toThrow('EXIT_CREDENTIAL_ROLLOUT_NOT_READY');
    expect(await env.DB.prepare(
      'SELECT phase FROM exit_credential_rollout WHERE singleton_id = 1',
    ).first<any>()).toMatchObject({ phase: 'dual' });
  });

  it('does not treat a same-second roster acknowledgement as covering a new credential', async () => {
    await env.DB.prepare("UPDATE exit_nodes SET name = 'Tono-Exit' WHERE id = 'exit-default'").run();
    const yaml = `proxies:\n  - name: Tono-Exit\n    type: vless\n    server: exit.example.com\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    expect((await admin('exit-credential-rollout', { phase: 'device_only' })).status).toBe(200);

    const account = await createAccount('same-second-roster');
    const credential = await env.DB.prepare(
      'SELECT created_at FROM device_exit_credentials WHERE device_id = ?',
    ).bind(account.device.id).first<any>();
    const createdAt = Number(credential.created_at);
    await env.DB.prepare(
      'UPDATE exit_nodes SET last_roster_at = ?',
    ).bind(createdAt).run();

    const ambiguous = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(ambiguous.status).toBe(503);
    expect((await ambiguous.json() as any).error.code).toBe('EXIT_IDENTITY_PROPAGATING');

    await env.DB.prepare(
      'UPDATE exit_nodes SET last_roster_at = ?',
    ).bind(createdAt + 1).run();
    expect((await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    })).status).toBe(200);
  });

  it.each([0, 999])('retires shared legacy only after credentials, catalog and node acknowledgements are ready (clock offset %i ms)', async (offset) => {
    // The ambiguous first acknowledgement must deliberately tie the credential
    // second. Real request scheduling can cross that boundary even in 20 ms,
    // in which case a 200 is correct and the old hard-coded 503 was flaky.
    const startedAt = Math.floor(Date.now() / 1_000) * 1_000 + offset;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    try {
      await env.DB.prepare("UPDATE exit_nodes SET name = 'Tono-Exit' WHERE id = 'exit-default'").run();
      const account = await createAccount('credential-rollout');
      const yaml = `proxies:\n  - name: Tono-Exit\n    type: vless\n    server: exit.example.com\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n`;
      expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

      const advanced = await admin('exit-credential-rollout', { phase: 'device_only' });
      expect(advanced.status).toBe(200);
      const roster = await api('home/exit-identities', {
        headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-default']}` },
      });
      expect((await roster.json() as any).retireSharedLegacy).toBe(true);
      expect((await api('home/exit-identities', {
        headers: { authorization: `Bearer ${HOME_TOKEN}` },
      })).status).toBe(401);

      // Publishing an unacknowledged node after cutover must hold new catalog
      // credentials until that node has actually reconciled the roster.
      const late = await admin('exit-nodes', { id: 'exit-late', name: 'Late Exit' });
      const lateToken = String((await late.json() as any).token);
      expect((await admin('exit-catalog', {
        yaml: `${yaml}  - name: Late Exit\n    type: vless\n    server: late.example.com\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n    servername: www.microsoft.com\n    reality-opts:\n      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n      short-id: abcd1234\n`,
        expectedRevision: 1,
      }, 'PUT')).status).toBe(200);
      const blocked = await api('exit-catalog', {
        headers: { authorization: `Bearer ${account.accessToken}` },
      });
      expect(blocked.status).toBe(503);
      expect((await blocked.json() as any).error.code).toBe('EXIT_IDENTITY_PROPAGATING');

      const lateRoster = await api('home/exit-identities', {
        headers: { authorization: `Bearer ${lateToken}` },
      });
      const observedAt = Number((await lateRoster.json() as any).observedAt);
      expect(observedAt).toBe(Math.floor(startedAt / 1_000));
      expect((await api('home/roster-ack', json({ observedAt }, lateToken))).status).toBe(200);
      expect((await api('exit-catalog', {
        headers: { authorization: `Bearer ${account.accessToken}` },
      })).status).toBe(503);

      // Seconds are the persisted wire precision. An acknowledgement tied with a
      // credential's creation cannot prove whether it was fetched before or after
      // that credential; the next poll gives the ordering a strict boundary.
      clock.mockReturnValue((observedAt + 1) * 1_000);
      const settledRoster = await api('home/exit-identities', {
        headers: { authorization: `Bearer ${lateToken}` },
      });
      const settledAt = Number((await settledRoster.json() as any).observedAt);
      expect(settledAt).toBe(observedAt + 1);
      expect((await api('home/roster-ack', json({ observedAt: settledAt }, lateToken))).status).toBe(200);
      expect((await api('exit-catalog', {
        headers: { authorization: `Bearer ${account.accessToken}` },
      })).status).toBe(200);

    } finally {
      clock.mockRestore();
    }
  });

  describe('Device-scoped exit credentials and instant revocation on exit roster', () => {
    it('mints distinct exit credentials per device and drops revoked device immediately from exit roster', async () => {
      const getCat = await admin('exit-catalog', undefined, 'GET');
      const curRev = getCat.status === 200 ? Number(((await getCat.json()) as any).revision) : 0;
      const yaml = `proxies:
  - name: Tono-Exit
    type: vless
    server: exit.example.com
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
      await admin('exit-catalog', { yaml, expectedRevision: curRev }, 'PUT');
      await acknowledgeServedExits('Tono-Exit');
      const email = `dual-${Date.now()}@example.com`;

      const res1 = await emailSignIn({
        email,
        deviceName: 'Phone',
        installationId: `inst-phone-${Date.now()}`,
      });
      expect(res1.status).toBe(200);
      const dev1 = await res1.json() as any;

      const res2 = await emailSignIn({
        email,
        deviceName: 'Laptop',
        installationId: `inst-laptop-${Date.now()}`,
      });
      expect(res2.status).toBe(200);
      const dev2 = await res2.json() as any;

      // Both devices fetch their exit catalog
      const cat1Res = await api('exit-catalog', {
        headers: { authorization: `Bearer ${dev1.accessToken}` },
      });
      expect(cat1Res.status).toBe(200);

      const cat2Res = await api('exit-catalog', {
        headers: { authorization: `Bearer ${dev2.accessToken}` },
      });
      expect(cat2Res.status).toBe(200);

      // Extract client UUID from device_exit_credentials
      const cred1 = await env.DB.prepare('SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?').bind(dev1.device.id).first<any>();
      const cred2 = await env.DB.prepare('SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?').bind(dev2.device.id).first<any>();

      expect(cred1).toBeTruthy();
      expect(cred2).toBeTruthy();
      expect(cred1.client_uuid).not.toBe(cred2.client_uuid);

      // The exit roster must contain BOTH device credentials
      const rosterBefore = await (await api('home/exit-identities', {
        headers: { authorization: `Bearer ${HOME_TOKEN}` },
      })).json() as any;

      const beforeUUIDs = rosterBefore.identities.map((e: any) => e.clientUUID);
      expect(beforeUUIDs).toContain(cred1.client_uuid);
      expect(beforeUUIDs).toContain(cred2.client_uuid);

      // Now revoke Device 1 (e.g. user deletes Phone from Laptop)
      const delRes = await api(`devices/${dev1.device.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${dev2.accessToken}` },
      });
      expect(delRes.status).toBe(204);

      // Device 1's credential must be deleted from device_exit_credentials
      const cred1After = await env.DB.prepare('SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?').bind(dev1.device.id).first<any>();
      expect(cred1After).toBeNull();

      // The exit roster must IMMEDIATELY drop Device 1, while keeping Device 2!
      const rosterAfter = await (await api('home/exit-identities', {
        headers: { authorization: `Bearer ${HOME_TOKEN}` },
      })).json() as any;

      const afterUUIDs = rosterAfter.identities.map((e: any) => e.clientUUID);
      expect(afterUUIDs).not.toContain(cred1.client_uuid);
      expect(afterUUIDs).toContain(cred2.client_uuid);
    });

    it('revoking the only device drops all credentials from roster without reviving legacy UUID', async () => {
      const getCat = await admin('exit-catalog', undefined, 'GET');
      const curRev = getCat.status === 200 ? Number(((await getCat.json()) as any).revision) : 0;
      const yaml = `proxies:
  - name: Tono-Exit
    type: vless
    server: exit.example.com
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
`;
      await admin('exit-catalog', { yaml, expectedRevision: curRev }, 'PUT');
      await acknowledgeServedExits('Tono-Exit');

      const email = `solo-${Date.now()}@example.com`;
      const devRes = await emailSignIn({
        email,
        deviceName: 'Solo Machine',
        installationId: `inst-solo-${Date.now()}`,
      });
      expect(devRes.status).toBe(200);
      const dev = await devRes.json() as any;

      // Seed a legacy exit_credentials row to simulate an account that had a legacy UUID
      const legacyUUID = '12345678-1234-4234-8234-1234567890ab';
      await env.DB.prepare('INSERT OR REPLACE INTO exit_credentials(user_id, client_uuid, created_at) VALUES(?, ?, ?)')
        .bind(dev.user.id, legacyUUID, 1700000000).run();

      // Fetch catalog to mint device_exit_credentials
      const catRes = await api('exit-catalog', {
        headers: { authorization: `Bearer ${dev.accessToken}` },
      });
      expect(catRes.status).toBe(200);

      const devCred = await env.DB.prepare('SELECT client_uuid FROM device_exit_credentials WHERE device_id = ?').bind(dev.device.id).first<any>();
      expect(devCred).toBeTruthy();

      // Dual rollout keeps the legacy UUID only while at least one device is
      // live, so already-issued catalogs keep working during node provisioning.
      const roster1 = await (await api('home/exit-identities', {
        headers: { authorization: `Bearer ${HOME_TOKEN}` },
      })).json() as any;
      const uids1 = roster1.identities.filter((e: any) => e.userId === dev.user.id);
      expect(uids1.map((e: any) => e.clientUUID)).toEqual(
        expect.arrayContaining([devCred.client_uuid, legacyUUID]),
      );

      // Revoke the only device
      const delRes = await api(`devices/${dev.device.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${dev.accessToken}` },
      });
      expect(delRes.status).toBe(204);

      // Now query the roster again: it must return ZERO entries for this user!
      // The legacy UUID must NOT revive!
      const roster2 = await (await api('home/exit-identities', {
        headers: { authorization: `Bearer ${HOME_TOKEN}` },
      })).json() as any;
      const uids2 = roster2.identities.filter((e: any) => e.userId === dev.user.id);
      expect(uids2).toEqual([]);

      // Also check ops-ingest node-clients
      (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
      const roster3 = await (await api('ops-ingest/node-clients', {
        headers: { authorization: 'Bearer collector-test-token-with-at-least-32-chars' },
      })).json() as any;
      const uids3 = roster3.clients.filter((e: any) => e.userId === dev.user.id);
      expect(uids3).toEqual([]);
    });
  });
});
