import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import {
  api,
  json,
  admin,
  ACCESS_ADMIN_EMAIL,
  sequence,
  accessAssertion,
  createAccount,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  // Pinned verbatim from the client's single definition of the wire contract
  // (`crates/tono-core/src/auth.rs`, `DiagnosticsReport`), which is already
  // shipped. Do NOT edit this object to make the server pass: if the two ever
  // drift, this fixture is the alarm and the server is what moves.
  const shippedClientReport = {
    schemaVersion: 1,
    reportedAtMs: 1712345678901,
    appVersion: '0.0.3',
    osVersion: 'Windows 11 Pro 23H2',
    osArch: 'x86_64',
    serviceProtocol: '2.9',
    serviceBuild: '2.6.2',
    uiState: 'protectedOffline',
    accountState: 'ready',
    selectedServer: 'US West 1',
    catalogRevision: 12,
    killSwitchMode: 'blocked',
    killSwitchWanted: true,
    killSwitchLive: false,
    killSwitchLastError: 'WFP filter add failed (0x80320013)',
    dnsEnabled: true,
    dnsLastError: 'resolver handshake timed out',
    failedStage: 'securingDNS',
    error: 'connect failed after 2 retries',
    retryAttempt: 2,
    totalElapsedMs: 4600,
    steps: [{ key: 'preparing', state: 'completed', elapsedMs: 1200 }],
    virtualAdapters: ['hyperV', 'wsl'],
    auditLogPath: '%USERPROFILE%\\AppData\\Roaming\\Tono\\traffic-audit.jsonl',
    serviceLogPath: 'C:\\ProgramData\\Tono\\logs\\tono-service.log',
  };

  // Overrides patch the report, not the envelope: the envelope is `{report}`.
  const diagnosticsPayload = (overrides: Record<string, unknown> = {}) => ({
    report: { ...shippedClientReport, ...overrides },
  });

  it('accepts the exact payload the shipped client sends, verbatim', async () => {
    const account = await createAccount('diagnostics-contract');
    // The literal body from `auth.rs`, envelope included, byte for byte.
    const response = await api('diagnostics/reports', json(
      { report: shippedClientReport },
      account.accessToken,
    ));
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    // The client requires a non-empty referenceCode and tolerates receivedAt.
    expect(body.referenceCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(typeof body.receivedAt).toBe('number');

    const stored = await env.DB.prepare(
      'SELECT * FROM diagnostics_reports WHERE reference_code = ?',
    ).bind(body.referenceCode).first<any>();
    // Every field survives, unchanged and in the contract's own key order:
    // a drift on either side breaks this equality loudly.
    expect(stored.report_json).toBe(JSON.stringify(shippedClientReport));
    // The columns come from inside the report; there is no second copy on the
    // envelope any more.
    expect(stored.client_version).toBe('0.0.3');
    expect(stored.os_version).toBe('Windows 11 Pro 23H2');
    expect((await api('diagnostics/reports', json({
      clientVersion: '0.0.3', osVersion: 'Windows 11 Pro 23H2', report: shippedClientReport,
    }, account.accessToken))).status).toBe(400);
  });

  it('accepts a user-initiated diagnostics upload and returns only a spoken reference code', async () => {
    const account = await createAccount('diagnostics-happy');
    const payload = diagnosticsPayload();
    const response = await api('diagnostics/reports', json(payload, account.accessToken));
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    // The code plus a display-only receipt time is the entire response: no
    // payload is echoed back to the client.
    expect(Object.keys(body).sort()).toEqual(['receivedAt', 'referenceCode']);
    expect(body.referenceCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(Math.abs(body.receivedAt - Math.floor(Date.now() / 1000))).toBeLessThan(60);

    const stored = await env.DB.prepare(
      'SELECT * FROM diagnostics_reports WHERE reference_code = ?',
    ).bind(body.referenceCode).first<any>();
    expect(stored.user_id).toBe(account.user.id);
    expect(stored.client_version).toBe('0.0.3');
    expect(stored.os_version).toBe('Windows 11 Pro 23H2');
    expect(JSON.parse(stored.report_json)).toEqual(payload.report);

    // An accepted report is immutable evidence; retention deletes, nothing rewrites.
    await expect(env.DB.prepare(
      'UPDATE diagnostics_reports SET client_version = ? WHERE reference_code = ?',
    ).bind('0.0.0', body.referenceCode).run()).rejects.toThrow(/DIAGNOSTICS_REPORT_IMMUTABLE/);

    // Only whitelisted fields survive; anything else is refused, not dropped.
    const extra = await api('diagnostics/reports', json(
      diagnosticsPayload({ wifiSSID: 'home-network' }),
      account.accessToken,
    ));
    expect(extra.status).toBe(400);
    expect((await extra.json() as any).error.code).toBe('VALIDATION_ERROR');

    // A required field is required; the nullable ones may be null or absent.
    const { appVersion, ...missingAppVersion } = shippedClientReport;
    expect((await api('diagnostics/reports', json(
      { report: missingAppVersion }, account.accessToken,
    ))).status).toBe(400);

    const nulled = await api('diagnostics/reports', json(diagnosticsPayload({
      serviceProtocol: null, serviceBuild: null, selectedServer: null,
      catalogRevision: null, killSwitchMode: null, killSwitchWanted: null,
      killSwitchLive: null, killSwitchLastError: null, dnsEnabled: null,
      dnsLastError: null, failedStage: null, error: null, totalElapsedMs: null,
      steps: [{ key: 'preparing', state: 'current', elapsedMs: null }],
      virtualAdapters: [],
    }), account.accessToken));
    expect(nulled.status).toBe(201);
    const nulledStored = await env.DB.prepare(
      'SELECT report_json FROM diagnostics_reports WHERE reference_code = ?',
    ).bind((await nulled.json() as any).referenceCode).first<any>();
    // Null and absent mean the same thing: neither is stored.
    expect(JSON.parse(nulledStored.report_json)).toEqual({
      schemaVersion: 1,
      reportedAtMs: 1712345678901,
      appVersion: '0.0.3',
      osVersion: 'Windows 11 Pro 23H2',
      osArch: 'x86_64',
      uiState: 'protectedOffline',
      accountState: 'ready',
      retryAttempt: 2,
      steps: [{ key: 'preparing', state: 'current' }],
      virtualAdapters: [],
      auditLogPath: shippedClientReport.auditLogPath,
      serviceLogPath: shippedClientReport.serviceLogPath,
    });

    expect((await api('diagnostics/reports', json(payload))).status).toBe(401);
  });

  it('accepts the otherVpn adapter class from a client that saw another VPN (H21-O-F7)', async () => {
    const account = await createAccount('diagnostics-other-vpn');
    const response = await api('diagnostics/reports', json(
      diagnosticsPayload({ virtualAdapters: ['otherVpn', 'wsl'] }),
      account.accessToken,
    ));
    expect(response.status).toBe(201);
    const stored = await env.DB.prepare(
      'SELECT report_json FROM diagnostics_reports WHERE reference_code = ?',
    ).bind((await response.json() as any).referenceCode).first<any>();
    expect(JSON.parse(stored.report_json).virtualAdapters).toEqual(['otherVpn', 'wsl']);
  });

  it('accepts the captivePortal and tlsIntercepted classes from a client that met them (H21-O-F8)', async () => {
    const account = await createAccount('diagnostics-network-interference');
    const response = await api('diagnostics/reports', json(
      diagnosticsPayload({ virtualAdapters: ['captivePortal', 'tlsIntercepted'] }),
      account.accessToken,
    ));
    expect(response.status).toBe(201);
    const stored = await env.DB.prepare(
      'SELECT report_json FROM diagnostics_reports WHERE reference_code = ?',
    ).bind((await response.json() as any).referenceCode).first<any>();
    expect(JSON.parse(stored.report_json).virtualAdapters).toEqual(['captivePortal', 'tlsIntercepted']);
  });

  it('rejects an oversized diagnostics upload instead of truncating it', async () => {
    const account = await createAccount('diagnostics-oversized');
    const overBodyCap = await api('diagnostics/reports', json(
      diagnosticsPayload({ serviceLogPath: 'y'.repeat(40 * 1024) }),
      account.accessToken,
    ));
    expect(overBodyCap.status).toBe(413);
    expect((await overBodyCap.json() as any).error.code).toBe('PAYLOAD_TOO_LARGE');

    // Within the body cap, the per-field bounds refuse rather than truncate.
    const tooManySteps = await api('diagnostics/reports', json(
      diagnosticsPayload({
        steps: Array.from({ length: 33 }, (_, index) => ({
          key: `step-${index}`, state: 'completed', elapsedMs: 10,
        })),
      }),
      account.accessToken,
    ));
    expect(tooManySteps.status).toBe(400);

    const badStepState = await api('diagnostics/reports', json(
      diagnosticsPayload({ steps: [{ key: 'preparing', state: 'skipped', elapsedMs: 1 }] }),
      account.accessToken,
    ));
    expect(badStepState.status).toBe(400);

    const longStepKey = await api('diagnostics/reports', json(
      diagnosticsPayload({ steps: [{ key: 'k'.repeat(61), state: 'failed', elapsedMs: 1 }] }),
      account.accessToken,
    ));
    expect(longStepKey.status).toBe(400);

    const longError = await api('diagnostics/reports', json(
      diagnosticsPayload({ error: 'w'.repeat(501) }),
      account.accessToken,
    ));
    expect(longError.status).toBe(400);

    const longOsVersion = await api('diagnostics/reports', json(
      diagnosticsPayload({ osVersion: 'w'.repeat(81) }),
      account.accessToken,
    ));
    expect(longOsVersion.status).toBe(400);

    // The adapter vocabulary is fixed: unknown classes and repeats are refused.
    const unknownAdapter = await api('diagnostics/reports', json(
      diagnosticsPayload({ virtualAdapters: ['hyperV', 'parallels'] }),
      account.accessToken,
    ));
    expect(unknownAdapter.status).toBe(400);

    const repeatedAdapter = await api('diagnostics/reports', json(
      diagnosticsPayload({ virtualAdapters: ['wsl', 'wsl'] }),
      account.accessToken,
    ));
    expect(repeatedAdapter.status).toBe(400);

    const wildRetry = await api('diagnostics/reports', json(
      diagnosticsPayload({ retryAttempt: 1001 }),
      account.accessToken,
    ));
    expect(wildRetry.status).toBe(400);

    const wildElapsed = await api('diagnostics/reports', json(
      diagnosticsPayload({ totalElapsedMs: 24 * 60 * 60 * 1000 + 1 }),
      account.accessToken,
    ));
    expect(wildElapsed.status).toBe(400);

    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM diagnostics_reports WHERE user_id = ?',
    ).bind(account.user.id).first<any>();
    expect(Number(rows.total)).toBeLessThanOrEqual(1);
  });

  it('caps diagnostics uploads per user per hour', async () => {
    const account = await createAccount('diagnostics-ratelimit');
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      const response = await api('diagnostics/reports', json(diagnosticsPayload(), account.accessToken));
      statuses.push(response.status);
      if (response.status === 429) {
        expect((await response.json() as any).error.code).toBe('RATE_LIMITED');
      }
    }
    expect(statuses.filter((status) => status === 201)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM diagnostics_reports WHERE user_id = ?',
    ).bind(account.user.id).first<any>();
    expect(Number(rows.total)).toBe(5);
  });

  it('lets only an admin look a diagnostics report up by reference code', async () => {
    const account = await createAccount('diagnostics-lookup');
    const upload = await api('diagnostics/reports', json(diagnosticsPayload(), account.accessToken));
    expect(upload.status).toBe(201);
    const { referenceCode } = await upload.json() as any;

    expect((await api(`admin/diagnostics/reports/${referenceCode}`)).status).toBe(401);
    expect((await api(`admin/diagnostics/reports/${referenceCode}`, {
      headers: { authorization: `Bearer ${account.accessToken}` },
    })).status).toBe(401);

    const found = await admin(`diagnostics/reports/${referenceCode}`, undefined, 'GET');
    expect(found.status).toBe(200);
    expect((await found.json() as any).report).toMatchObject({
      referenceCode,
      userId: account.user.id,
      clientVersion: '0.0.3',
      osVersion: 'Windows 11 Pro 23H2',
      report: { failedStage: 'securingDNS', virtualAdapters: ['hyperV', 'wsl'] },
    });

    // Support types the code back in however they heard it.
    const typedBack = await admin(
      `diagnostics/reports/${referenceCode.slice(0, 4).toLowerCase()}-${referenceCode.slice(4)}`,
      undefined,
      'GET',
    );
    expect(typedBack.status).toBe(200);

    const unknown = await admin('diagnostics/reports/ZZZZZZZZ', undefined, 'GET');
    expect(unknown.status).toBe(404);
    expect((await unknown.json() as any).error.code).toBe('NOT_FOUND');

    // 0/O/1/I are not in the alphabet, so a misheard code fails validation.
    expect((await admin('diagnostics/reports/O0O0O0O0', undefined, 'GET')).status).toBe(400);
  });

  // Typed as `Uint8Array<ArrayBuffer>` rather than the default
  // `Uint8Array<ArrayBufferLike>`: the latter admits SharedArrayBuffer, which
  // `BlobPart` rejects, so the request body below would not typecheck.
  const gzip = async (text: string): Promise<Uint8Array<ArrayBuffer>> =>
    new Uint8Array(
      await new Response(
        new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
  const gunzip = async (bytes: ArrayBuffer) => new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text();
  const logUpload = async (
    token: string,
    payload: Uint8Array<ArrayBuffer>,
    overrides: Record<string, string> = {},
  ) => api('diagnostics/logs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/gzip',
      'X-Tono-Log-Session': 'FE5919D3-405E-4538-9C4C-1866E088F24F',
      'X-Tono-Log-Sequence': '0',
      'X-Tono-Log-Lines': '3',
      'X-Tono-Log-Client-Version': '0.0.63',
      'X-Tono-Log-Os-Version': 'macOS 26.3',
      ...overrides,
    },
    // Wrapped because a Uint8Array is not a `BodyInit` under the Workers types,
    // even though workerd accepts one at run time.
    body: new Blob([payload]),
  });

  const enableDiagnosticsLogs = async (account: any, expiresAt = Math.floor(Date.now() / 1000) + 3600) => {
    const response = await admin(
      `users/${account.user.id}/devices/${account.device.id}/diagnostics-logs`,
      { expiresAt },
      'PUT',
    );
    expect(response.status).toBe(200);
    return expiresAt;
  };

  it('stores a raw log segment from a device no operator opened a window for', async () => {
    const account = await createAccount('log-default-store');
    const response = await logUpload(account.accessToken, await gzip('{"kind":"connection_opened"}\n'));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ stored: true });
    expect(await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM diagnostics_log_objects WHERE user_id = ?',
    ).bind(account.user.id).first()).toMatchObject({ n: 1 });
  });

  it('authorizes, disables, and audits a bounded per-device raw-log window', async () => {
    const account = await createAccount('log-access');
    const path = `users/${account.user.id}/devices/${account.device.id}/diagnostics-logs`;
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    expect((await api(`admin/${path}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${account.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresAt }),
    })).status).toBe(401);
    expect((await admin(
      `users/not-the-owner/devices/${account.device.id}/diagnostics-logs`,
      { expiresAt },
      'PUT',
    )).status).toBe(404);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM diagnostics_log_access').first())
      .toMatchObject({ n: 0 });

    const enabled = await api(`ops/${path}`, {
      method: 'PUT',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresAt }),
    });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({
      diagnosticsLogs: { enabled: true, expiresAt },
    });
    // Retrying the same absolute expiry is a no-op, not an extension or a
    // second grant/audit event.
    expect((await admin(path, { expiresAt }, 'PUT')).status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM diagnostics_log_access').first())
      .toMatchObject({ n: 1 });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ops_audit WHERE action = 'diagnostics-logs.enable'",
    ).first()).toMatchObject({ n: 1 });

    expect((await admin(path, undefined, 'GET')).status).toBe(200);
    const disabled = await admin(path, undefined, 'DELETE');
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({
      diagnosticsLogs: { enabled: false, expiresAt: null },
    });
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ops_audit WHERE action = 'diagnostics-logs.disable'",
    ).first()).toMatchObject({ n: 1 });
  });

  it('rolls back a diagnostics-log grant if its required audit row cannot be written', async () => {
    const account = await createAccount('log-audit-atomic');
    const path = `users/${account.user.id}/devices/${account.device.id}/diagnostics-logs`;
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_diagnostics_audit
       BEFORE INSERT ON ops_audit
       WHEN NEW.action = 'diagnostics-logs.enable'
       BEGIN SELECT RAISE(ABORT, 'TEST_AUDIT_FAILURE'); END`,
    ).run();
    expect((await admin(path, {
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }, 'PUT')).status).toBe(500);
    expect(await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM diagnostics_log_access WHERE device_id = ?',
    ).bind(account.device.id).first()).toMatchObject({ n: 0 });
  });

  it('stores a raw log segment in R2 and indexes it in D1', async () => {
    const account = await createAccount('log-happy');
    await enableDiagnosticsLogs(account);
    const body = await gzip('{"kind":"connection_opened"}\n{"kind":"mihomo_route"}\n');
    const response = await logUpload(account.accessToken, body);
    expect(response.status).toBe(201);
    const { segment } = await response.json() as any;

    const row = await env.DB.prepare(
      'SELECT * FROM diagnostics_log_objects WHERE id = ?',
    ).bind(segment.id).first() as any;
    expect(row.user_id).toBe(account.user.id);
    expect(row.sequence).toBe(0);
    expect(row.byte_size).toBe(body.byteLength);
    // The key is server-derived from the account, so a client cannot choose
    // where its own segment lands.
    expect(row.r2_key).toBe(
      `logs/${account.user.id}/${new Date(row.received_at * 1000).toISOString().slice(0, 10)}`
      + '/FE5919D3-405E-4538-9C4C-1866E088F24F-0000000.jsonl.gz',
    );
    const stored = await (env as unknown as Env).DIAGNOSTICS_LOGS.get(row.r2_key);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(body);
  });

  it('answers a replayed segment from the index instead of storing it twice', async () => {
    const account = await createAccount('log-replay');
    await enableDiagnosticsLogs(account);
    const first = await logUpload(account.accessToken, await gzip('{"a":1}\n'));
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as any).segment.id;

    // A client that lost its cursor re-sends the same sequence with different
    // bytes. The stored object must not be replaced, or triage would see a
    // segment whose content no longer matches what the first upload recorded.
    const replay = await logUpload(account.accessToken, await gzip('{"different":true}\n'));
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as any).segment.id).toBe(firstId);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM diagnostics_log_objects WHERE user_id = ?',
    ).bind(account.user.id).first() as any;
    expect(count.n).toBe(1);
    const row = await env.DB.prepare(
      'SELECT r2_key FROM diagnostics_log_objects WHERE id = ?',
    ).bind(firstId).first() as any;
    // Decompress before asserting. Reading the object as text compares gzip
    // bytes, in which no plaintext marker ever appears — an assertion that
    // passes whether or not the replay overwrote the segment.
    const stored = await (env as unknown as Env).DIAGNOSTICS_LOGS.get(row.r2_key);
    const text = await gunzip(await stored!.arrayBuffer());
    expect(text).toContain('"a":1');
    expect(text).not.toContain('different');
  });

  it('refuses a log body that is not gzip', async () => {
    const account = await createAccount('log-plaintext');
    await enableDiagnosticsLogs(account);
    const response = await logUpload(
      account.accessToken,
      new TextEncoder().encode('{"kind":"connection_opened"}\n'),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toBe('Expected a gzip body');
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM diagnostics_log_objects',
    ).first() as any;
    expect(count.n).toBe(0);
  });

  it('refuses log metadata that could escape the derived object key', async () => {
    const account = await createAccount('log-key-escape');
    await enableDiagnosticsLogs(account);
    const body = await gzip('{"a":1}\n');
    for (const session of ['../../etc/passwd', 'a/b', 'has space', '']) {
      const response = await logUpload(account.accessToken, body, {
        'X-Tono-Log-Session': session,
      });
      expect(response.status).toBe(400);
    }
    expect(((await logUpload(account.accessToken, body, {
      'X-Tono-Log-Sequence': '-1',
    })).status)).toBe(400);
    expect(((await logUpload(account.accessToken, body, {
      'X-Tono-Log-Sequence': '1e3',
    })).status)).toBe(400);
  });

  it('rejects an oversized log segment without storing a partial object', async () => {
    const account = await createAccount('log-oversize');
    await enableDiagnosticsLogs(account);
    // Incompressible bytes, so the gzip stays above the 2 MiB cap.
    const noise = new Uint8Array(new ArrayBuffer(3 * 1024 * 1024));
    crypto.getRandomValues(noise.subarray(0, 65_536));
    for (let offset = 65_536; offset < noise.byteLength; offset += 65_536) {
      noise.set(noise.subarray(0, 65_536), offset);
    }
    const body = new Uint8Array(new ArrayBuffer(noise.byteLength + 2));
    body.set([0x1f, 0x8b]);
    body.set(noise, 2);
    expect((await logUpload(account.accessToken, body)).status).toBe(413);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM diagnostics_log_objects',
    ).first() as any;
    expect(count.n).toBe(0);
  });

  it('serves a stored segment to admins and lists it per account', async () => {
    const account = await createAccount('log-admin');
    await enableDiagnosticsLogs(account);
    const body = await gzip('{"kind":"connection_opened","host":"example.test"}\n');
    const { segment } = await (await logUpload(account.accessToken, body)).json() as any;

    const listed = await admin(`diagnostics/logs?userId=${account.user.id}`, undefined, 'GET');
    expect(listed.status).toBe(200);
    const { segments } = await listed.json() as any;
    expect(segments.map((row: any) => row.id)).toEqual([segment.id]);
    expect(segments[0].byteSize).toBe(body.byteLength);
    expect(segments[0].clientVersion).toBe('0.0.63');

    const download = await admin(`diagnostics/logs/${segment.id}`, undefined, 'GET');
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/gzip');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(body);

    // No admin token, no payload — this bucket is the one place holding
    // unredacted hostnames.
    expect((await api(`admin/diagnostics/logs/${segment.id}`, { method: 'GET' })).status).toBe(401);
  });

  // Full cron ticks around a log upload: 0.3-0.6 s on Linux, among the slowest cases (A27).
  it('deletes the R2 payload when a log segment passes retention', async () => {
    const account = await createAccount('log-retention');
    await enableDiagnosticsLogs(account);
    const { segment } = await (await logUpload(
      account.accessToken,
      await gzip('{"a":1}\n'),
    )).json() as any;
    const row = await env.DB.prepare(
      'SELECT r2_key FROM diagnostics_log_objects WHERE id = ?',
    ).bind(segment.id).first() as any;

    const inside = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, inside);
    await waitOnExecutionContext(inside);
    expect(await (env as unknown as Env).DIAGNOSTICS_LOGS.get(row.r2_key)).not.toBeNull();

    // The row is immutable by trigger, so it cannot simply be aged in place.
    // Asserting that first is what keeps the replace-outright dance below from
    // quietly becoming the only reason this test passes.
    await expect(env.DB.prepare(
      'UPDATE diagnostics_log_objects SET received_at = ? WHERE id = ?',
    ).bind(Math.floor(Date.now() / 1000) - 15 * 86_400, segment.id).run())
      .rejects.toThrow(/DIAGNOSTICS_LOG_IMMUTABLE/);
    await env.DB.prepare('DELETE FROM diagnostics_log_objects WHERE id = ?')
      .bind(segment.id).run();
    await env.DB.prepare(
      `INSERT INTO diagnostics_log_objects(
         id, user_id, device_id, session_id, sequence, r2_key,
         byte_size, line_count, received_at, client_version, os_version
       ) VALUES(?, ?, NULL, 'aged', 0, ?, 10, 1, ?, '0.0.63', 'macOS 26.3')`,
    ).bind(
      segment.id,
      account.user.id,
      row.r2_key,
      Math.floor(Date.now() / 1000) - 15 * 86_400,
    ).run();

    const after = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, after);
    await waitOnExecutionContext(after);
    expect(await (env as unknown as Env).DIAGNOSTICS_LOGS.get(row.r2_key)).toBeNull();
    expect(await env.DB.prepare(
      'SELECT id FROM diagnostics_log_objects WHERE id = ?',
    ).bind(segment.id).first()).toBeNull();
  }, 15_000);

  it('deletes a raw log object whose index row was never written', async () => {
    const account = await createAccount('log-orphan');
    await enableDiagnosticsLogs(account);
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_log_index BEFORE INSERT ON diagnostics_log_objects
       BEGIN SELECT RAISE(ABORT, 'injected D1 failure'); END`,
    ).run();
    let failed: Response;
    try {
      failed = await logUpload(account.accessToken, await gzip('{"host":"secret.example"}\n'));
    } finally {
      await env.DB.prepare('DROP TRIGGER test_fail_log_index').run();
    }
    expect(failed.status).toBe(503);
    const bucket = (env as unknown as Env).DIAGNOSTICS_LOGS;
    expect((await bucket.list({ prefix: `logs/${account.user.id}/` })).objects).toHaveLength(1);

    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 86_400_000);
    try {
      const later = createExecutionContext();
      await worker.scheduled(createScheduledController(), env as unknown as Env, later);
      await waitOnExecutionContext(later);
    } finally {
      clock.mockRestore();
    }
    expect((await bucket.list({ prefix: `logs/${account.user.id}/` })).objects).toHaveLength(0);
  });

  // Two full cron ticks around a report upload: up to 0.6 s on Linux, among the slowest cases (A27).
  it('deletes diagnostics reports once they pass retention', async () => {
    const account = await createAccount('diagnostics-retention');
    const upload = await api('diagnostics/reports', json(diagnosticsPayload(), account.accessToken));
    const { referenceCode } = await upload.json() as any;

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);
    // Still inside retention.
    expect((await admin(`diagnostics/reports/${referenceCode}`, undefined, 'GET')).status).toBe(200);

    await env.DB.prepare(
      'DELETE FROM diagnostics_reports WHERE reference_code = ?',
    ).bind(referenceCode).run();
    await env.DB.prepare(
      `INSERT INTO diagnostics_reports(
         id, reference_code, user_id, received_at, client_version, os_version, report_json
       ) VALUES(?, ?, ?, ?, '2.5.4', 'Windows 11', '{}')`,
    ).bind(
      crypto.randomUUID(),
      referenceCode,
      account.user.id,
      Math.floor(Date.now() / 1000) - 31 * 86_400,
    ).run();

    const later = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, later);
    await waitOnExecutionContext(later);
    expect((await admin(`diagnostics/reports/${referenceCode}`, undefined, 'GET')).status).toBe(404);
  }, 15_000);
});
