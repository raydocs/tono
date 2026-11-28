import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import vectorsRaw from '../../../tooling/scripts/tests/fixtures/routing-digest-v2-vectors.json?raw';
import type { Env } from '../src/env';
import {
  assignHomeExitToNode,
  routingDigestV2Preimage,
  routingSha256V2,
  setHomeExitDeliveryMode,
} from '../src/node-home';
import {
  ACCESS_ADMIN_EMAIL,
  EXIT_NODE_TOKENS,
  HOME_TOKEN,
  accessAssertion,
  admin,
  api,
  createAccount,
  json,
  nextSequence,
  useWorkerHarness,
} from './worker-harness';

const BASE_CATALOG_YAML = `proxies:
  - name: "Los Angeles · Mesa"
    type: vless
    server: 179.255.154.17
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "San Jose · CloudSilk"
    type: vless
    server: 38.59.244.57
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
      short-id: 1234abcd
  - name: "Tokyo · Neon"
    type: vless
    server: 192.0.2.99
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
      short-id: deadbeef
`;

async function setupDeviceOnlyCatalog(): Promise<void> {
  const e = env as unknown as Env;
  const revResp = await admin('exit-catalog', undefined, 'GET');
  const rev = Number(((await revResp.json()) as { revision: number }).revision);
  expect((await admin('exit-catalog', { yaml: BASE_CATALOG_YAML, expectedRevision: rev }, 'PUT')).status).toBe(200);

  const past = Math.floor(Date.now() / 1000) - 600;
  // Rename test exits to match catalog base names so selectAcknowledgedExitIdentity keeps them.
  await e.DB.prepare(
    `UPDATE exit_nodes SET name = 'Los Angeles · Mesa', last_roster_at = ?, metering_protocol_version = 2, metering_last_seen_at = ? WHERE id = 'exit-a'`,
  ).bind(past + 100, past + 100).run();
  await e.DB.prepare(
    `UPDATE exit_nodes SET name = 'San Jose · CloudSilk', last_roster_at = ?, metering_protocol_version = 2, metering_last_seen_at = ? WHERE id = 'exit-b'`,
  ).bind(past + 100, past + 100).run();
  await e.DB.prepare(
    `UPDATE exit_nodes SET name = 'Tokyo · Neon', last_roster_at = ?, metering_protocol_version = 2, metering_last_seen_at = ? WHERE id = 'exit-c'`,
  ).bind(past + 100, past + 100).run();

  // Keep only exit-a, exit-b, exit-c active so rollout readiness check passes cleanly.
  await e.DB.prepare(
    `UPDATE exit_nodes SET status = 'disabled' WHERE id NOT IN ('exit-a', 'exit-b', 'exit-c')`,
  ).run();
}

async function advanceRolloutToDeviceOnly(): Promise<void> {
  const e = env as unknown as Env;
  const t = Math.floor(Date.now() / 1000);
  await e.DB.prepare(
    `UPDATE exit_nodes SET last_roster_at = ? WHERE status = 'active'`,
  ).bind(t + 120).run();
  const res = await admin('exit-credential-rollout', { phase: 'device_only' });
  expect(res.status).toBe(200);
}

