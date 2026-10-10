import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/crypto';
import worker, { type Env } from '../src/index';
import {
  ADMIN_TOKEN,
  api,
  json,
  admin,
  createAccount,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('validates, encrypts, versions, and serves the managed traffic policy', async () => {
    expect((await api('traffic-policy')).status).toBe(401);
    const empty = await admin('traffic-policy', undefined, 'GET');
    expect(empty.status).toBe(200);
    expect((await empty.json() as any).revision).toBe(0);

    const policy = {
      mediaEndpoints: [{ ports: [8000, 443], address: '43.146.27.17' }],
      domains: [
        { ports: [443, 80], host: 'wx.qlogo.cn' },
        { host: 'res.wx.qq.com', ports: [443] },
      ],
      version: 1,
    };
    // Media endpoints need a signature (#318), so every write of this policy
    // signs the bytes the endpoint says it will serve.
    const signedWrite = async (value: unknown, expectedRevision?: number) => {
      const preview = await admin('traffic-policy', { policy: value, dryRun: true }, 'PUT');
      const signature = await signPolicy((await preview.json() as any).json);
      return admin('traffic-policy', {
        policy: value,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        signature,
      }, 'PUT');
    };
    const blindWrite = await signedWrite(policy);
    expect(blindWrite.status).toBe(400);
    expect((await blindWrite.json() as any).error.code).toBe('VALIDATION_ERROR');

    const created = await signedWrite(policy, 0);
    expect(created.status).toBe(200);
    const createdBody = await created.json() as any;
    expect(JSON.parse(createdBody.json)).toEqual({
      version: 1,
      domains: [
        { host: 'res.wx.qq.com', ports: [443] },
        { host: 'wx.qlogo.cn', ports: [80, 443] },
      ],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443, 8000] }],
    });
    const publishAudit = await env.DB.prepare(
      `SELECT actor_email, action, target_type, target_id, summary
       FROM ops_audit WHERE action = 'traffic-policy.publish'`,
    ).first<any>();
    expect(publishAudit).toMatchObject({
      actor_email: 'token-admin',
      action: 'traffic-policy.publish',
      target_type: 'managed_traffic_policy',
      target_id: '1',
    });
    expect(String(publishAudit.summary)).toMatch(/^published r0 → r1 \([A-Za-z0-9_-]{16}\)$/);
    const stored = await env.DB.prepare(
      'SELECT ciphertext, nonce, content_sha256 FROM managed_traffic_policy WHERE singleton_id = 1',
    ).first<any>();
    expect(stored.ciphertext).not.toContain('res.wx.qq.com');
    expect(stored.ciphertext).not.toContain('43.146.27.17');
    expect(stored.nonce).not.toBe('');
    expect(createdBody.sha256).toBe(stored.content_sha256);
    expect(await (await admin('traffic-policy', undefined, 'GET')).json()).toEqual(createdBody);

    const account = await createAccount('managed-traffic-policy');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(await fetched.json()).toEqual(createdBody);
    const conflict = await signedWrite(policy, 0);
    expect(conflict.status).toBe(409);

    const webPolicy = {
      ...policy,
      version: 2,
      webDomains: [
        { host: 'www.bilibili.com', ports: [443] },
        { host: 'ykimg.alicdn.com', ports: [443] },
      ],
    };
    const updated = await signedWrite(webPolicy, 1);
    expect(updated.status).toBe(200);
    expect(JSON.parse((await updated.json() as any).json)).toEqual({
      version: 2,
      domains: [
        { host: 'res.wx.qq.com', ports: [443] },
        { host: 'wx.qlogo.cn', ports: [80, 443] },
      ],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443, 8000] }],
      webDomains: [
        { host: 'www.bilibili.com', ports: [443] },
        { host: 'ykimg.alicdn.com', ports: [443] },
      ],
    });

    const nativeWeChatPolicy = {
      ...webPolicy,
      version: 4,
      directSuffixes: [{ host: 'edu.cn', ports: [443, 80] }],
      tcpEndpoints: [
        { address: '49.51.67.253', ports: [443, 80] },
      ],
    };
    const nativeUpdated = await signedWrite(nativeWeChatPolicy, 2);
    expect(nativeUpdated.status).toBe(200);
    expect(JSON.parse((await nativeUpdated.json() as any).json)).toEqual({
      version: 4,
      domains: [
        { host: 'res.wx.qq.com', ports: [443] },
        { host: 'wx.qlogo.cn', ports: [80, 443] },
      ],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443, 8000] }],
      webDomains: [
        { host: 'www.bilibili.com', ports: [443] },
        { host: 'ykimg.alicdn.com', ports: [443] },
      ],
      directSuffixes: [{ host: 'edu.cn', ports: [80, 443] }],
      tcpEndpoints: [{ address: '49.51.67.253', ports: [80, 443] }],
    });
    const fetchedV4 = await admin('traffic-policy', undefined, 'GET');
    expect(fetchedV4.status).toBe(200);
    expect(JSON.parse((await fetchedV4.json() as { json: string }).json)).toEqual({
      version: 4,
      domains: [
        { host: 'res.wx.qq.com', ports: [443] },
        { host: 'wx.qlogo.cn', ports: [80, 443] },
      ],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443, 8000] }],
      webDomains: [
        { host: 'www.bilibili.com', ports: [443] },
        { host: 'ykimg.alicdn.com', ports: [443] },
      ],
      directSuffixes: [{ host: 'edu.cn', ports: [80, 443] }],
      tcpEndpoints: [{ address: '49.51.67.253', ports: [80, 443] }],
    });

    const invalidPolicies = [
      { ...policy, version: 3 },
      { ...policy, version: 2 },
      { ...policy, domains: [{ host: '*.qq.com', ports: [443] }] },
      { ...policy, domains: [{ host: 'api.anthropic.com', ports: [443] }] },
      { ...policy, domains: [{ host: 'res.wx.qq.com', ports: [22] }] },
      { ...policy, mediaEndpoints: [{ address: '10.0.0.1', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '192.0.0.9', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '192.0.2.1', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '192.88.99.1', ports: [443] }] },
      { ...policy, tcpEndpoints: [{ address: '192.0.0.9', ports: [443] }] },
      { ...policy, tcpEndpoints: [{ address: '192.0.2.1', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '43.146.27.0/24', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '43.146.27.999', ports: [443] }] },
      { ...policy, mediaEndpoints: [{ address: '43.146.27.17', ports: [80] }] },
      { ...webPolicy, webDomains: [{ host: '*.bilibili.com', ports: [443] }] },
      { ...webPolicy, webDomains: [{ host: 'api.anthropic.com', ports: [443] }] },
      { ...webPolicy, webDomains: [{ host: 'www.bilibili.com', ports: [80] }] },
      {
        ...webPolicy,
        domains: [{ host: 'v.qq.com', ports: [443] }],
        webDomains: [{ host: 'v.qq.com', ports: [443] }],
      },
      // v3: the suffix must be an exact allowlist entry, never a host under
      // it, never protected, and ports must stay within [80, 443].
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'example.com', ports: [443] }] },
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'www.baidu.com', ports: [443] }] },
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'anthropic.com', ports: [443] }] },
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'baidu.com', ports: [8080] }] },
      { ...nativeWeChatPolicy, directSuffixes: [{ host: 'baidu.com', ports: [] }] },
      {
        ...nativeWeChatPolicy,
        directSuffixes: [{ host: 'baidu.com', ports: [443] }, { host: 'baidu.com', ports: [80] }],
      },
    ];
    for (const invalid of invalidPolicies) {
      const response = await admin('traffic-policy', { policy: invalid, expectedRevision: 3 }, 'PUT');
      expect(response.status).toBe(400);
      expect((await response.json() as any).error.code).toBe('VALIDATION_ERROR');
    }
  });

  // 192.0.0.0/16 contains exactly two IANA special-use /24s — 192.0.0.0/24
  // (IETF Protocol Assignments) and 192.0.2.0/24 (TEST-NET-1) — that both
  // clients reject. Every other /24 is ARIN-administered public Internet
  // space that both clients route direct, so the control plane must admit
  // it. The admission gate (`isPublicIPv4` in canonicalTrafficPolicy) runs on
  // both the mediaEndpoints and tcpEndpoints canonicalisers and is not
  // relaxed by `trusted` (a signature vouches for authorship, not for the IP
  // allowlist), so `dryRun` exercises it without storing or touching
  // revisions. Both clients gate the third octet; this pins the control
  // plane to the same boundary.
  it('admits public IPv4 in the rest of 192.0.0.0/16 and rejects only the special-use /24s', async () => {
    const empty = (address: string, media: boolean) => ({
      version: 4 as const,
      domains: [],
      mediaEndpoints: media ? [{ address, ports: [443] }] : [],
      webDomains: [],
      directSuffixes: [],
      tcpEndpoints: media ? [] : [{ address, ports: [443] }],
    });
    // The two non-routable /24s (and the 6to4 relay anycast) stay rejected on
    // both admission gates — regression guards for the special-use carve-outs.
    for (const address of ['192.0.0.9', '192.0.2.1', '192.88.99.1']) {
      const mediaReject = await admin('traffic-policy', { dryRun: true, policy: empty(address, true) }, 'PUT');
      expect(mediaReject.status).toBe(400);
      expect((await mediaReject.json() as any).error.code).toBe('VALIDATION_ERROR');
      const tcpReject = await admin('traffic-policy', { dryRun: true, policy: empty(address, false) }, 'PUT');
      expect(tcpReject.status).toBe(400);
      expect((await tcpReject.json() as any).error.code).toBe('VALIDATION_ERROR');
    }
    // The remaining 254 /24s of 192.0.0.0/16 are public and pass the dry-run
    // admission gate on both mediaEndpoints and tcpEndpoints. Previously the
    // over-broad `a === 192 && b === 0` term rejected all of them.
    for (const address of ['192.0.3.5', '192.0.31.5', '192.0.123.5']) {
      const mediaOK = await admin('traffic-policy', { dryRun: true, policy: empty(address, true) }, 'PUT');
      expect(mediaOK.status).toBe(200);
      expect((await mediaOK.json() as any).dryRun).toBe(true);
      const tcpOK = await admin('traffic-policy', { dryRun: true, policy: empty(address, false) }, 'PUT');
      expect(tcpOK.status).toBe(200);
      expect((await tcpOK.json() as any).dryRun).toBe(true);
    }
    // The public boundary publishes through the normal admin write path and
    // is served back verbatim by publicTrafficPolicy — the realized impact
    // was that this PUT returned 400 VALIDATION_ERROR before the fix. Signed,
    // because media endpoints need a signature (#318).
    const boundary = await admin('traffic-policy', {
      policy: empty('192.0.3.5', true),
      dryRun: true,
    }, 'PUT');
    const published = await admin('traffic-policy', {
      policy: empty('192.0.3.5', true),
      expectedRevision: 0,
      signature: await signPolicy((await boundary.json() as any).json),
    }, 'PUT');
    expect(published.status).toBe(200);
    const served = await (await admin('traffic-policy', undefined, 'GET')).json() as any;
    expect(served.revision).toBe(1);
    expect(JSON.parse(served.json).mediaEndpoints).toEqual([{ address: '192.0.3.5', ports: [443] }]);
  });

  // Private half of the test-only keypair whose public half is bound as
  // TRAFFIC_POLICY_PUBLIC_KEY in vitest.config.ts. Signing here rather than
  // pasting fixed signatures means these tests still hold if the canonical byte
  // layout changes: they sign whatever the endpoint says it will serve.
  const TEST_POLICY_PKCS8 =
    'MC4CAQAwBQYDK2VwBCIEIAIwT13QKhcJliAMcXcFnjUys571THcVvHLBTICbjKzy';
  const signPolicy = async (json: string) => {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      Uint8Array.from(atob(TEST_POLICY_PKCS8), (c) => c.charCodeAt(0)),
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'Ed25519',
      key,
      new TextEncoder().encode(`tono-traffic-policy-v1\n${json}`),
    );
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  };
  // A host no allowlist in this Worker contains, which is the whole point: a
  // signature is what makes adding one a remote-only change.
  const unlistedPolicy = {
    version: 4,
    domains: [],
    mediaEndpoints: [],
    webDomains: [{ host: 'www.policy-signature-fixture.example.net', ports: [443] }],
    directSuffixes: [],
    tcpEndpoints: [],
  };

  it('signs a policy over the bytes it will serve, not over the bytes submitted', async () => {
    // The document served is this endpoint's canonicalised output — reordered,
    // sorted, ports normalised. A signature over the operator's input would not
    // cover it, so the tool asks what it would be signing first.
    const submitted = {
      version: 4,
      domains: [],
      mediaEndpoints: [],
      webDomains: [
        { ports: [443], host: 'www.policy-signature-fixture.example.net' },
        { host: 'shop.policy-signature-fixture.example.net', ports: [443] },
      ],
      directSuffixes: [],
      tcpEndpoints: [],
    };
    const preview = await admin('traffic-policy', { policy: submitted, dryRun: true }, 'PUT');
    expect(preview.status).toBe(200);
    const previewed = await preview.json() as any;
    expect(previewed.dryRun).toBe(true);
    expect(previewed.signatureRequired).toBe(true);
    expect(previewed.signatureContext).toBe('tono-traffic-policy-v1\n');
    // Canonical, and demonstrably not what was submitted.
    expect(previewed.json).not.toBe(JSON.stringify(submitted));
    expect(JSON.parse(previewed.json).webDomains.map((d: any) => d.host))
      .toEqual(['shop.policy-signature-fixture.example.net', 'www.policy-signature-fixture.example.net']);
    // A dry run stores nothing.
    expect((await (await admin('traffic-policy', undefined, 'GET')).json() as any).revision).toBe(0);

    const published = await admin('traffic-policy', {
      policy: submitted,
      expectedRevision: 0,
      signature: await signPolicy(previewed.json),
    }, 'PUT');
    expect(published.status).toBe(200);
    const body = await published.json() as any;
    expect(body.json).toBe(previewed.json);

    // And the client is handed the signature so it can make the same decision.
    const account = await createAccount('signed-policy-delivery');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
    const delivered = await fetched.json() as any;
    expect(delivered.signature).toBe(body.signature);
    expect(JSON.parse(delivered.json).webDomains.map((d: any) => d.host))
      .toEqual(['shop.policy-signature-fixture.example.net', 'www.policy-signature-fixture.example.net']);
  });

  it('refuses an unlisted host that arrives without a valid signature', async () => {
    // Unsigned: the allowlist is still the only authority, exactly as before.
    const unsigned = await admin(
      'traffic-policy', { policy: unlistedPolicy, expectedRevision: 0 }, 'PUT',
    );
    expect(unsigned.status).toBe(400);
    expect((await unsigned.json() as any).error.code).toBe('VALIDATION_ERROR');

    // A well-formed signature over a *different* document. This is the attack the
    // dry-run flow could otherwise enable: capture a signature, reuse it.
    const other = await admin('traffic-policy', {
      policy: { version: 4, domains: [], mediaEndpoints: [], webDomains: [{ host: 'www.bilibili.com', ports: [443] }], directSuffixes: [], tcpEndpoints: [] },
      dryRun: true,
    }, 'PUT');
    const replayed = await admin('traffic-policy', {
      policy: unlistedPolicy,
      expectedRevision: 0,
      signature: await signPolicy((await other.json() as any).json),
    }, 'PUT');
    expect(replayed.status).toBe(400);
    expect((await replayed.json() as any).error.code).toBe('TRAFFIC_POLICY_SIGNATURE_INVALID');

    // Signed by the wrong key, right shape.
    const preview = await admin('traffic-policy', { policy: unlistedPolicy, dryRun: true }, 'PUT');
    const foreign = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const forged = await crypto.subtle.sign(
      'Ed25519', foreign.privateKey,
      new TextEncoder().encode(`tono-traffic-policy-v1\n${(await preview.json() as any).json}`),
    );
    const impostor = await admin('traffic-policy', {
      policy: unlistedPolicy,
      expectedRevision: 0,
      signature: btoa(String.fromCharCode(...new Uint8Array(forged))),
    }, 'PUT');
    expect(impostor.status).toBe(400);
    expect((await impostor.json() as any).error.code).toBe('TRAFFIC_POLICY_SIGNATURE_INVALID');

    // Nothing above was stored.
    expect((await (await admin('traffic-policy', undefined, 'GET')).json() as any).revision).toBe(0);
  });

  it('requires a signature before a media endpoint can leave the tunnel', async () => {
    // #318: an exact IP:port carve-out is only reviewed by a signature. Both
    // clients' unsigned media allowlists are empty, so an unsigned publish
    // carrying one is refused here instead of being silently dropped (macOS)
    // or honoured (older Windows builds).
    const media = {
      version: 1,
      domains: [],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443] }],
    };
    const unsigned = await admin('traffic-policy', { policy: media, expectedRevision: 0 }, 'PUT');
    expect(unsigned.status).toBe(400);
    expect((await unsigned.json() as any).error.code).toBe('VALIDATION_ERROR');
    const preview = await admin('traffic-policy', { policy: media, dryRun: true }, 'PUT');
    const previewed = await preview.json() as any;
    expect(previewed.signatureRequired).toBe(true);

    const signed = await admin('traffic-policy', {
      policy: media, expectedRevision: 0, signature: await signPolicy(previewed.json),
    }, 'PUT');
    expect(signed.status).toBe(200);

    // A row stored unsigned before this rule is still served; refusing it on
    // read would turn every policy fetch into a 503. Clients drop it.
    await env.DB.prepare(
      'UPDATE managed_traffic_policy SET signature = NULL WHERE singleton_id = 1',
    ).run();
    const account = await createAccount('unsigned-media-legacy-row');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
  });

  it('requires a signature before a TCP endpoint can leave the tunnel', async () => {
    // Same rule as media endpoints: an exact IP:port carve-out is only
    // reviewed by a signature. macOS's unsigned TCP allowlist is empty and
    // Windows does not read tcpEndpoints, so an unsigned one is refused here.
    const tcp = {
      version: 4,
      domains: [],
      mediaEndpoints: [],
      webDomains: [],
      directSuffixes: [],
      tcpEndpoints: [{ address: '49.51.67.253', ports: [443] }],
    };
    const unsigned = await admin('traffic-policy', { policy: tcp, expectedRevision: 0 }, 'PUT');
    expect(unsigned.status).toBe(400);
    expect((await unsigned.json() as any).error.code).toBe('VALIDATION_ERROR');
    const preview = await admin('traffic-policy', { policy: tcp, dryRun: true }, 'PUT');
    const previewed = await preview.json() as any;
    expect(previewed.signatureRequired).toBe(true);

    const signed = await admin('traffic-policy', {
      policy: tcp, expectedRevision: 0, signature: await signPolicy(previewed.json),
    }, 'PUT');
    expect(signed.status).toBe(200);

    // A row stored unsigned before this rule is still served.
    await env.DB.prepare(
      'UPDATE managed_traffic_policy SET signature = NULL WHERE singleton_id = 1',
    ).run();
    const account = await createAccount('unsigned-tcp-legacy-row');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
  });

  it('binds the assigned revision inside the signed policy json once enabled', async () => {
    // #317: the envelope revision is outside the signature, so a replayed
    // signed document could claim any revision. With the switch on, the
    // revision this write will be assigned is part of the signed bytes.
    const bound = { ...env, TRAFFIC_POLICY_EMBED_REVISION: 'true' } as unknown as Env;
    const boundAdmin = async (value: unknown) => {
      const context = createExecutionContext();
      const response = await worker.fetch(new Request('https://test/api/v1/admin/traffic-policy', {
        ...json(value), method: 'PUT',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      }), bound, context);
      await waitOnExecutionContext(context);
      return response;
    };
    const preview = await boundAdmin({ policy: unlistedPolicy, dryRun: true, expectedRevision: 0 });
    const previewed = await preview.json() as any;
    expect(JSON.parse(previewed.json).revision).toBe(1);

    // A signature over the revision-free bytes no longer covers what is served.
    const legacy = await admin('traffic-policy', { policy: unlistedPolicy, dryRun: true }, 'PUT');
    const unbound = await boundAdmin({
      policy: unlistedPolicy, expectedRevision: 0,
      signature: await signPolicy((await legacy.json() as any).json),
    });
    expect((await unbound.json() as any).error.code).toBe('TRAFFIC_POLICY_SIGNATURE_INVALID');

    const published = await boundAdmin({
      policy: unlistedPolicy, expectedRevision: 0, signature: await signPolicy(previewed.json),
    });
    expect(published.status).toBe(200);
    expect((await published.json() as any).json).toBe(previewed.json);

    // Served whatever the switch says, with the embedded revision equal to the
    // envelope's; a row whose envelope no longer matches is not served.
    const account = await createAccount('embedded-policy-revision');
    const read = () => api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    const delivered = await (await read()).json() as any;
    expect(JSON.parse(delivered.json).revision).toBe(delivered.revision);
    await env.DB.prepare(
      'UPDATE managed_traffic_policy SET revision = 7 WHERE singleton_id = 1',
    ).run();
    expect((await read()).status).toBe(503);
  });

  it('will not let a signature pull a protected host out of the tunnel', async () => {
    // The invariant that must survive a leaked key. A signature relaxes which
    // hosts may route direct; it must never relax which hosts may not. If this
    // ever passes, one stolen key exposes this control plane and Claude traffic
    // — strictly worse than the allowlist the signature replaces.
    for (const field of ['domains', 'webDomains', 'directSuffixes'] as const) {
      for (const host of [
        'api.anthropic.com',
        'claude.ai',
        'claude.com',
        'claude.app',
        'claude.site',
        'clau.de',
        'anthropic.ai',
        'claudestudio.com',
        'claudemcpclient.com',
        'claudemcpcontent.com',
        'downloads.claudeusercontent.com',
        'servd-anthropic-website.b-cdn.net',
        'challenges.cloudflare.com',
        'cf-assets.www.cloudflare.com',
        'cloudflareinsights.com',
        'browser-intake-datadoghq.com',
        'browser-intake-us5-datadoghq.com',
        'browser-intake-us3-datadoghq.com',
        'browser-intake-ap1-datadoghq.com',
        'browser-intake-ap2-datadoghq.com',
        'browser-intake-datadoghq.eu',
        'browser-intake-ddog-gov.com',
        'o123.ingest.sentry.io',
        'api.statsig.com',
        'api.statsigapi.net',
        'featuregates.org',
        'growthbook.io',
        'stripe.network', 'js.stripe.com', 'checkout.stripe.com',
        'a.stripecdn.com', 'checkout.link.com', 'newassets.hcaptcha.com',
        'storage.googleapis.com',
        'registry.npmjs.org',
        'raw.githubusercontent.com',
        'formulae.brew.sh',
        'api.datadoghq.com',
        'tono.app',
      ]) {
        const attempt = { ...unlistedPolicy, webDomains: [], [field]: [{ host, ports: [443] }] };
        // Even the dry run, which canonicalises as trusted, must refuse.
        const preview = await admin('traffic-policy', { policy: attempt, dryRun: true }, 'PUT');
        expect(preview.status, `${field}/${host}`).toBe(400);
      }
    }

    // A suffix rule also owns every child below it. Refuse ancestors of a
    // protected suffix, not only exact protected hosts and their children.
    for (const host of [
      'googleapis.com',
      'githubusercontent.com',
      'npmjs.org',
      'brew.sh',
      'b-cdn.net',
      'www.cloudflare.com',
    ]) {
      const attempt = {
        ...unlistedPolicy,
        webDomains: [],
        directSuffixes: [{ host, ports: [443] }],
      };
      const preview = await admin('traffic-policy', { policy: attempt, dryRun: true }, 'PUT');
      expect(preview.status, `directSuffixes/${host}`).toBe(400);
    }
  });

  it('rejects signed direct suffixes overlapping every other assistant home domain', async () => {
    const assistantSuffixes = [
      'chatgpt.com', 'openai.com', 'chat.com', 'ai.com', 'oaistatic.com', 'oaiusercontent.com',
      'grok.com', 'grok.x.com', 'grokipedia.com', 'x.ai',
      'perplexity.ai', 'perplexity.com', 'pplx.ai',
      'gemini.google.com', 'bard.google.com', 'aistudio.google.com',
      'generativelanguage.googleapis.com', 'notebooklm.google.com',
      'muse.ai', 'meta.ai', 'muse.meta.com', 'www.muse.ai',
      'meta.com', 'facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'fbcdn.net',
      'facebook.net', 'messenger.com', 'instagram.com', 'cdninstagram.com', 'ig.me', 'threads.net',
      'gmail.com', 'mail.google.com', 'googlemail.com', 'inbox.google.com',
      'accounts.google.com', 'myaccount.google.com', 'oauth2.googleapis.com',
      'mail-pa.clients6.google.com', 'gmail.googleapis.com',
    ];
    // Test exact suffixes, their children and parents with real signatures:
    // the signer may extend reviewed direct routing, never residential routes.
    for (const host of [
      ...assistantSuffixes.flatMap((suffix) => [suffix, `api.${suffix}`]),
      'x.com', 'google.com', 'clients6.google.com',
    ]) {
      const attempt = { ...unlistedPolicy, webDomains: [], directSuffixes: [{ host, ports: [443] }] };
      const rejected = await admin('traffic-policy', {
        policy: attempt, expectedRevision: 0, signature: await signPolicy(JSON.stringify(attempt)),
      }, 'PUT');
      expect(rejected.status, host).toBe(400);
      expect((await rejected.json() as any).error.code, host).toBe('VALIDATION_ERROR');
    }

    const allowed = {
      ...unlistedPolicy, webDomains: [],
      directSuffixes: [{ host: 'policy-signature-fixture.example.net', ports: [443] }],
    };
    const published = await admin('traffic-policy', {
      policy: allowed, expectedRevision: 0, signature: await signPolicy(JSON.stringify(allowed)),
    }, 'PUT');
    expect(published.status).toBe(200);
    expect(JSON.parse((await published.json() as any).json).directSuffixes).toEqual(allowed.directSuffixes);
  });

  it('keeps dedicated DashScope APIs protected while serving the signed Alibaba DIRECT parent', async () => {
    const policy = {
      version: 3, domains: [], mediaEndpoints: [], webDomains: [],
      directSuffixes: [{ host: 'aliyuncs.com', ports: [80, 443] }],
    };
    const preview = await admin('traffic-policy', { policy, dryRun: true }, 'PUT');
    expect(preview.status).toBe(200);
    const canonical = (await preview.json() as any).json;
    const published = await admin('traffic-policy', {
      policy, expectedRevision: 0, signature: await signPolicy(canonical),
    }, 'PUT');
    expect(published.status).toBe(200);
    const account = await createAccount('dashscope-parent-policy');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
    expect((await fetched.json() as any).json).toBe(canonical);

    for (const host of [
      'dashscope.aliyuncs.com', 'cn-hongkong.dashscope.aliyuncs.com',
      'coding-intl.dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com',
      'dashscope-us.aliyuncs.com', 'maas.aliyuncs.com',
      'workspace.cn-beijing.maas.aliyuncs.com', 'trial.ap-southeast-1.maas.aliyuncs.com',
      'token-plan.ap-southeast-1.maas.aliyuncs.com',
    ]) {
      for (const field of ['domains', 'webDomains', 'directSuffixes'] as const) {
        const attempt = { ...policy, [field]: [{ host, ports: [443] }] };
        const rejected = await admin('traffic-policy', {
          policy: attempt, expectedRevision: 1, signature: await signPolicy(JSON.stringify(attempt)),
        }, 'PUT');
        expect(rejected.status, `${field}/${host}`).toBe(400);
        expect((await rejected.json() as any).error.code).toBe('VALIDATION_ERROR');
      }
    }
    // The exception is only the reviewed Alibaba parent, never arbitrary ancestors.
    const rejected = await admin('traffic-policy', {
      policy: { ...policy, directSuffixes: [{ host: 'googleapis.com', ports: [443] }] }, dryRun: true,
    }, 'PUT');
    expect(rejected.status).toBe(400);
  });

  it('admits product China web suffixes as directSuffixes', async () => {
    const preview = await admin('traffic-policy', {
      policy: {
        version: 3,
        domains: [],
        mediaEndpoints: [],
        webDomains: [],
        directSuffixes: [
          { host: 'taobao.com', ports: [80, 443] },
          { host: 'douyin.com', ports: [443] },
          { host: 'huya.com', ports: [443] },
          { host: 'wps.cn', ports: [443] },
          { host: 'voovmeeting.com', ports: [443] },
          { host: 'kugou.com', ports: [443] },
          { host: 'xylink.com', ports: [443] },
          { host: 'zhihu.com', ports: [443] },
          { host: 'goofish.com', ports: [443] },
        ],
      },
      dryRun: true,
    }, 'PUT');
    expect(preview.status).toBe(200);
  });

  it('clears a stored signature when an unsigned policy replaces a signed one', async () => {
    // Otherwise the old signature ships alongside new bytes and every client
    // that verifies rejects the whole policy — managed direct routing off,
    // fleet-wide, from a republish that looked like it worked.
    const preview = await admin('traffic-policy', { policy: unlistedPolicy, dryRun: true }, 'PUT');
    const signed = await admin('traffic-policy', {
      policy: unlistedPolicy,
      expectedRevision: 0,
      signature: await signPolicy((await preview.json() as any).json),
    }, 'PUT');
    expect(signed.status).toBe(200);
    expect((await signed.json() as any).signature).toBeTruthy();

    const listedOnly = {
      version: 4,
      domains: [],
      mediaEndpoints: [],
      webDomains: [{ host: 'www.bilibili.com', ports: [443] }],
      directSuffixes: [],
      tcpEndpoints: [],
    };
    const unsigned = await admin(
      'traffic-policy', { policy: listedOnly, expectedRevision: 1 }, 'PUT',
    );
    expect(unsigned.status).toBe(200);
    expect((await unsigned.json() as any).signature).toBeUndefined();
    expect(await env.DB.prepare(
      'SELECT signature FROM managed_traffic_policy WHERE singleton_id = 1',
    ).first<any>()).toEqual({ signature: null });

    // And the policy is still served, rather than 503-ing on a signature that
    // no longer covers anything.
    const account = await createAccount('signature-cleared');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(200);
    expect((await fetched.json() as any).signature).toBeUndefined();
  });

  it('refuses to serve a signed policy whose stored row was altered', async () => {
    const preview = await admin('traffic-policy', { policy: unlistedPolicy, dryRun: true }, 'PUT');
    const canonical = (await preview.json() as any).json;
    expect((await admin('traffic-policy', {
      policy: unlistedPolicy, expectedRevision: 0, signature: await signPolicy(canonical),
    }, 'PUT')).status).toBe(200);

    // Substitute a signature of the right shape that does not cover these bytes,
    // the way a compromised database would.
    await env.DB.prepare(
      'UPDATE managed_traffic_policy SET signature = ? WHERE singleton_id = 1',
    ).bind(await signPolicy(`${canonical} `)).run();
    const account = await createAccount('policy-row-altered');
    const fetched = await api('traffic-policy', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(fetched.status).toBe(503);
    expect((await fetched.json() as any).error.code).toBe('TRAFFIC_POLICY_UNAVAILABLE');
  });

  it('tells the operator when a policy needs no signature at all', async () => {
    // Adding a host the allowlists already cover must not start requiring a key
    // ceremony. Most republishes are this case.
    const preview = await admin('traffic-policy', {
      policy: {
        version: 4,
        domains: [],
        mediaEndpoints: [],
        webDomains: [{ host: 'www.bilibili.com', ports: [443] }],
        directSuffixes: [],
        tcpEndpoints: [],
      },
      dryRun: true,
    }, 'PUT');
    expect(preview.status).toBe(200);
    expect((await preview.json() as any).signatureRequired).toBe(false);
  });

  it('accepts the Feishu family as direct suffixes instead of exact pins', async () => {
    // Shape produced by tooling/scripts/retarget-direct-suffixes.rb. An exact
    // pin only ever covers the apex, so CDN traffic on *.feishucdn.com was
    // never matched; DOMAIN-SUFFIX entries need no DNS answer at all.
    const retargeted = {
      version: 4,
      domains: [{ host: 'res.wx.qq.com', ports: [443] }],
      mediaEndpoints: [{ address: '43.146.27.17', ports: [443] }],
      webDomains: [{ host: 'www.bilibili.com', ports: [443] }],
      directSuffixes: [
        { host: 'feishu.cn', ports: [80, 443] },
        { host: 'feishucdn.com', ports: [80, 443] },
        { host: 'larkoffice.com', ports: [443] },
        { host: 'larksuite.com', ports: [443] },
      ],
      tcpEndpoints: [{ address: '49.51.67.253', ports: [443] }],
    };
    // Signed: the media endpoint in this shape needs a signature (#318).
    const retargetedPreview = await admin('traffic-policy', { policy: retargeted, dryRun: true }, 'PUT');
    const written = await admin('traffic-policy', {
      policy: retargeted,
      expectedRevision: 0,
      signature: await signPolicy((await retargetedPreview.json() as any).json),
    }, 'PUT');
    expect(written.status).toBe(200);
    const stored = JSON.parse((await written.json() as any).json);
    expect(stored.directSuffixes.map((entry: any) => entry.host)).toEqual([
      'feishu.cn', 'feishucdn.com', 'larkoffice.com', 'larksuite.com',
    ]);
    expect(stored.webDomains).toEqual([{ host: 'www.bilibili.com', ports: [443] }]);

    // A www. form cannot be a suffix entry, which is why the script folds those
    // ports into the apex rather than carrying the host across.
    const wwwSuffix = await admin('traffic-policy', {
      policy: { ...retargeted, directSuffixes: [{ host: 'www.feishu.cn', ports: [443] }] },
      expectedRevision: 1,
    }, 'PUT');
    expect(wwwSuffix.status).toBe(400);

    // 8080 is why the script refuses to fold non-80/443 ports into a suffix.
    const oddPort = await admin('traffic-policy', {
      policy: { ...retargeted, directSuffixes: [{ host: 'feishucdn.com', ports: [8080] }] },
      expectedRevision: 1,
    }, 'PUT');
    expect(oddPort.status).toBe(400);

    // A repeated suffix must be refused at this boundary. The client rejects the
    // whole revision when it sees one, so accepting it here silently disables
    // managed direct routing on every device until someone republishes.
    const duplicateSuffix = await admin('traffic-policy', {
      policy: {
        ...retargeted,
        directSuffixes: [
          { host: 'feishu.cn', ports: [80] },
          { host: 'feishu.cn', ports: [443] },
        ],
      },
      expectedRevision: 1,
    }, 'PUT');
    expect(duplicateSuffix.status).toBe(400);
    expect((await duplicateSuffix.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts reviewed DingTalk and Feishu native-app domains', async () => {
    // Native app domains feed the signed process/path route on both clients;
    // suffixes cover the macOS browser/CDN policy, while Windows keeps its
    // address-free suffixes disabled until WFP has an equivalent class.
    const officePolicy = {
      version: 4,
      domains: [
        { host: 'open.dingtalk.com', ports: [443, 80] },
        { host: 'open.feishu.cn', ports: [443, 80] },
        { host: 'open.larksuite.com', ports: [443] },
        { host: 'api.snssdk.com', ports: [443] },
      ],
      mediaEndpoints: [],
      webDomains: [],
      directSuffixes: [
        { host: 'dingtalk.com', ports: [80, 443] },
        { host: 'feishu.cn', ports: [80, 443] },
        { host: 'larksuite.com', ports: [443] },
      ],
      tcpEndpoints: [],
    };
    const written = await admin('traffic-policy', {
      policy: officePolicy,
      expectedRevision: 0,
    }, 'PUT');
    expect(written.status).toBe(200);
    const stored = JSON.parse((await written.json() as any).json);
    expect(stored.domains.map((entry: any) => entry.host)).toEqual([
      'api.snssdk.com', 'open.dingtalk.com', 'open.feishu.cn', 'open.larksuite.com',
    ]);
    expect(stored.directSuffixes.map((entry: any) => entry.host)).toEqual([
      'dingtalk.com', 'feishu.cn', 'larksuite.com',
    ]);

    const boundary = await admin('traffic-policy', {
      policy: {
        ...officePolicy,
        domains: [{ host: 'evil-dingtalk.com', ports: [443] }],
        directSuffixes: [],
      },
      expectedRevision: 1,
    }, 'PUT');
    expect(boundary.status).toBe(400);
    expect((await boundary.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unexpected top-level fields on the managed policy and catalog writes', async () => {
    const policy = {
      version: 1,
      domains: [{ host: 'res.wx.qq.com', ports: [443] }],
      mediaEndpoints: [],
    };
    const strayPolicyKey = await admin(
      'traffic-policy',
      { policy, expectedRevision: 0, revision: 9 },
      'PUT',
    );
    expect(strayPolicyKey.status).toBe(400);
    expect((await strayPolicyKey.json() as any).error.code).toBe('VALIDATION_ERROR');

    const strayCatalogKey = await admin(
      'exit-catalog',
      { yaml: 'proxies: []\n', expectedRevision: 0, revision: 9 },
      'PUT',
    );
    expect(strayCatalogKey.status).toBe(400);
    expect((await strayCatalogKey.json() as any).error.code).toBe('VALIDATION_ERROR');
  });
});
