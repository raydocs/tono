import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/crypto';
import worker, { type Env } from '../src/index';
import {
  api,
  json,
  admin,
  ACCESS_ADMIN_EMAIL,
  tailscaleRequests,
  accessAssertion,
  operations,
  createAccount,
  acknowledgeServedExits,
  startEmailSignIn,
  nextSequence,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('activates a VLESS-only device without contacting Tailscale', async () => {
    const cloudOnlyEnv = Object.create(env) as Env;
    cloudOnlyEnv.TAILSCALE_ENROLLMENT_ENABLED = 'false';
    const started = await startEmailSignIn({
      email: `cloud-only-${nextSequence()}@example.com`,
      deviceName: 'Reality Mac',
      installationId: 'cloud-only-installation-one',
    });
    expect(started.response.status).toBe(202);
    expect(started.code).toBeTruthy();

    const invoke = async (path: string, init: RequestInit) => {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request(`https://test/api/v1/${path}`, init),
        cloudOnlyEnv,
        context,
      );
      await waitOnExecutionContext(context);
      return response;
    };
    const response = await invoke('auth/email/verify', json({
      challengeId: started.challengeId,
      code: started.code,
    }));
    expect(response.status).toBe(200);
    const account = await response.json() as any;
    expect(account.device.status).toBe('active');
    expect(account.device.pendingExpiresAt).toBeNull();
    expect(account.device.confirmedAt).toEqual(expect.any(Number));
    expect(account.enrollment).toBeUndefined();
    expect(tailscaleRequests).toEqual([]);

    const enrollment = await invoke(
      `devices/${account.device.id}/enrollment`,
      json({ installationId: 'cloud-only-installation-one' }, account.accessToken),
    );
    expect(enrollment.status).toBe(410);
    expect((await enrollment.json() as any).error.code).toBe('TAILSCALE_DISABLED');
    expect(tailscaleRequests).toEqual([]);
  });

  it('records the client build from X-Tono-Client on sign-in, token refresh and catalog fetch', async () => {
    // With telemetry off by default, nothing else tells operations which build a
    // device runs. Only a platform and a version are kept; anything else is dropped.
    const as = (init: RequestInit, client: string): RequestInit => ({
      ...init, headers: { ...init.headers as Record<string, string>, 'x-tono-client': client },
    });
    const started = await startEmailSignIn({
      email: `client-build-${nextSequence()}@example.com`,
      deviceName: 'Build Mac',
      installationId: 'client-build-installation',
    });
    const signedIn = await api('auth/email/verify', as(json({
      challengeId: started.challengeId, code: started.code,
    }), 'macos/0.0.72'));
    expect(signedIn.status).toBe(200);
    const account = await signedIn.json() as any;
    const build = () => env.DB.prepare('SELECT client_platform, client_version FROM devices WHERE id = ?')
      .bind(account.device.id).first();
    expect(await build()).toEqual({ client_platform: 'macos', client_version: '0.0.72' });

    const refreshed = await api('auth/refresh', as(json({ refreshToken: account.refreshToken }), 'macos/0.0.73'));
    expect(refreshed.status).toBe(200);
    const { accessToken } = await refreshed.json() as any;
    expect(await build()).toEqual({ client_platform: 'macos', client_version: '0.0.73' });

    const catalog = (client: string) => api('exit-catalog', {
      headers: { authorization: `Bearer ${accessToken}`, 'x-tono-client': client },
    });
    expect((await catalog('macos/0.0.74')).status).toBe(200);
    expect(await build()).toEqual({ client_platform: 'macos', client_version: '0.0.74' });
    expect((await catalog('macos/0.0.75 user@example.com')).status).toBe(200);
    expect((await catalog('linux/0.0.75')).status).toBe(200);
    expect(await build()).toEqual({ client_platform: 'macos', client_version: '0.0.74' });
  });

  it('refuses to publish a catalog holding an entry clients cannot admit', async () => {
    // One inadmissible entry makes every client refuse the whole catalog, so
    // fresh devices would get no catalog at all.
    const yaml = [
      'proxies:',
      '  - name: Tono-Exit',
      '    type: vless',
      '    server: exit.example.com',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    flow: xtls-rprx-vision',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
      '  - name: Tono-Bare',
      '    type: vless',
      '    server: bare.example.com',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '  - name: Tono-Quoted',
      '    type: vless',
      '    server: quoted.example.com',
      '    port: "443"',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    tls: true',
      '    servername: www.microsoft.com',
      '    reality-opts:',
      '      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '      short-id: abcd1234',
      '  - name: Tono-Exit · hy2',
      '    type: hysteria2',
      '    server: 203.0.113.9',
      '    password: {{TONO_CLIENT_UUID}}',
      `    fingerprint: ${'ab'.repeat(32)}`,
      '',
    ].join('\n');
    const put = await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT');
    expect(put.status).toBe(400);
    const error = (await put.json() as any).error;
    expect(error.code).toBe('INVALID_CATALOG');
    expect(error.message).toContain('Tono-Bare: servername, reality-opts');
    // Windows reads the port as a number; a quoted one fails its whole catalog.
    expect(error.message).toContain('Tono-Quoted: port');
    expect(error.message).toContain('Tono-Exit · hy2: port, sni');
    expect(await env.DB.prepare('SELECT revision FROM managed_exit_catalog').first()).toBeNull();
  });

  it('encrypts, versions, and serves the managed exit catalog only to authenticated users', async () => {
    // Identities are placeholders now: one catalog served verbatim to everyone is
    // how every account came to present the same identity at the exit, which is
    // why the exit could count bytes and never say whose.
    const yaml = `proxies:
  - name: "Managed Test"
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
    expect((await api('exit-catalog')).status).toBe(401);

    const blindWrite = await admin('exit-catalog', { yaml }, 'PUT');
    expect(blindWrite.status).toBe(400);
    expect((await blindWrite.json() as any).error.code).toBe('VALIDATION_ERROR');

    const literalIdentity = await admin(
      'exit-catalog',
      { yaml: yaml.replace('{{TONO_CLIENT_UUID}}', '11111111-1111-4111-8111-111111111111'), expectedRevision: 0 },
      'PUT',
    );
    expect(literalIdentity.status).toBe(400);
    expect((await literalIdentity.json() as any).error.code).toBe('INVALID_CATALOG');

    for (const invalidYaml of [
      yaml.replace('uuid: {{TONO_CLIENT_UUID}}', 'uuid: null'),
      yaml.replace('    uuid: {{TONO_CLIENT_UUID}}\n', '    # {{TONO_CLIENT_UUID}}\n'),
      'proxies:\n  - {name: Broken, type: vless, uuid: null} # {{TONO_CLIENT_UUID}}\n',
    ]) {
      const invalidIdentity = await admin(
        'exit-catalog',
        { yaml: invalidYaml, expectedRevision: 0 },
        'PUT',
      );
      expect(invalidIdentity.status).toBe(400);
      expect((await invalidIdentity.json() as any).error.code).toBe('INVALID_CATALOG');
    }

    const created = await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT');
    expect(created.status).toBe(200);
    const createdBody = await created.json() as any;
    expect(createdBody.revision).toBe(1);

    const publishAudit = await env.DB.prepare(
      `SELECT actor_email, action, target_type, target_id, summary
       FROM ops_audit WHERE action = 'catalog.publish'`,
    ).first<any>();
    expect(publishAudit).toMatchObject({
      actor_email: 'token-admin',
      action: 'catalog.publish',
      target_type: 'managed_exit_catalog',
      target_id: '1',
    });
    expect(String(publishAudit.summary)).toMatch(/^published r0 → r1 \([A-Za-z0-9_-]{16}\)$/);

    const stored = await env.DB.prepare(
      'SELECT revision, ciphertext, nonce, content_sha256 FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<any>();
    expect(stored.revision).toBe(1);
    expect(stored.ciphertext).not.toContain('Managed Test');
    expect(stored.ciphertext).not.toContain('TONO_CLIENT_UUID');
    expect(stored.nonce).not.toBe('');

    const adminFetched = await admin('exit-catalog', undefined, 'GET');
    expect(adminFetched.status).toBe(200);
    expect(await adminFetched.json()).toEqual({
      revision: 1,
      yaml,
      sha256: stored.content_sha256,
      updatedAt: createdBody.updatedAt,
    });

    // An account is served its own identity, and the digest is recomputed over
    // what it actually received — the template's digest would read as tampering
    // to a client that verifies, and every client verifies.
    await acknowledgeServedExits('Managed Test');
    const account = await createAccount('managed-catalog');
    const fetched = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
    const servedBody = await fetched.json() as any;
    expect(servedBody.revision).toBe(1);
    expect(servedBody.yaml).not.toContain('TONO_CLIENT_UUID');
    const issued = /uuid: ([0-9a-f-]{36})/.exec(servedBody.yaml)?.[1];
    expect(issued).toBeTruthy();
    expect(servedBody.sha256).not.toBe(stored.content_sha256);
    // Same encoding the Worker uses (base64url, per src/crypto.ts), so this
    // compares digests rather than encodings.
    const digestOf = async (text: string) => btoa(
      String.fromCharCode(...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
      )),
    ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(servedBody.sha256).toBe(await digestOf(servedBody.yaml));

    // Stable for this account: the client persists the digest and compares it, so
    // a fresh identity per request would look tampered every time.
    const refetched = await api('exit-catalog', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect((await refetched.json() as any).yaml).toBe(servedBody.yaml);

    // And distinct from another account's, which is the entire point.
    const other = await createAccount('managed-catalog-two');
    const otherFetched = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    const otherIssued = /uuid: ([0-9a-f-]{36})/.exec(
      (await otherFetched.json() as any).yaml,
    )?.[1];
    expect(otherIssued).toBeTruthy();
    expect(otherIssued).not.toBe(issued);

    const conflict = await admin(
      'exit-catalog',
      { yaml: 'proxies: []\n', expectedRevision: 0 },
      'PUT',
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as any).error.code).toBe('CATALOG_CONFLICT');

    const cleared = await admin(
      'exit-catalog',
      { yaml: 'proxies: []', expectedRevision: 1 },
      'PUT',
    );
    expect(cleared.status).toBe(200);
    expect((await cleared.json() as any).revision).toBe(2);

    const utf8Oversized = await admin(
      'exit-catalog',
      { yaml: `proxies:\n${'#界\n'.repeat(210_000)}`, expectedRevision: 2 },
      'PUT',
    );
    expect(utf8Oversized.status).toBe(400);
    expect((await utf8Oversized.json() as any).error.code).toBe('INVALID_CATALOG');
  });

  it('serves hy2 catalog blocks only to clients that declare hy2, narrowed by the gray list', async () => {
    const yaml = `proxies:
  - name: Tokyo · Sakura
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: Tokyo · Sakura · hy2
    type: hysteria2
    server: 8.8.8.8
    port: 443
    password: {{TONO_CLIENT_UUID}}
    sni: www.microsoft.com
    fingerprint: e3aa4a745aa90539ab1a493d940eeba7b4305b7516ab84167e46c98ad9fed3db
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    await acknowledgeServedExits('Tokyo · Sakura');
    const hidden = await createAccount('hy2-hidden');
    const hiddenFetched = await api('exit-catalog', {
      headers: { authorization: `Bearer ${hidden.accessToken}` },
    });
    expect(hiddenFetched.status).toBe(200);
    const hiddenBody = await hiddenFetched.json() as any;
    expect(hiddenBody.yaml).toContain('Tokyo · Sakura');
    expect(hiddenBody.yaml).not.toContain(' · hy2');
    expect(hiddenBody.yaml).not.toContain('hysteria2');

    const allowed = await createAccount('hy2-allowed');
    const previous = (env as unknown as Env).HY2_CATALOG_EMAILS;
    try {
      (env as unknown as Env).HY2_CATALOG_EMAILS = allowed.email;
      // A gray-listed account on a client that never declared hy2 (0.0.72).
      const oldClient = await api('exit-catalog', {
        headers: { authorization: `Bearer ${allowed.accessToken}` },
      });
      expect(oldClient.status).toBe(200);
      expect((await oldClient.json() as any).yaml).not.toContain(' · hy2');

      const allowedFetched = await api('exit-catalog', {
        headers: { authorization: `Bearer ${allowed.accessToken}`, 'X-Tono-Accept': 'hy2' },
      });
      expect(allowedFetched.status).toBe(200);
      const allowedBody = await allowedFetched.json() as any;
      expect(allowedBody.yaml).toContain('type: hysteria2');
      expect(allowedBody.yaml).toContain('Tokyo · Sakura · hy2');
      expect(allowedBody.yaml).not.toContain('TONO_CLIENT_UUID');

      const notListed = await api('exit-catalog', {
        headers: { authorization: `Bearer ${hidden.accessToken}`, 'X-Tono-Accept': 'hy2' },
      });
      expect((await notListed.json() as any).yaml).not.toContain('hysteria2');
    } finally {
      (env as unknown as Env).HY2_CATALOG_EMAILS = previous;
    }

    const headerAdmit = await api('exit-catalog', {
      headers: {
        authorization: `Bearer ${hidden.accessToken}`,
        'X-Tono-Accept': 'hy2',
      },
    });
    expect((await headerAdmit.json() as any).yaml).toContain('type: hysteria2');

    const adminFetched = await admin('exit-catalog', undefined, 'GET');
    expect((await adminFetched.json() as any).yaml).toContain('type: hysteria2');
  });

  it('audits a home exit SOCKS5 password change without recording the password', async () => {
    const created = await admin('home-exits', {
      proxyName: 'Audit Socks Home',
      displayName: '审计 Socks',
      kind: 'socks5',
      socks5Host: '203.0.113.60',
      socks5Port: 11080,
      socks5Username: 'resi-audit',
      socks5Password: 'old-upstream-secret',
    });
    expect(created.status).toBe(201);
    const homeId = ((await created.json()) as any).homeExit.id;
    const patched = await admin(`home-exits/${homeId}`, { socks5Password: 'new-upstream-secret' }, 'PATCH');
    expect(patched.status).toBe(200);
    const audit = await env.DB.prepare(
      "SELECT * FROM ops_audit WHERE action = 'home.update' AND target_id = ?",
    ).bind(homeId).first<any>();
    expect(audit).toMatchObject({ actor_type: 'token_admin', target_type: 'home_exit' });
    expect(String(audit.summary)).toContain('socks5Password');
    expect(String(audit.summary)).not.toContain('upstream-secret');
  });

  it('rejects a catalog name a YAML parser would read differently from the home-exit filter', async () => {
    const catalogWithHomeName = (nameLine: string) => `proxies:
  - name: Shared JP
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
${nameLine}
    type: vless
    server: 198.51.100.20
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    for (const nameLine of [
      '  - name: "Home\\x20A"',
      '  - name: "\\u5BB6\\u5BBD A"',
      '  - name: Home A # was {name: Shared}',
      '  - name: >-\n      Home A',
      '  - name: Café A',
    ]) {
      const put = await admin('exit-catalog', { yaml: catalogWithHomeName(nameLine), expectedRevision: 0 }, 'PUT');
      expect(put.status).toBe(400);
      expect((await put.json() as any).error.code).toBe('INVALID_CATALOG');
    }

    expect((await admin(
      'exit-catalog',
      { yaml: catalogWithHomeName('  - name: Home A'), expectedRevision: 0 },
      'PUT',
    )).status).toBe(200);
    const home = await admin('home-exits', { proxyName: 'Home A', displayName: 'Home A' });
    expect(home.status).toBe(201);
    await acknowledgeServedExits('Shared JP');
    const owner = await createAccount('plain-name-owner');
    const other = await createAccount('plain-name-other');
    expect((await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: ((await home.json()) as any).homeExit.id },
      'PUT',
    )).status).toBe(201);
    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(otherCatalog.status).toBe(200);
    expect((await otherCatalog.json() as any).yaml).not.toContain('198.51.100.20');
  });

  it('binds one home exit per user and filters that proxy from other catalogs', async () => {
    const yaml = `proxies:
  - name: "Shared JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "Home Residential A"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "Home Residential B"
    type: vless
    server: 9.9.9.9
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const homeA = await admin('home-exits', {
      proxyName: 'Home Residential A',
      displayName: '家庭 A',
      egressIpv4: '203.0.113.10',
    });
    expect(homeA.status).toBe(201);
    const homeABody = await homeA.json() as any;
    expect(homeABody.homeExit.proxyName).toBe('Home Residential A');
    expect(homeABody.homeExit.egressIpv4).toBe('203.0.113.10');

    const homeB = await admin('home-exits', {
      proxyName: 'Home Residential B',
      displayName: '家庭 B',
      egressIpv4: '203.0.113.20',
    });
    expect(homeB.status).toBe(201);
    const homeBId = ((await homeB.json()) as any).homeExit.id;

    const conflict = await admin('home-exits', {
      proxyName: 'Home Residential A',
      displayName: 'dup',
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as any).error.code).toBe('HOME_EXIT_CONFLICT');

    await acknowledgeServedExits('Shared JP');
    const owner = await createAccount('home-owner');
    const other = await createAccount('home-other');

    const bound = await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeABody.homeExit.id },
      'PUT',
    );
    expect(bound.status).toBe(201);
    expect((await bound.json() as any).binding).toMatchObject({
      userId: owner.user.id,
      proxyName: 'Home Residential A',
      egressIpv4: '203.0.113.10',
    });

    const rebound = await admin(
      `users/${owner.user.id}/home-binding`,
      { proxyName: 'Home Residential B' },
      'PUT',
    );
    expect(rebound.status).toBe(200);
    const reboundBody = await rebound.json() as any;
    expect(reboundBody.binding.proxyName).toBe('Home Residential B');
    expect(reboundBody.binding.homeExitId).toBe(homeBId);

    // Re-bind owner to A for the filter assertion below.
    expect((await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeABody.homeExit.id },
      'PUT',
    )).status).toBe(200);

    const ownerCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(ownerCatalog.status).toBe(200);
    const ownerBody = await ownerCatalog.json() as any;
    expect(ownerBody.yaml).toContain('Shared JP');
    expect(ownerBody.yaml).toContain('Home Residential A');
    expect(ownerBody.yaml).not.toContain('Home Residential B');
    const ownerIssued = /uuid: ([0-9a-f-]{36})/.exec(ownerBody.yaml)?.[1];
    expect(ownerIssued).toBeTruthy();
    expect(ownerBody.yaml).not.toContain('TONO_CLIENT_UUID');
    expect(ownerBody.sha256).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(otherCatalog.status).toBe(200);
    const otherBody = await otherCatalog.json() as any;
    expect(otherBody.yaml).toContain('Shared JP');
    expect(otherBody.yaml).not.toContain('Home Residential A');
    expect(otherBody.yaml).not.toContain('Home Residential B');
    const otherIssued = /uuid: ([0-9a-f-]{36})/.exec(otherBody.yaml)?.[1];
    expect(otherIssued).toBeTruthy();
    expect(otherIssued).not.toBe(ownerIssued);

    // Admin catalog remains the full authority.
    const adminCatalog = await admin('exit-catalog', undefined, 'GET');
    expect(adminCatalog.status).toBe(200);
    const adminBody = await adminCatalog.json() as any;
    expect(adminBody.yaml).toContain('Home Residential A');
    expect(adminBody.yaml).toContain('Home Residential B');
    expect(adminBody.yaml).toContain('Shared JP');
    expect(adminBody.yaml).toContain('{{TONO_CLIENT_UUID}}');

    const listed = await admin('home-bindings', undefined, 'GET');
    expect(listed.status).toBe(200);
    expect((await listed.json() as any).bindings).toEqual([
      expect.objectContaining({
        userId: owner.user.id,
        proxyName: 'Home Residential A',
      }),
    ]);

    const inUse = await admin(`home-exits/${homeABody.homeExit.id}`, undefined, 'DELETE');
    expect(inUse.status).toBe(409);
    expect((await inUse.json() as any).error.code).toBe('HOME_EXIT_IN_USE');

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    const unboundCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const unboundBody = await unboundCatalog.json() as any;
    expect(unboundBody.yaml).toContain('Shared JP');
    expect(unboundBody.yaml).not.toContain('Home Residential A');
    expect(unboundBody.yaml).not.toContain('Home Residential B');

    expect((await admin(`home-exits/${homeABody.homeExit.id}`, undefined, 'DELETE')).status).toBe(204);
    expect((await admin(`home-exits/${homeBId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('refuses renaming a bound catalog home to a fleet-retired node name', async () => {
    const yaml = `proxies:
  - name: "Home Rename A"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    const home = await admin('home-exits', { proxyName: 'Home Rename A', displayName: '家庭 rename' });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id;
    const owner = await createAccount('home-rename-owner');
    expect((await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status).toBe(201);
    await env.DB.prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
       VALUES('profile-retired-rename', 'Retired Fleet Node', 'retired', unixepoch(), unixepoch())`,
    ).run();

    const renamed = await admin(`home-exits/${homeId}`, { proxyName: 'Retired Fleet Node' }, 'PATCH');
    expect(renamed.status).toBe(409);
    expect((await renamed.json() as any).error.code).toBe('HOME_EXIT_INACTIVE');
    const row = await env.DB.prepare('SELECT proxy_name FROM home_exits WHERE id = ?').bind(homeId).first<any>();
    expect(row.proxy_name).toBe('Home Rename A');
  });

  it('keeps a retired home exit and its hy2 twin out of other accounts\' catalogs', async () => {
    const yaml = `proxies:
  - name: "Shared JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "Home Residential A"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "Home Residential A · hy2"
    type: hysteria2
    server: 8.8.8.8
    port: 443
    password: {{TONO_CLIENT_UUID}}
    sni: www.microsoft.com
    fingerprint: e3aa4a745aa90539ab1a493d940eeba7b4305b7516ab84167e46c98ad9fed3db
  - name: "Home Residential B"
    type: vless
    server: 9.9.9.9
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "Home Residential B · hy2"
    type: hysteria2
    server: 9.9.9.9
    port: 443
    password: {{TONO_CLIENT_UUID}}
    sni: www.microsoft.com
    fingerprint: e3aa4a745aa90539ab1a493d940eeba7b4305b7516ab84167e46c98ad9fed3db
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    const home = await admin('home-exits', { proxyName: 'Home Residential A', displayName: '家庭 A' });
    expect(home.status).toBe(201);
    expect((await admin('home-exits', { proxyName: 'Home Residential B', displayName: '家庭 B' })).status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id;
    await acknowledgeServedExits('Shared JP');
    const owner = await createAccount('retired-home-owner');
    const other = await createAccount('retired-home-other');
    expect((await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status).toBe(201);
    const catalogFor = async (token: string) => ((await (await api('exit-catalog', {
      headers: { authorization: `Bearer ${token}`, 'X-Tono-Accept': 'hy2' },
    })).json()) as any).yaml as string;

    expect(await catalogFor(owner.accessToken)).toContain('Home Residential A · hy2');
    expect(await catalogFor(other.accessToken)).not.toContain('Home Residential A');
    expect(await catalogFor(other.accessToken)).not.toContain('Home Residential B · hy2');

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    expect((await admin(`home-exits/${homeId}`, { status: 'retired' }, 'PATCH')).status).toBe(200);
    for (const viewer of [owner, other]) {
      const served = await catalogFor(viewer.accessToken);
      expect(served).toContain('Shared JP');
      expect(served).not.toContain('Home Residential A');
    }
  });

  it('publishes routing metadata to bound users and validates defaultProxyName', async () => {
    const yaml = `proxies:
  - name: "Shared VPS JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "Home Residential Route"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const home = await admin('home-exits', {
      proxyName: 'Home Residential Route',
      displayName: '家庭路由',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id;

    await acknowledgeServedExits('Shared VPS JP');
    const owner = await createAccount('routing-owner');
    const other = await createAccount('routing-other');

    // defaultProxyName must not collide with any registered home exit proxyName.
    const invalid = await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeId, defaultProxyName: 'Home Residential Route' },
      'PUT',
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json() as any).error.code).toBe('INVALID_DEFAULT_PROXY');

    const bound = await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeId, defaultProxyName: 'Shared VPS JP' },
      'PUT',
    );
    expect(bound.status).toBe(201);
    expect((await bound.json() as any).binding).toMatchObject({
      proxyName: 'Home Residential Route',
      defaultProxyName: 'Shared VPS JP',
    });

    const ownerCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(ownerCatalog.status).toBe(200);
    expect((await ownerCatalog.json() as any).routing).toEqual({
      homeProxy: 'Home Residential Route',
      defaultProxy: 'Shared VPS JP',
    });

    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(otherCatalog.status).toBe(200);
    expect((await otherCatalog.json() as any)).not.toHaveProperty('routing');

    const dashAfterBind = await operations('dashboard');
    expect((await dashAfterBind.json() as any).dashboard.inventory.usersWithoutHome).toBe(1);

    // The admin full catalog never carries routing metadata.
    const adminCatalog = await admin('exit-catalog', undefined, 'GET');
    expect(adminCatalog.status).toBe(200);
    expect((await adminCatalog.json() as any)).not.toHaveProperty('routing');

    // Re-binding without defaultProxyName leaves routing with only homeProxy.
    const rebound = await admin(
      `users/${owner.user.id}/home-binding`,
      { homeExitId: homeId },
      'PUT',
    );
    expect(rebound.status).toBe(200);
    expect((await rebound.json() as any).binding.defaultProxyName).toBeUndefined();
    const noDefault = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await noDefault.json() as any).routing).toEqual({ homeProxy: 'Home Residential Route' });

    // The ops product route accepts and persists defaultProxyName as well.
    const accessHeaders = {
      'content-type': 'application/json',
      'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
    };
    const opsBound = await api(`ops/users/${owner.user.id}/home-binding`, {
      method: 'PUT',
      headers: accessHeaders,
      body: JSON.stringify({ homeExitId: homeId, defaultProxyName: 'Shared VPS JP' }),
    });
    expect(opsBound.status).toBe(200);
    expect((await opsBound.json() as any).binding.defaultProxyName).toBe('Shared VPS JP');
    const opsCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect((await opsCatalog.json() as any).routing).toEqual({
      homeProxy: 'Home Residential Route',
      defaultProxy: 'Shared VPS JP',
    });

    const opsInvalid = await api(`ops/users/${owner.user.id}/home-binding`, {
      method: 'PUT',
      headers: accessHeaders,
      body: JSON.stringify({ homeExitId: homeId, defaultProxyName: 'Home Residential Route' }),
    });
    expect(opsInvalid.status).toBe(400);
    expect((await opsInvalid.json() as any).error.code).toBe('INVALID_DEFAULT_PROXY');

    // The ops users listing surfaces defaultProxyName for the admin console.
    const opsUsers = await operations('users');
    expect(opsUsers.status).toBe(200);
    const opsListed = (await opsUsers.json() as any).users
      .find((row: any) => row.id === owner.user.id);
    expect(opsListed.homeBinding).toMatchObject({
      homeExitId: homeId,
      proxyName: 'Home Residential Route',
      defaultProxyName: 'Shared VPS JP',
    });

    // The ops console reads the full plaintext catalog without routing metadata.
    const opsCatalogFull = await operations('exit-catalog');
    expect(opsCatalogFull.status).toBe(200);
    const opsCatalogBody = await opsCatalogFull.json() as any;
    expect(opsCatalogBody.yaml).toContain('Shared VPS JP');
    expect(opsCatalogBody.yaml).toContain('Home Residential Route');
    expect(opsCatalogBody).not.toHaveProperty('routing');
  });

  it('advances the catalog revision on every home-exit/binding write so clients re-sync', async () => {
    const yaml = `proxies:
  - name: "Shared VPS"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "Home Route"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);
    const revision = async () =>
      Number(((await (await admin('exit-catalog', undefined, 'GET')).json()) as any).revision);
    const base = await revision();

    const home = await admin('home-exits', { proxyName: 'Home Route', displayName: '家宽' });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id;
    expect(await revision()).toBe(base + 1);

    const owner = await createAccount('revision-owner');
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(201);
    expect(await revision()).toBe(base + 2);

    // Re-binding the same exit is still a served-catalog event (routing re-apply).
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(200);
    expect(await revision()).toBe(base + 3);

    expect(
      (await admin(`home-exits/${homeId}`, { notes: 'retire note' }, 'PATCH')).status,
    ).toBe(200);
    expect(await revision()).toBe(base + 4);

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    expect(await revision()).toBe(base + 5);

    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
    expect(await revision()).toBe(base + 6);
  });

  it('validates socks5 home-exit fields on both admin and ops write paths', async () => {
    const base = { proxyName: 'Home Socks A', displayName: '家宽 Socks A' };
    const creds = {
      kind: 'socks5',
      socks5Host: '203.0.113.50',
      socks5Port: 11080,
      socks5Username: 'resi-user',
      socks5Password: 'resi-secret',
    };

    // Missing any of the four upstream fields is a 400.
    for (const omit of ['socks5Host', 'socks5Port', 'socks5Username', 'socks5Password'] as const) {
      const body: Record<string, unknown> = { ...base, ...creds };
      delete body[omit];
      expect((await admin('home-exits', body)).status).toBe(400);
      expect((await api('ops/home-exits', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        },
        body: JSON.stringify(body),
      })).status).toBe(400);
    }
    // Out-of-range / non-integer ports are a 400.
    for (const port of [0, 65536, 1.5, '11080']) {
      expect((await admin('home-exits', { ...base, ...creds, socks5Port: port })).status).toBe(400);
    }
    // Malformed hosts are a 400; IPv4 literals and hostnames are accepted.
    for (const host of ['', 'not a host', '10.0.0.1 x', 'http://x', '-bad-.com', '256.1.1.1']) {
      expect((await admin('home-exits', { ...base, ...creds, socks5Host: host })).status).toBe(400);
    }
    // A catalog-kind exit must not carry socks5 fields.
    expect((await admin('home-exits', { ...base, socks5Host: '203.0.113.50' })).status).toBe(400);
    expect((await admin('home-exits', { ...base, kind: 'weird' })).status).toBe(400);

    // Happy path: both write paths accept a complete socks5 exit, and the
    // response shows kind/host/port but never the credentials.
    const created = await admin('home-exits', { ...base, ...creds });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as any;
    expect(createdBody.homeExit.kind).toBe('socks5');
    expect(createdBody.homeExit.socks5Host).toBe('203.0.113.50');
    expect(createdBody.homeExit.socks5Port).toBe(11080);
    expect(createdBody.homeExit).not.toHaveProperty('socks5Username');
    expect(createdBody.homeExit).not.toHaveProperty('socks5Password');
    const homeId = createdBody.homeExit.id as string;

    // PATCH keeps stored fields when omitted and validates merged values.
    expect((await admin(`home-exits/${homeId}`, { socks5Port: 0 }, 'PATCH')).status).toBe(400);
    expect((await admin(`home-exits/${homeId}`, { socks5Host: 'bad host' }, 'PATCH')).status).toBe(400);
    const patched = await admin(`home-exits/${homeId}`, { socks5Port: 11081 }, 'PATCH');
    expect(patched.status).toBe(200);
    expect((await patched.json() as any).homeExit.socks5Port).toBe(11081);
    // Switching back to catalog wipes the upstream fields.
    const toCatalog = await admin(`home-exits/${homeId}`, { kind: 'catalog' }, 'PATCH');
    expect(toCatalog.status).toBe(200);
    const catalogBody = await toCatalog.json() as any;
    expect(catalogBody.homeExit.kind).toBe('catalog');
    expect(catalogBody.homeExit).not.toHaveProperty('socks5Host');
    // And switching to socks5 without the full field set fails.
    expect((await admin(`home-exits/${homeId}`, { kind: 'socks5' }, 'PATCH')).status).toBe(400);

    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('serves homeSocks5 credentials only inside the bound user catalog routing', async () => {
    const yaml = `proxies:
  - name: "Shared VPS JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const home = await admin('home-exits', {
      proxyName: 'Home Socks Route',
      displayName: '家宽 Socks',
      kind: 'socks5',
      socks5Host: 'resi-gateway.example.com',
      socks5Port: 11080,
      socks5Username: 'resi-user',
      socks5Password: 'resi-secret',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id as string;

    await acknowledgeServedExits('Shared VPS JP');
    const owner = await createAccount('socks5-owner');
    const other = await createAccount('socks5-other');
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(201);

    const ownerBody = await (await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })).json() as any;
    expect(ownerBody.routing).toEqual({
      homeSocks5: {
        host: 'resi-gateway.example.com',
        port: 11080,
        username: 'resi-user',
        password: 'resi-secret',
      },
    });
    // A socks5-kind exit names no catalog node, so nothing is filtered out.
    expect(ownerBody.yaml).toContain('Shared VPS JP');

    // An assigned home becoming unavailable is not an authorized unbind.
    await env.DB.prepare("UPDATE home_exits SET status = 'disabled' WHERE id = ?").bind(homeId).run();
    const unavailableHome = await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(unavailableHome.status).toBe(503);
    expect(await unavailableHome.text()).not.toContain('resi-secret');
    await env.DB.prepare("UPDATE home_exits SET status = 'active' WHERE id = ?").bind(homeId).run();


    // Unbound users get no routing and no credential material at all.
    const otherCatalog = await api('exit-catalog', {
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    const otherText = await otherCatalog.text();
    expect(otherText).not.toContain('homeSocks5');
    expect(otherText).not.toContain('resi-user');
    expect(otherText).not.toContain('resi-secret');

    // No GET endpoint may echo the credentials: admin/ops exit listings,
    // binding views, and the ops user list all show at most host:port.
    const adminList = await admin('home-exits', undefined, 'GET');
    expect((await adminList.clone().text()).includes('resi-secret')).toBe(false);
    const adminRows = (await adminList.json() as any).homeExits;
    expect(adminRows).toEqual([
      expect.objectContaining({ kind: 'socks5', socks5Host: 'resi-gateway.example.com', socks5Port: 11080 }),
    ]);
    expect(adminRows[0]).not.toHaveProperty('socks5Username');
    expect(adminRows[0]).not.toHaveProperty('socks5Password');

    const opsList = await operations('home-exits');
    expect(await opsList.text()).not.toContain('resi-secret');

    const bindings = await admin('home-bindings', undefined, 'GET');
    expect((await bindings.clone().text()).includes('resi-secret')).toBe(false);
    expect((await bindings.json() as any).bindings).toEqual([
      expect.objectContaining({ userId: owner.user.id, kind: 'socks5', socks5Host: 'resi-gateway.example.com' }),
    ]);

    const binding = await admin(`users/${owner.user.id}/home-binding`, undefined, 'GET');
    expect((await binding.clone().text()).includes('resi-secret')).toBe(false);
    expect((await binding.json() as any).binding).toEqual(
      expect.objectContaining({ kind: 'socks5', socks5Host: 'resi-gateway.example.com', socks5Port: 11080 }),
    );

    const opsUsers = await operations('users');
    const opsUsersText = await opsUsers.text();
    expect(opsUsersText).not.toContain('resi-secret');
    expect(opsUsersText).not.toContain('resi-user');

    // Ops/admin plaintext catalogs carry no routing (and no credentials).
    const opsCatalog = await operations('exit-catalog');
    const opsCatalogBody = await opsCatalog.json() as any;
    expect(opsCatalogBody).not.toHaveProperty('routing');

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('refuses to hand an unbound user\'s socks5 credential to another user until it is rotated', async () => {
    const home = await admin('home-exits', {
      proxyName: 'Home Socks Rotation',
      displayName: '家宽 Rotation',
      kind: 'socks5',
      socks5Host: '203.0.113.60',
      socks5Port: 11090,
      socks5Username: 'resi-rot',
      socks5Password: 'first-secret',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id as string;
    const first = await createAccount('socks5-first-holder');
    const next = await createAccount('socks5-next-holder');
    const catalogText = async (token: string) => (await api('exit-catalog', {
      headers: { authorization: `Bearer ${token}` },
    })).text();

    expect((await admin(`users/${first.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status).toBe(201);
    expect(await catalogText(first.accessToken)).toContain('first-secret');
    expect((await admin(`users/${first.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    expect(await catalogText(first.accessToken)).not.toContain('first-secret');

    // The first holder's cached copy still works upstream, so the same
    // credential must not become the next user's line.
    const reused = await admin(`users/${next.user.id}/home-binding`, { homeExitId: homeId }, 'PUT');
    expect(reused.status).toBe(409);
    expect((await reused.json() as any).error.code).toBe('SOCKS5_ROTATION_REQUIRED');
    const listed = (await (await admin('home-exits', undefined, 'GET')).json() as any).homeExits;
    expect(listed.find((row: any) => row.id === homeId).socks5RotationRequired).toBe(true);

    expect((await admin(`home-exits/${homeId}`, { socks5Password: 'second-secret' }, 'PATCH')).status).toBe(200);
    expect((await admin(`users/${next.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status).toBe(201);
    const nextCatalog = await catalogText(next.accessToken);
    expect(nextCatalog).toContain('second-secret');
    expect(nextCatalog).not.toContain('first-secret');
  });

  it('refuses a catalog home exit whose proxyName ends with the hy2 suffix', async () => {
    const suffixed = await admin('home-exits', { proxyName: 'Home Suffix · hy2', displayName: '家宽 Suffix' });
    expect(suffixed.status).toBe(400);
    expect((await suffixed.json() as any).error.code).toBe('VALIDATION_ERROR');
    const plain = await admin('home-exits', { proxyName: 'Home Suffix', displayName: '家宽 Suffix' });
    expect(plain.status).toBe(201);
    const homeId = ((await plain.json()) as any).homeExit.id as string;
    expect((await admin(`home-exits/${homeId}`, { proxyName: 'Home Suffix · hy2' }, 'PATCH')).status).toBe(400);
    const line = await api('ops/home-lines', {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL), 'content-type': 'application/json' },
      body: JSON.stringify({ proxyName: 'Home Line · hy2', displayName: '家宽 Line' }),
    });
    expect(line.status).toBe(400);
  });

  it('refuses to bind a stored catalog home exit whose proxyName ends with the hy2 suffix', async () => {
    // A row stored before create and PATCH refused the suffix.
    const t = Math.floor(Date.now() / 1_000);
    await env.DB.prepare(
      `INSERT INTO home_exits(id, proxy_name, display_name, kind, status, created_at, updated_at)
       VALUES('h-stored-hy2', 'Home Stored · hy2', '家宽 Stored', 'catalog', 'active', ?, ?)`,
    ).bind(t, t).run();
    const account = await createAccount('stored-hy2-name');
    for (const target of [{ homeExitId: 'h-stored-hy2' }, { proxyName: 'Home Stored · hy2' }]) {
      const bound = await admin(`users/${account.user.id}/home-binding`, target, 'PUT');
      expect(bound.status).toBe(400);
      expect((await bound.json() as any).error.code).toBe('VALIDATION_ERROR');
    }
    const onboarded = await api('ops/users/onboard', {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL), 'content-type': 'application/json' },
      body: JSON.stringify({ email: account.email, homeExitId: 'h-stored-hy2' }),
    });
    expect(onboarded.status).toBe(400);
    expect(await env.DB.prepare('SELECT 1 FROM user_home_bindings WHERE user_id = ?').bind(account.user.id).first())
      .toBeNull();
  });

  it('moves routingSha256 for a routing-only rotation that leaves revision and yaml untouched', async () => {
    const yaml = `proxies:
  - name: "Shared VPS JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    // A socks5 home exit names no catalog node, so its rotations never touch
    // the served proxies YAML — the routing document is the only thing moving.
    const home = await admin('home-exits', {
      proxyName: 'Home Socks Rotation',
      displayName: '家宽轮换',
      kind: 'socks5',
      socks5Host: 'resi-gateway.example.com',
      socks5Port: 11080,
      socks5Username: 'resi-user',
      socks5Password: 'resi-secret',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id as string;

    await acknowledgeServedExits('Shared VPS JP');
    const owner = await createAccount('routing-digest-owner');
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(201);

    const fetchOwner = async () => (await (await api('exit-catalog', {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    })).json()) as any;

    const bound = await fetchOwner();
    expect(bound.routingSha256).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Refetching without a change is stable across all three components.
    const refetched = await fetchOwner();
    expect(refetched.revision).toBe(bound.revision);
    expect(refetched.sha256).toBe(bound.sha256);
    expect(refetched.routingSha256).toBe(bound.routingSha256);

    // Rotate the upstream credential in place. The admin PATCH also advances
    // the fleet revision as belt and braces; writing the row directly is the
    // server state a client has to be able to detect on its own.
    await env.DB.prepare('UPDATE home_exits SET socks5_password = ? WHERE id = ?')
      .bind('resi-rotated', homeId).run();

    const rotated = await fetchOwner();
    expect(rotated.revision).toBe(bound.revision);
    expect(rotated.sha256).toBe(bound.sha256);
    expect(rotated.routingSha256).not.toBe(bound.routingSha256);
    expect(rotated.routing.homeSocks5.password).toBe('resi-rotated');

    // A default-proxy change is a routing-only change too.
    await env.DB.prepare('UPDATE user_home_bindings SET default_proxy_name = ? WHERE user_id = ?')
      .bind('Shared VPS JP', owner.user.id).run();
    const defaulted = await fetchOwner();
    expect(defaulted.revision).toBe(bound.revision);
    expect(defaulted.sha256).toBe(bound.sha256);
    expect(defaulted.routingSha256).not.toBe(rotated.routingSha256);

    // Unbinding moves the digest rather than dropping the field, so a client
    // that lost its routing sees the key move instead of going blind.
    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    const unbound = await fetchOwner();
    expect(unbound).not.toHaveProperty('routing');
    expect(unbound.routingSha256).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(unbound.routingSha256).not.toBe(defaulted.routingSha256);

    // The ops/admin plaintext catalogs carry no routing, so no routing digest.
    expect((await (await operations('exit-catalog')).json() as any))
      .not.toHaveProperty('routingSha256');
    expect((await (await admin('exit-catalog', undefined, 'GET')).json() as any))
      .not.toHaveProperty('routingSha256');

    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('serves two accounts different yaml digests at one revision without calling it an error', async () => {
    const yaml = `proxies:
  - name: "Shared VPS JP"
    type: vless
    server: 1.1.1.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
  - name: "Home Residential Split"
    type: vless
    server: 8.8.8.8
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.microsoft.com
    reality-opts:
      public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
      short-id: abcd1234
`;
    expect((await admin('exit-catalog', { yaml, expectedRevision: 0 }, 'PUT')).status).toBe(200);

    const home = await admin('home-exits', {
      proxyName: 'Home Residential Split',
      displayName: '家庭分流',
    });
    expect(home.status).toBe(201);
    const homeId = ((await home.json()) as any).homeExit.id as string;

    await acknowledgeServedExits('Shared VPS JP');
    const owner = await createAccount('digest-split-owner');
    const other = await createAccount('digest-split-other');
    expect(
      (await admin(`users/${owner.user.id}/home-binding`, { homeExitId: homeId }, 'PUT')).status,
    ).toBe(201);

    const fetchFor = async (accessToken: string) => {
      const response = await api('exit-catalog', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(response.status).toBe(200);
      return (await response.json()) as any;
    };

    const ownerBody = await fetchFor(owner.accessToken);
    const otherBody = await fetchFor(other.accessToken);

    // Same fleet revision, different bodies: the identity substitution and the
    // home-exit filter are both per account. Different digests at one revision
    // are the normal shape of this endpoint, not tampering.
    expect(otherBody.revision).toBe(ownerBody.revision);
    expect(otherBody.sha256).not.toBe(ownerBody.sha256);
    expect(ownerBody.yaml).toContain('Home Residential Split');
    expect(otherBody.yaml).not.toContain('Home Residential Split');
    expect(otherBody.routingSha256).not.toBe(ownerBody.routingSha256);

    // Each account's own digest is stable on a refetch at the same revision.
    const ownerAgain = await fetchFor(owner.accessToken);
    expect(ownerAgain.sha256).toBe(ownerBody.sha256);
    expect(ownerAgain.routingSha256).toBe(ownerBody.routingSha256);
    const otherAgain = await fetchFor(other.accessToken);
    expect(otherAgain.sha256).toBe(otherBody.sha256);
    expect(otherAgain.routingSha256).toBe(otherBody.routingSha256);

    expect((await admin(`users/${owner.user.id}/home-binding`, undefined, 'DELETE')).status).toBe(204);
    expect((await admin(`home-exits/${homeId}`, undefined, 'DELETE')).status).toBe(204);
  });
});