describe('node-home PR 1 control plane & routing digest v2', () => {
  useWorkerHarness();

  it('matches every shared routingSha256 v2 fixture vector and rejects forbidden delimiters', async () => {
    const doc = JSON.parse(vectorsRaw) as {
      version: number;
      vectors: Array<{ name: string; routing: any; preimage: string; sha256: string }>;
    };
    expect(doc.version).toBe(2);
    expect(doc.vectors.length).toBeGreaterThanOrEqual(7);
    for (const vec of doc.vectors) {
      const pre = routingDigestV2Preimage(vec.routing ?? undefined);
      expect(pre).toBe(vec.preimage);
      const digest = await routingSha256V2(vec.routing ?? undefined);
      expect(digest).toBe(vec.sha256);
    }

    await expect(routingSha256V2({
      homeTunnel: { homeExitId: 'h1', clientUuid: 'uuid', exitBaseNames: ['bad,name'] },
    })).rejects.toThrow();
    await expect(routingSha256V2({ defaultProxy: 'bad\nproxy' })).rejects.toThrow();
    await expect(routingSha256V2({ homeProxy: 'bad\u001fproxy' })).rejects.toThrow();
  });

  it('enforces explicit 503 CATALOG_UNAVAILABLE with Retry-After on unready node_only lines and blocks downgrade', async () => {
    await setupDeviceOnlyCatalog();
    const account = await createAccount('node-home-503');
    await advanceRolloutToDeviceOnly();
    const e = env as unknown as Env;

    const home = await admin('home-exits', {
      proxyName: 'Home Node-Only 503',
      displayName: '家宽 NodeOnly',
      kind: 'socks5',
      socks5Host: '198.51.100.77',
      socks5Port: 1080,
      socks5Username: 'resi_u',
      socks5Password: 'resi_p',
    });
    expect(home.status).toBe(201);
    const homeId = String(((await home.json()) as { homeExit: { id: string } }).homeExit.id);
    await setHomeExitDeliveryMode(e, homeId, 'node_only');
    await assignHomeExitToNode(e, homeId, 'exit-a');
    expect((await admin(`users/${account.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status).toBe(201);

    // 1. Legacy client without `X-Tono-Accept: node-home` MUST fail closed with 503 + Retry-After,
    // never receiving plaintext SOCKS5 credentials or stamping ever_served_plaintext_at.
    const legacyResp = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(legacyResp.status).toBe(503);
    expect(Number(legacyResp.headers.get('Retry-After'))).toBe(60);
    const legacyText = await legacyResp.text();
    expect(legacyText).toContain('CATALOG_UNAVAILABLE');
    expect(legacyText).not.toContain('resi_p');
    expect(legacyText).not.toContain('resi_u');

    // 2. node-home capable client MUST also receive 503 + Retry-After when zero exit nodes
    // have acknowledged the newly minted credential generation yet.
    const unreadyResp = await api('exit-catalog', {
      headers: {
        authorization: `Bearer ${account.accessToken}`,
        'x-tono-accept': 'hy2, node-home',
      },
    });
    expect(unreadyResp.status).toBe(503);
    expect(Number(unreadyResp.headers.get('Retry-After'))).toBe(15);
    expect(await unreadyResp.text()).not.toContain('resi_p');

    const homeRow = await e.DB.prepare(
      'SELECT ever_served_plaintext_at FROM home_exits WHERE id = ?',
    ).bind(homeId).first<{ ever_served_plaintext_at: number | null }>();
    expect(homeRow?.ever_served_plaintext_at).toBeNull();
  });

  it('stamps ever_served_plaintext_at only when serving legacy homeSocks5 and scopes homeIdentities/homeOutbounds strictly', async () => {
    await setupDeviceOnlyCatalog();
    const account = await createAccount('node-home-scope');
    const e = env as unknown as Env;

    const home = await admin('home-exits', {
      proxyName: 'Home Legacy To Node',
      displayName: '家宽 Scope',
      kind: 'socks5',
      socks5Host: '198.51.100.88',
      socks5Port: 21080,
      socks5Username: 'scope_user',
      socks5Password: 'scope_secret',
    });
    expect(home.status).toBe(201);
    const homeId = String(((await home.json()) as { homeExit: { id: string } }).homeExit.id);
    expect((await admin(`users/${account.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status).toBe(201);

    // While dual phase & legacy_socks5, shared HOME_AGENT_TOKEN never sees homeIdentities/homeOutbounds.
    const sharedRosterResp = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${HOME_TOKEN}` },
    });
    expect(sharedRosterResp.status).toBe(200);
    const sharedRoster = await sharedRosterResp.json() as Record<string, unknown>;
    expect(sharedRoster).not.toHaveProperty('homeIdentities');
    expect(sharedRoster).not.toHaveProperty('homeOutbounds');
    expect(JSON.stringify(sharedRoster)).not.toContain('scope_secret');

    // Legacy client fetch gets v1 routingSha256 (no routingDigestVersion) and stamps ever_served_plaintext_at.
    const nowDual = Math.floor(Date.now() / 1000);
    await e.DB.prepare(
      "UPDATE exit_nodes SET last_roster_at = ? WHERE status = 'active'",
    ).bind(nowDual + 60).run();
    const legacyCatResp = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(legacyCatResp.status).toBe(200);
    const legacyCat = await legacyCatResp.json() as any;
    expect(legacyCat.routing.homeSocks5.username).toBe('scope_user');
    expect(legacyCat).not.toHaveProperty('routingDigestVersion');
    const plainStamp = await e.DB.prepare(
      'SELECT ever_served_plaintext_at FROM home_exits WHERE id = ?',
    ).bind(homeId).first<{ ever_served_plaintext_at: number | null }>();
    expect(plainStamp?.ever_served_plaintext_at).toEqual(expect.any(Number));

    // Per-node token during `dual` phase still does not receive homeIdentities/homeOutbounds.
    const dualNodeResp = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-a']}` },
    });
    expect(dualNodeResp.status).toBe(200);
    expect(await dualNodeResp.json()).not.toHaveProperty('homeOutbounds');

    // Advance rollout to device_only and assign homeId ONLY to exit-a (NOT exit-b).
    await advanceRolloutToDeviceOnly();
    await assignHomeExitToNode(e, homeId, 'exit-a');

    // First node-home client fetch mints device_home_credentials and waits for exit-a ACK -> 503.
    const firstHomeCat = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}`, 'x-tono-accept': 'node-home' },
    });
    expect(firstHomeCat.status).toBe(503);

    // Reject invalid nodeHomeCapable claims (metering < 3 or unverified Xray version).
    const nowSec = Math.floor(Date.now() / 1000);
    expect((await api('home/roster-ack', json({
      observedAt: nowSec,
      meteringProtocolVersion: 2,
      nodeHomeCapable: true,
      nodeHomeXrayVersion: '26.3.27',
    }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(400);
    expect((await api('home/roster-ack', json({
      observedAt: nowSec,
      meteringProtocolVersion: 3,
      nodeHomeCapable: true,
      nodeHomeXrayVersion: '26.99.0',
    }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(400);

    // Register node-home capability (meteringProtocolVersion: 3 via roster-ack,
    // while metering-ack keeps protocol v2 per 0036 CHECK) for BOTH exit-a and exit-b.
    for (const nodeKey of ['exit-a', 'exit-b'] as const) {
      const mAck = await api('home/metering-ack', json({
        meteringProtocolVersion: 2,
        observedAt: nowSec,
      }, EXIT_NODE_TOKENS[nodeKey]));
      expect(mAck.status).toBe(200);
      expect(await api('home/roster-ack', json({
        observedAt: nowSec,
        meteringProtocolVersion: 3,
        nodeHomeCapable: true,
        nodeHomeXrayVersion: nodeKey === 'exit-a' ? '26.3.27' : '26.11.9',
      }, EXIT_NODE_TOKENS[nodeKey])).then((r) => r.status)).toBe(200);
    }

    // Ensure exit_nodes.metering_protocol_version stays 2 and node_home_metering_version = 3.
    const nodeARow = await e.DB.prepare(
      'SELECT metering_protocol_version, node_home_metering_version, node_home_xray_version FROM exit_nodes WHERE id = ?',
    ).bind('exit-a').first<any>();
    expect(nodeARow).toEqual({
      metering_protocol_version: 2,
      node_home_metering_version: 3,
      node_home_xray_version: '26.3.27',
    });

    // exit-a is assigned to homeId -> receives BOTH homeIdentities and scoped homeOutbounds.
    const nodeARoster = await (await api('home/exit-identities', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-a']}` },
    })).json() as any;
    expect(nodeARoster.identities.every((row: any) => !('kind' in row))).toBe(true);
    expect(nodeARoster.homeIdentities).toHaveLength(1);
    expect(nodeARoster.homeIdentities[0]).toMatchObject({
      userId: account.user.id,
      deviceId: account.device.id,
      homeExitId: homeId,
    });
    expect(nodeARoster.homeOutbounds).toEqual([
      {
        homeExitId: homeId,
        bindingGeneration: nodeARoster.homeIdentities[0].bindingGeneration,
        host: '198.51.100.88',
        port: 21080,
        username: 'scope_user',
        password: 'scope_secret',
      },
    ]);

    // Audit delivery row logged without plaintext secrets.
    const audit = await e.DB.prepare(
      'SELECT node_id, home_exit_ids_json, identity_count FROM home_outbound_deliveries WHERE node_id = ?',
    ).bind('exit-a').first<any>();
    expect(audit).toEqual({
      node_id: 'exit-a',
      home_exit_ids_json: JSON.stringify([homeId]),
      identity_count: 1,
    });

    // exit-b is NOT assigned to homeId -> receives empty homeIdentities/homeOutbounds (zero secrets).
    const nodeBRosterResp = await api('home/exit-identities', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-b']}` },
    });
    expect(nodeBRosterResp.status).toBe(200);
    const nodeBText = await nodeBRosterResp.text();
    expect(nodeBText).not.toContain('scope_secret');
    expect(nodeBText).not.toContain('scope_user');
    const nodeBRoster = JSON.parse(nodeBText) as any;
    expect(nodeBRoster.homeIdentities).toEqual([]);
    expect(nodeBRoster.homeOutbounds).toEqual([]);

    // /api/v1/ops-ingest/node-clients never carries h: identities or SOCKS5 credentials.
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'ops-collector-test-token-with-32-chars';
    const opsClients = await api('ops-ingest/node-clients', {
      headers: { authorization: 'Bearer ops-collector-test-token-with-32-chars' },
    });
    expect(opsClients.status).toBe(200);
    const opsClientsText = await opsClients.text();
    expect(opsClientsText).not.toContain('scope_secret');
    expect(opsClientsText).not.toContain('homeOutbounds');
    expect(opsClientsText).not.toContain('homeIdentities');
  });

  it('serves homeTunnel + v2 digest once ACKed and enforces drain ACK + 0080 rotation on unbind', async () => {
    await setupDeviceOnlyCatalog();
    const owner = await createAccount('node-home-drain-owner');
    const nextHolder = await createAccount('node-home-drain-next');
    await advanceRolloutToDeviceOnly();
    const e = env as unknown as Env;

    const home = await admin('home-exits', {
      proxyName: 'Home Drain Flow',
      displayName: '家宽 Drain',
      kind: 'socks5',
      socks5Host: '198.51.100.99',
      socks5Port: 31080,
      socks5Username: 'drain_u',
      socks5Password: 'drain_p1',
    });
    expect(home.status).toBe(201);
    const homeId = String(((await home.json()) as { homeExit: { id: string } }).homeExit.id);
    await setHomeExitDeliveryMode(e, homeId, 'node_only');
    await assignHomeExitToNode(e, homeId, 'exit-a');
    expect((await admin(`users/${owner.user.id}/home-binding`, {
      homeExitId: homeId,
      defaultProxyName: 'San Jose · CloudSilk',
    }, 'PUT')).status).toBe(201);

    const t = Math.floor(Date.now() / 1000);
    // Mark exit-a node-home capable, mint credential (503 first), pull roster, then ACK > created_at.
    expect((await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}`, 'x-tono-accept': 'node-home' },
    })).status).toBe(503);
    expect((await api('home/metering-ack', json({ meteringProtocolVersion: 2, observedAt: t }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(200);
    expect((await api('home/roster-ack', json({
      observedAt: t,
      meteringProtocolVersion: 3,
      nodeHomeCapable: true,
      nodeHomeXrayVersion: '26.3.27',
    }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(200);

    const pulled = await (await api('home/exit-identities', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-a']}` },
    })).json() as any;
    expect(pulled.homeIdentities).toHaveLength(1);
    const generation = pulled.homeIdentities[0].bindingGeneration as string;
    const hUuid = pulled.homeIdentities[0].clientUUID as string;

    // Backdate created_at & assignment timestamp strictly below ack timestamp to avoid same-second flake.
    await e.DB.prepare(
      'UPDATE device_home_credentials SET created_at = ? WHERE home_exit_id = ?',
    ).bind(t - 5, homeId).run();
    await e.DB.prepare(
      'UPDATE home_exit_nodes SET created_at = ? WHERE home_exit_id = ?',
    ).bind(t - 5, homeId).run();
    expect((await api('home/roster-ack', json({
      observedAt: t,
      meteringProtocolVersion: 3,
      nodeHomeCapable: true,
      nodeHomeXrayVersion: '26.3.27',
      homeObservedAt: t + 1,
    }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(200);

    // Client now gets homeTunnel + routingDigestVersion: 2 + canonical v2 routingSha256 (never homeSocks5).
    const readyResp = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}`, 'x-tono-accept': 'hy2, node-home' },
    });
    expect(readyResp.status).toBe(200);
    const readyBody = await readyResp.json() as any;
    expect(readyBody.routingDigestVersion).toBe(2);
    expect(readyBody.routing).toEqual({
      defaultProxy: 'San Jose · CloudSilk',
      homeTunnel: {
        homeExitId: homeId,
        clientUuid: hUuid,
        exitBaseNames: ['Los Angeles · Mesa'],
      },
    });
    expect(JSON.stringify(readyBody)).not.toContain('drain_p1');
    expect(readyBody.routingSha256).toBe(await routingSha256V2(readyBody.routing));

    // Unbind fires 0106 + 0080 triggers atomically: retires h: credential & marks drain + rotation required.
    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);

    const credRow = await e.DB.prepare(
      'SELECT retired_at, retire_reason FROM device_home_credentials WHERE home_exit_id = ?',
    ).bind(homeId).first<any>();
    expect(credRow?.retired_at).toEqual(expect.any(Number));
    expect(credRow?.retire_reason).toBe('unbind');

    const homeAfterUnbind = await e.DB.prepare(
      'SELECT drain_required_generation, socks5_rotation_required_at FROM home_exits WHERE id = ?',
    ).bind(homeId).first<any>();
    expect(homeAfterUnbind?.drain_required_generation).toBe(generation);
    expect(homeAfterUnbind?.socks5_rotation_required_at).toEqual(expect.any(Number));

    // Rebinding while un-drained MUST fail with 409 HOME_EXIT_DRAINING.
    const drainingBind = await admin(`users/${nextHolder.user.id}/home-binding`, { homeExitId: homeId }, 'PUT');
    expect(drainingBind.status).toBe(409);
    expect(((await drainingBind.json()) as any).error.code).toBe('HOME_EXIT_DRAINING');

    // exit-a acknowledges drain for retired generation -> drained_at stamped even when withdrawing capability,
    // yet 0080 rotation remains required per PR 0 empirical gate (rmo does not cancel open TCP streams).
    expect((await api('home/roster-ack', json({
      observedAt: t + 2,
      meteringProtocolVersion: 3,
      nodeHomeCapable: false,
      drainedGenerations: [{ homeExitId: homeId, retiredGeneration: generation }],
    }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(200);

    const drainRow = await e.DB.prepare(
      'SELECT drained_at FROM home_exit_drain_acks WHERE home_exit_id = ? AND retired_generation = ? AND node_id = ?',
    ).bind(homeId, generation, 'exit-a').first<any>();
    expect(drainRow?.drained_at).toEqual(expect.any(Number));

    const stillRotationBind = await admin(`users/${nextHolder.user.id}/home-binding`, { homeExitId: homeId }, 'PUT');
    expect(stillRotationBind.status).toBe(409);
    expect(((await stillRotationBind.json()) as any).error.code).toBe('SOCKS5_ROTATION_REQUIRED');

    // Upstream password rotation clears both 0080 lock and drain_required_generation -> rebind succeeds.
    expect((await admin(`home-exits/${homeId}`, { socks5Password: 'drain_p2' }, 'PATCH')).status).toBe(200);
    const homeCleared = await e.DB.prepare(
      'SELECT drain_required_generation, socks5_rotation_required_at FROM home_exits WHERE id = ?',
    ).bind(homeId).first<any>();
    expect(homeCleared).toEqual({ drain_required_generation: null, socks5_rotation_required_at: null });

    expect((await admin(`users/${nextHolder.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status).toBe(201);
  });

  it('matches access ops PATCH home-exits password rotation clearing drain_required_generation', async () => {
    const e = env as unknown as Env;
    const home = await admin('home-exits', {
      proxyName: 'Home Ops Clear',
      displayName: '家宽 Ops Clear',
      kind: 'socks5',
      socks5Host: '198.51.100.120',
      socks5Port: 1080,
      socks5Username: 'ops_u',
      socks5Password: 'ops_p1',
    });
    expect(home.status).toBe(201);
    const homeId = String(((await home.json()) as any).homeExit.id);
    await e.DB.prepare(
      `UPDATE home_exits SET drain_required_generation = 'gen-ops-1', socks5_rotation_required_at = 100 WHERE id = ?`,
    ).bind(homeId).run();

    const patchResp = await api(`ops/home-exits/${homeId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
      },
      body: JSON.stringify({ socks5Password: 'ops_p2' }),
    });
    expect(patchResp.status).toBe(200);
    const after = await e.DB.prepare(
      'SELECT drain_required_generation, socks5_rotation_required_at FROM home_exits WHERE id = ?',
    ).bind(homeId).first<any>();
    expect(after).toEqual({ drain_required_generation: null, socks5_rotation_required_at: null });

    // Patching only notes while drain_required_generation is set and socks5_rotation_required_at is NULL
    // MUST preserve drain_required_generation.
    await e.DB.prepare(
      `UPDATE home_exits SET drain_required_generation = 'gen-preserve-1', socks5_rotation_required_at = NULL WHERE id = ?`,
    ).bind(homeId).run();
    const notesPatch = await api(`ops/home-exits/${homeId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
      },
      body: JSON.stringify({ notes: 'metadata-only update' }),
    });
    expect(notesPatch.status).toBe(200);
    const preserved = await e.DB.prepare(
      'SELECT drain_required_generation FROM home_exits WHERE id = ?',
    ).bind(homeId).first<any>();
    expect(preserved?.drain_required_generation).toBe('gen-preserve-1');

    expect(nextSequence()).toBeGreaterThan(0);
  });

  it('clears node_home_capable on legacy rollback roster-ack, rejects homeObservedAt without capability, and gates newly assigned nodes', async () => {
    await setupDeviceOnlyCatalog();
    const owner = await createAccount('node-home-rollback');
    await advanceRolloutToDeviceOnly();
    const e = env as unknown as Env;

    const home = await admin('home-exits', {
      proxyName: 'Home Rollback Fence',
      displayName: '家宽 Rollback',
      kind: 'socks5',
      socks5Host: '198.51.100.130',
      socks5Port: 41080,
      socks5Username: 'rb_u',
      socks5Password: 'rb_p',
    });
    expect(home.status).toBe(201);
    const homeId = String(((await home.json()) as any).homeExit.id);
    await setHomeExitDeliveryMode(e, homeId, 'node_only');
    await assignHomeExitToNode(e, homeId, 'exit-a');
    expect((await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status).toBe(201);

    const t = Math.floor(Date.now() / 1000);
    // Mint h: credential via initial 503 fetch.
    expect((await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}`, 'x-tono-accept': 'node-home' },
    })).status).toBe(503);

    // Reject homeObservedAt when nodeHomeCapable is absent or false.
    expect((await api('home/roster-ack', json({
      observedAt: t,
      homeObservedAt: t + 1,
    }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(400);
    expect((await api('home/roster-ack', json({
      observedAt: t,
      meteringProtocolVersion: 3,
      nodeHomeCapable: false,
      homeObservedAt: t + 1,
    }, EXIT_NODE_TOKENS['exit-a']))).status).toBe(400);

    // Make both exit-a and exit-b node-home capable at t + 1.
    await e.DB.prepare('UPDATE device_home_credentials SET created_at = ? WHERE home_exit_id = ?').bind(t - 5, homeId).run();
    await e.DB.prepare('UPDATE home_exit_nodes SET created_at = ? WHERE home_exit_id = ?').bind(t - 5, homeId).run();
    for (const nodeKey of ['exit-a', 'exit-b'] as const) {
      expect((await api('home/metering-ack', json({ meteringProtocolVersion: 2, observedAt: t }, EXIT_NODE_TOKENS[nodeKey]))).status).toBe(200);
      expect((await api('home/roster-ack', json({
        observedAt: t,
        meteringProtocolVersion: 3,
        nodeHomeCapable: true,
        nodeHomeXrayVersion: '26.3.27',
        homeObservedAt: t + 1,
      }, EXIT_NODE_TOKENS[nodeKey]))).status).toBe(200);
    }

    // Now assign exit-b AFTER its last_home_roster_at (t + 1) by giving home_exit_nodes.created_at = t + 5.
    await assignHomeExitToNode(e, homeId, 'exit-b');
    await e.DB.prepare(
      'UPDATE home_exit_nodes SET created_at = ? WHERE home_exit_id = ? AND exit_node_id = ?',
    ).bind(t + 5, homeId, 'exit-b').run();

    // Only exit-a appears in homeTunnel.exitBaseNames until exit-b ACKs homeObservedAt > t + 5.
    const catBeforeBAck = await (await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}`, 'x-tono-accept': 'node-home' },
    })).json() as any;
    expect(catBeforeBAck.routing.homeTunnel.exitBaseNames).toEqual(['Los Angeles · Mesa']);

    expect((await api('home/roster-ack', json({
      observedAt: t + 6,
      meteringProtocolVersion: 3,
      nodeHomeCapable: true,
      nodeHomeXrayVersion: '26.3.27',
      homeObservedAt: t + 6,
    }, EXIT_NODE_TOKENS['exit-b']))).status).toBe(200);
    const catBothReady = await (await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}`, 'x-tono-accept': 'node-home' },
    })).json() as any;
    expect(catBothReady.routing.homeTunnel.exitBaseNames).toEqual(['Los Angeles · Mesa', 'San Jose · CloudSilk']);

    // Simulate rolling exit-a & exit-b agents back to legacy v2 (posting { observedAt } without nodeHomeCapable).
    for (const nodeKey of ['exit-a', 'exit-b'] as const) {
      expect((await api('home/roster-ack', json({ observedAt: t + 10 }, EXIT_NODE_TOKENS[nodeKey]))).status).toBe(200);
    }
    const rowA = await e.DB.prepare(
      'SELECT node_home_capable, node_home_metering_version FROM exit_nodes WHERE id = ?',
    ).bind('exit-a').first<any>();
    expect(rowA).toEqual({ node_home_capable: 0, node_home_metering_version: 0 });

    const rolledBackRosterA = await (await api('home/exit-identities', {
      headers: { authorization: `Bearer ${EXIT_NODE_TOKENS['exit-a']}` },
    })).json() as any;
    expect(rolledBackRosterA).not.toHaveProperty('homeOutbounds');
    expect(rolledBackRosterA).not.toHaveProperty('homeIdentities');

    // With both assigned nodes rolled back to v2, client fetch fails closed with 503.
    expect((await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}`, 'x-tono-accept': 'node-home' },
    })).status).toBe(503);
  });
});
