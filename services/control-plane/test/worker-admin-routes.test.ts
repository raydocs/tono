import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/crypto';
import worker, { type Env } from '../src/index';
import adminWorker from '../src/admin-worker';
import {
  ADMIN_TOKEN,
  api,
  json,
  admin,
  GOOGLE_AUDIENCE,
  ACCESS_ADMIN_EMAIL,
  sequence,
  accessAssertion,
  operations,
  createAccount,
  startEmailSignIn,
  emailSignIn,
  nextSequence,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('redirects the absorbed quality and ops hostnames to the admin monitor', async () => {
    for (const host of ['quality.afk.ccwu.cc', 'ops.afk.ccwu.cc']) {
      const context = createExecutionContext();
      const response = await adminWorker.fetch(
        new Request(`https://${host}/`),
        env as unknown as Parameters<typeof adminWorker.fetch>[1],
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://admin.afk.ccwu.cc/ops/#/nodes');
    }
  });

  it('serves per-user device and diagnostics detail to Access admins', async () => {
    const missing = await operations(`users/${crypto.randomUUID()}/detail`);
    expect(missing.status).toBe(404);

    const account = await createAccount('opsdetail');
    const response = await operations(`users/${account.user.id}/detail`);
    expect(response.status).toBe(200);
    const detail = await response.json() as any;
    expect(detail.devices).toHaveLength(1);
    expect(detail.devices[0].name).toBe('Primary Mac');
    expect(typeof detail.devices[0].status).toBe('string');
    expect(detail.diagnostics).toEqual([]);
  });

  it('lets Access admins replace the catalog and traffic policy on ops routes', async () => {
    const yaml = [
      'proxies:',
      '  - name: "Ops Exit"',
      '    type: vless',
      '    server: 203.0.113.50',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    network: tcp',
      '    tls: true',
      '    udp: true',
      '    servername: www.microsoft.com',
      '    client-fingerprint: chrome',
      '    flow: xtls-rprx-vision',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
    ].join('\n');
    const putCatalog = await api('ops/exit-catalog', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
      },
      body: JSON.stringify({ yaml, expectedRevision: 0 }),
    });
    expect(putCatalog.status).toBe(200);
    expect((await putCatalog.json() as any).revision).toBe(1);

    const policy = await operations('traffic-policy');
    expect(policy.status).toBe(200);
    expect((await policy.json() as any).revision).toBe(0);
  });

  it('does not serve the legacy token admin page on the API host', async () => {
    for (const path of ['/', '/index.html', '/admin.js', '/style.css']) {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request(`https://test${path}`),
        env as unknown as Env,
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(404);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('This host is the Tono API');
    }
  });

  it('lets Access admins add users and bind home exits through ops product routes', async () => {
    const unauthorized = await api('ops/users', {
      method: 'GET',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(unauthorized.status).toBe(401);

    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const addAllow = await api('ops/signup-allowlist', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({ email: 'family-user@example.com' }),
    });
    expect(addAllow.status).toBe(201);

    const account = await createAccount('ops-family');
    const homeCreate = await api('ops/home-exits', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        proxyName: 'Home Residential Ops',
        displayName: '家庭 Ops',
        egressIpv4: '198.51.100.9',
      }),
    });
    expect(homeCreate.status).toBe(201);
    const homeId = ((await homeCreate.json()) as any).homeExit.id;

    const bind = await api(`ops/users/${account.user.id}/home-binding`, {
      method: 'PUT',
      headers: accessHeaders,
      body: JSON.stringify({ homeExitId: homeId }),
    });
    expect(bind.status).toBe(201);

    const users = await operations('users');
    expect(users.status).toBe(200);
    const usersBody = await users.json() as any;
    const listed = usersBody.users.find((row: any) => row.id === account.user.id);
    expect(listed.homeBinding).toMatchObject({
      homeExitId: homeId,
      proxyName: 'Home Residential Ops',
      egressIpv4: '198.51.100.9',
    });
    // The list no longer truncates silently: the caller is told how many
    // customers exist and how to fetch the next page.
    expect(usersBody.total).toBeGreaterThanOrEqual(usersBody.users.length);
    expect(usersBody.hasMore).toBe(false);
    expect(usersBody.nextCursor).toBeNull();

    await createAccount('ops-family-second');
    const firstPage = await operations('users?limit=1');
    expect(firstPage.status).toBe(200);
    const firstBody = await firstPage.json() as any;
    expect(firstBody.users).toHaveLength(1);
    expect(firstBody.hasMore).toBe(true);
    expect(typeof firstBody.nextCursor).toBe('string');
    const secondPage = await operations(`users?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`);
    expect(secondPage.status).toBe(200);
    const secondBody = await secondPage.json() as any;
    expect(secondBody.users).toHaveLength(1);
    expect(secondBody.users[0].id).not.toBe(firstBody.users[0].id);

    expect((await operations('users?limit=0')).status).toBe(400);
    expect((await operations('users?cursor=broken')).status).toBe(400);
  });

  it('refuses a JSON body that does not declare the JSON media type', async () => {
    // enctype=text/plain is the cross-site form post that never triggers a
    // CORS preflight; requiring the media type makes such a write impossible.
    const formShaped = await api('ops/signup-allowlist', {
      method: 'POST',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'text/plain',
      },
      body: JSON.stringify({ email: 'csrf-target@example.com' }),
    });
    expect(formShaped.status).toBe(415);
    expect((await formShaped.json() as any).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const stillAbsent = await env.DB.prepare(
      'SELECT 1 FROM signup_allowlist WHERE email = ?',
    ).bind('csrf-target@example.com').first();
    expect(stillAbsent).toBeNull();

    // A charset suffix is still the JSON media type.
    const withCharset = await api('ops/signup-allowlist', {
      method: 'POST',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ email: 'charset-ok@example.com' }),
    });
    expect(withCharset.status).toBe(201);
  });

  it('leaves an audit row for operator user edits and home bindings', async () => {
    const account = await createAccount('audit-trail');
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const patched = await api(`ops/users/${account.user.id}`, {
      method: 'PATCH',
      headers: accessHeaders,
      body: JSON.stringify({
        notes: '审计备注',
        expiresAt: Math.floor(Date.now() / 1_000) + 86_400,
      }),
    });
    expect(patched.status).toBe(200);
    const patchAudit = await env.DB.prepare(
      "SELECT * FROM ops_audit WHERE action = 'user.update' AND target_id = ?",
    ).bind(account.user.id).first<any>();
    expect(patchAudit).toMatchObject({
      actor_email: ACCESS_ADMIN_EMAIL,
      target_type: 'user',
      // The names of the fields that changed, not a bare "updated".
      summary: 'changed expiresAt, notes',
    });

    const home = await api('ops/home-exits', {
      method: 'POST',
      headers: accessHeaders,
      body: JSON.stringify({
        proxyName: 'Audit Home',
        displayName: '审计家宽',
        egressIpv4: '198.51.100.77',
      }),
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id;
    const bound = await api(`ops/users/${account.user.id}/home-binding`, {
      method: 'PUT',
      headers: accessHeaders,
      body: JSON.stringify({ homeExitId: homeId }),
    });
    expect(bound.status).toBe(201);
    const bindAudit = await env.DB.prepare(
      "SELECT * FROM ops_audit WHERE action = 'home.assign' AND target_id = ?",
    ).bind(account.user.id).first<any>();
    expect(bindAudit).toMatchObject({
      actor_email: ACCESS_ADMIN_EMAIL,
      target_type: 'user',
    });
    expect(String(bindAudit.summary)).toContain(account.email);

    // The log endpoint answers filtered questions instead of only "newest 100".
    const filtered = await operations(`audit?targetId=${account.user.id}&limit=1`);
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json() as any;
    expect(filteredBody.entries).toHaveLength(1);
    expect(filteredBody.entries[0].targetId).toBe(account.user.id);
    expect(filteredBody.hasMore).toBe(true);
    const older = await operations(
      `audit?targetId=${account.user.id}&before=${filteredBody.nextBefore + 1}`,
    );
    const olderBody = await older.json() as any;
    expect(olderBody.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of olderBody.entries) {
      expect(entry.targetId).toBe(account.user.id);
      expect(entry.at).toBeLessThan(filteredBody.nextBefore + 1);
    }
    expect((await operations('audit?limit=0')).status).toBe(400);
    expect((await operations('audit?before=-5')).status).toBe(400);
  });

  it('serves the shared administrative resources identically through both front doors', async () => {
    // The two surfaces authenticate differently and used to carry their own copy
    // of these handlers, which had already drifted. Asserting the responses are
    // byte-identical is what keeps one consolidated implementation honest — and
    // what would have caught the drift that existed before it.
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const created = await api('admin/home-exits', {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        proxyName: 'parity-exit',
        displayName: 'Parity',
        kind: 'socks5',
        socks5Host: '198.51.100.20',
        socks5Port: 1080,
        socks5Username: 'u',
        socks5Password: 'p',
      }),
    });
    expect(created.status).toBe(201);
    const exitId = ((await created.json()) as any).homeExit.id;
    const account = await createAccount('front-door-parity');
    expect((await api(`admin/users/${account.user.id}/home-binding`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ homeExitId: exitId }),
    })).status).toBe(201);

    for (const resource of ['home-exits', 'home-bindings', 'signup-allowlist']) {
      const viaToken = await api(`admin/${resource}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      const viaAccess = await api(`ops/${resource}`, {
        method: 'GET',
        headers: accessHeaders,
      });
      expect(viaToken.status).toBe(200);
      expect(viaAccess.status).toBe(200);
      expect(await viaAccess.text()).toBe(await viaToken.text());
    }

    // Locks the response contract rather than the coercion. The pre-consolidation
    // difference here — one door wrapping `email` in `String()`, the other
    // returning D1's value — turns out to have no runtime effect, because D1
    // already hands back a string for a TEXT column. Asserting the types is
    // still worth having: it is a schema change to a non-text column, not a
    // missing `String()`, that this would catch.
    const allowlist = await api('admin/signup-allowlist', {
      method: 'GET',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    for (const entry of ((await allowlist.json()) as any).entries) {
      expect(typeof entry.email).toBe('string');
      expect(typeof entry.createdAt).toBe('number');
    }

    // A write reaches the same implementation too: the PATCH is issued through
    // Access and read back through the token surface.
    const patched = await api(`ops/home-exits/${exitId}`, {
      method: 'PATCH',
      headers: accessHeaders,
      body: JSON.stringify({ displayName: 'Parity renamed' }),
    });
    expect(patched.status).toBe(200);
    const readBack = await api('admin/home-exits', {
      method: 'GET',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(((await readBack.json()) as any).homeExits.find(
      (row: any) => row.id === exitId,
    ).displayName).toBe('Parity renamed');

    // And neither door accepts the other's credential.
    expect((await api('ops/home-exits', {
      method: 'GET',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })).status).toBe(401);
    expect((await api('admin/home-exits', {
      method: 'GET',
      headers: accessHeaders,
    })).status).toBe(401);
  });

  it('keeps the phase-1 operations tables out of the API surface', async () => {
    const timestamp = 1_700_000_000;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO operations_servers(id, display_name, region_code, provider, status, created_at, updated_at)
         VALUES(?, ?, ?, ?, 'active', ?, ?)`,
      ).bind('server-us-west', 'US West', 'us-west', 'provider-a', timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO operations_logical_nodes(id, server_id, display_name, region_code, status, created_at, updated_at)
         VALUES(?, ?, ?, ?, 'active', ?, ?)`,
      ).bind('node-us-west-1', 'server-us-west', 'US West 1', 'us-west', timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO operations_deployments(
           id, server_id, logical_node_id, environment, release_version, status, deployed_at, created_at
         ) VALUES(?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).bind('deployment-1', 'server-us-west', 'node-us-west-1', 'production', '2026.08.1', timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO operations_catalog_revision_metadata(
           revision, content_sha256, published_at, server_count, logical_node_count, deployment_count
         ) VALUES(?, ?, ?, ?, ?, ?)`,
      ).bind(7, 'a'.repeat(64), timestamp, 1, 1, 1),
      env.DB.prepare(
        `INSERT INTO managed_exit_catalog(
           singleton_id, revision, ciphertext, nonce, content_sha256, updated_at
         ) VALUES(1, ?, ?, ?, ?, ?)`,
      ).bind(7, 'encrypted-catalog', 'catalog-nonce', 'b'.repeat(64), timestamp + 1),
    ]);

    const dashboard = await operations('dashboard');
    expect(dashboard.status).toBe(200);
    // Dashboard occupancy is the live fleet (catalog + quality + agents), not
    // the unused operations_servers inventory seeded above.
    expect((await dashboard.json() as any).dashboard.servers).toEqual({ total: 0, active: 0 });

    // The migration-0016 read endpoints are gone: nothing drove them (the
    // dashboard hardcodes deployments) and the seeded rows above must stay
    // unreachable rather than resurfacing as a forgotten API.
    // `nodes` is now the contract list (`NodeSummaryDto`); it must not 404.
    for (const retired of ['servers', 'deployments']) {
      const response = await operations(retired);
      expect(response.status).toBe(404);
    }
    expect((await operations('nodes')).status).toBe(200);

    const revisions = await operations('catalog-revisions');
    expect((await revisions.json() as any).revisions).toEqual([{
      revision: 7,
      sha256: 'b'.repeat(64),
      publishedAt: timestamp + 1,
      serverCount: 1,
      logicalNodeCount: 1,
      deploymentCount: 1,
      current: true,
    }]);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO operations_servers(id, display_name, region_code, status, created_at, updated_at)
         VALUES('server-jp', 'Japan', 'jp', 'active', ?, ?)`,
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO operations_logical_nodes(id, server_id, display_name, region_code, status, created_at, updated_at)
         VALUES('node-jp-1', 'server-jp', 'Japan 1', 'jp', 'active', ?, ?)`,
      ).bind(timestamp, timestamp),
    ]);
    await expect(env.DB.prepare(
      `INSERT INTO operations_deployments(
         id, server_id, logical_node_id, environment, release_version, status, created_at
       ) VALUES('cross-server', 'server-us-west', 'node-jp-1', 'production', 'invalid', 'active', ?)`,
    ).bind(timestamp).run()).rejects.toThrow();

    const rejectedWrite = await operations('servers', ACCESS_ADMIN_EMAIL, 'POST');
    expect(rejectedWrite.status).toBe(405);
    expect(rejectedWrite.headers.get('allow')).toContain('GET');
    expect((await env.DB.prepare('SELECT COUNT(*) total FROM operations_servers').first<any>()).total).toBe(2);

    // Existing token-authenticated CLI/admin operations remain available on their original boundary.
    expect((await admin('users', undefined, 'GET')).status).toBe(200);
  });

  it('manages exact signup access without a Worker redeployment', async () => {
    const address = `managed-user-${nextSequence()}@outside.test`;
    const unauthorized = await api('admin/signup-allowlist');
    expect(unauthorized.status).toBe(401);

    const added = await admin('signup-allowlist', { email: address.toUpperCase() });
    expect(added.status).toBe(201);
    expect(await added.json()).toEqual({
      email: address,
      createdAt: expect.any(Number),
      created: true,
    });

    const duplicate = await admin('signup-allowlist', { email: address });
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as any).created).toBe(false);

    const listed = await admin('signup-allowlist', undefined, 'GET');
    expect(listed.status).toBe(200);
    expect((await listed.json() as any).entries).toContainEqual({
      email: address,
      createdAt: expect.any(Number),
    });

    const login = await emailSignIn({
      email: address,
      deviceName: 'Managed user Mac',
      installationId: 'managed-user-installation-one',
    });
    expect(login.status).toBe(200);

    const removed = await admin('signup-allowlist', { email: address }, 'DELETE');
    expect(removed.status).toBe(204);
    const afterRemoval = await admin('signup-allowlist', undefined, 'GET');
    expect((await afterRemoval.json() as any).entries).not.toContainEqual(
      expect.objectContaining({ email: address }),
    );

    const blocked = await startEmailSignIn({
      email: `removed-user-${sequence}@outside.test`,
      deviceName: 'Removed user Mac',
      installationId: 'removed-user-installation-one',
    });
    expect(blocked.response.status).toBe(202);
    expect(blocked.code).toBeUndefined();
  });

  it('advertises configured passwordless methods and retires password routes', async () => {
    const methods = await api('auth/methods');
    expect(methods.status).toBe(200);
    expect(await methods.json()).toEqual({
      email: { enabled: true },
      apple: { enabled: true },
      google: { enabled: true, clientId: GOOGLE_AUDIENCE },
    });

    for (const route of ['auth/login', 'auth/redeem']) {
      const retired = await api(route, json({}));
      expect(retired.status).toBe(410);
      expect((await retired.json() as any).error.code).toBe('PASSWORD_AUTH_DISABLED');
    }
  });
});
