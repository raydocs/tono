import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { jwtSign, sha256 } from '../src/crypto';
import worker, { type Env } from '../src/index';
import {
  JWT_TEST_SECRET,
  api,
  json,
  admin,
  MGMT_ID,
  API_NODE_ID,
  STABLE_ID,
  TS_IPS,
  tailscaleRequests,
  mockInventory,
  resetMockInventory,
  pauseNextTagPromotion,
  createAccount,
  startEmailSignIn,
  emailSignIn,
  confirm,
  failNext,
  telemetryWindowPayload,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('redeems, confirms, logs in without duplicating an installation, rotates refresh, and limits devices', async () => {
    const first = await createAccount('lifecycle');
    resetMockInventory(first.device.id, first.enrollment.hostname);
    const refresh = await api('auth/refresh', json({ refreshToken: first.refreshToken }));
    expect(refresh.status).toBe(200);
    const rotated = await refresh.json() as any;

    const conf = await confirm({ ...first, accessToken: rotated.accessToken });
    expect(conf.status).toBe(200);
    expect(tailscaleRequests.some((r) => r.includes('/tailnet/') && r.includes('/devices'))).toBe(true);
    expect(tailscaleRequests.some((r) =>
      r.includes(`/device/${encodeURIComponent(MGMT_ID)}/tags`) && r.includes('tag:tunnel-client'),
    )).toBe(true);
    // Must not resolve via GET /device/{clientSubmittedStableId}
    expect(tailscaleRequests.some((r) => r.startsWith('GET ') && r.includes(`/device/${STABLE_ID}`))).toBe(false);

    const login = (installationId: string) => emailSignIn({
      email: first.email,
      deviceName: installationId,
      installationId,
    });
    expect((await login('lifecycle-installation-one')).status).toBe(200);
    expect((await login('lifecycle-installation-two')).status).toBe(200);
    // LRU Auto-eviction: third device logs in seamlessly and evicts the oldest active device
    expect((await login('lifecycle-installation-three')).status).toBe(200);
    const activeCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM devices WHERE user_id = ? AND status IN ('pending', 'active')"
    ).bind(first.user.id).first<any>();
    expect(activeCount.c).toBe(2);
    const count = await env.DB.prepare("SELECT count(*) n FROM devices WHERE installation_id='lifecycle-installation-one'").first<any>();
    expect(count.n).toBe(1);
  });

  it('supports an explicit per-user device allowance without changing the default', async () => {
    const account = await createAccount('expanded-device-limit');
    expect(account.user.deviceLimit).toBe(2);

    const expanded = await admin(
      `users/${account.user.id}`,
      { deviceLimit: 5 },
      'PATCH',
    );
    expect(expanded.status).toBe(200);

    const me = await api('me', {
      headers: { authorization: `Bearer ${account.accessToken}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json() as any).user.deviceLimit).toBe(5);

    const login = (suffix: string) => emailSignIn({
      email: account.email,
      deviceName: `Expanded ${suffix}`,
      installationId: `expanded-device-limit-installation-${suffix}`,
    });
    for (const suffix of ['two', 'three', 'four', 'five']) {
      expect((await login(suffix)).status).toBe(200);
    }
    // LRU Auto-eviction: sixth device logs in seamlessly and evicts the oldest active device
    const sixth = await login('six');
    expect(sixth.status).toBe(200);

    const stored = await env.DB.prepare(
      'SELECT device_limit FROM users WHERE id = ?',
    ).bind(account.user.id).first<any>();
    expect(stored.device_limit).toBe(5);

    const activeDevices = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM devices WHERE user_id = ? AND status IN ('pending', 'active')"
    ).bind(account.user.id).first<any>();
    expect(activeDevices.c).toBe(5);
  });

  it('automatically rotates and evicts the least recently seen device when limit is reached', async () => {
    const account = await createAccount('lru-rotation');
    const login = (name: string, installationId: string) => emailSignIn({
      email: account.email,
      deviceName: name,
      installationId,
    });

    // Login on device 2
    const res2 = await login('Device 2', 'installation-two');
    expect(res2.status).toBe(200);
    const dev2 = await res2.json() as any;

    // Login on device 3 (exceeds default limit of 2) -> automatically evicts device 1
    const res3 = await login('Device 3', 'installation-three');
    expect(res3.status).toBe(200);
    const dev3 = await res3.json() as any;

    // Device 1 should now be revoked
    const dev1Status = await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>();
    expect(dev1Status.status).toBe('revoked');

    // Trying to use Device 1's refresh token should now fail with 401
    const refresh1 = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(refresh1.status).toBe(401);

    // Device 2 and Device 3 should be active
    const active = await env.DB.prepare(
      "SELECT id, status FROM devices WHERE user_id = ? AND status IN ('pending', 'active')"
    ).bind(account.user.id).all<any>();
    expect(active.results.length).toBe(2);
    const activeIds = active.results.map((r: any) => r.id);
    expect(activeIds).toContain(dev2.device.id);
    expect(activeIds).toContain(dev3.device.id);
  });

  it('honours one replay of a just-rotated refresh token whose response was lost', async () => {
    const account = await createAccount('refresh-replay');
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
    const lost = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(lost.status).toBe(200);
    const undelivered = await lost.json() as any;

    const replay = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(replay.status).toBe(200);
    const recovered = await replay.json() as any;
    expect((await api('me', bearer(recovered.accessToken))).status).toBe(200);
    // One live session per chain: the successor the client never received is superseded.
    expect((await api('me', bearer(undelivered.accessToken))).status).toBe(401);
    expect((await api('auth/refresh', json({ refreshToken: undelivered.refreshToken }))).status).toBe(401);
    // A second replay is reuse, not recovery.
    expect((await api('auth/refresh', json({ refreshToken: account.refreshToken }))).status).toBe(401);

    // Outside the grace window a replay stays rejected.
    expect((await api('auth/refresh', json({ refreshToken: recovered.refreshToken }))).status).toBe(200);
    await env.DB.prepare('UPDATE sessions SET rotated_at = rotated_at - 3600 WHERE user_id = ? AND rotated_at IS NOT NULL')
      .bind(account.user.id).run();
    expect((await api('auth/refresh', json({ refreshToken: recovered.refreshToken }))).status).toBe(401);
  });

  it('revokes earlier refresh tokens on the same device at refresh, the next sign-in, and logout', async () => {
    const account = await createAccount('same-device-sessions');
    const leftoverId = `same-device-leftover-${account.user.id}`;
    await env.DB.prepare(
      `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id)
       VALUES(?, ?, ?, unixepoch() + 2592000, unixepoch(), ?)`,
    ).bind(
      leftoverId,
      account.user.id,
      await sha256(`leftover-refresh-${account.user.id}-not-a-client-token`),
      account.device.id,
    ).run();

    const rotated = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
    expect(rotated.status).toBe(200);
    const current = await rotated.json() as any;
    const leftover = await env.DB.prepare(
      'SELECT revoked_at FROM sessions WHERE id = ?',
    ).bind(leftoverId).first<any>();
    expect(leftover.revoked_at).not.toBeNull();

    // A second sign-in on a still-pending device asks for another enrollment
    // key and hits the 60s cooldown. That cooldown is not this behavior.
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = 'false';
    const again = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'same-device-sessions-installation-one',
    });
    expect(again.status).toBe(200);
    const second = await again.json() as any;
    expect(second.device.id).toBe(account.device.id);
    expect((await api('auth/refresh', json({ refreshToken: current.refreshToken }))).status).toBe(401);
    const liveOnDevice = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM sessions WHERE device_id = ? AND revoked_at IS NULL',
    ).bind(account.device.id).first<any>();
    expect(liveOnDevice.c).toBe(1);

    const other = await emailSignIn({
      email: account.email,
      deviceName: 'Other Mac',
      installationId: 'same-device-sessions-installation-two',
    });
    expect(other.status).toBe(200);
    const elsewhere = await other.json() as any;

    expect((await api('auth/logout', json({}, second.accessToken))).status).toBe(204);
    expect((await api('auth/refresh', json({ refreshToken: second.refreshToken }))).status).toBe(401);
    expect((await api('me', { headers: { authorization: `Bearer ${second.accessToken}` } })).status).toBe(401);
    expect((await api('auth/refresh', json({ refreshToken: elsewhere.refreshToken }))).status).toBe(200);
  });

  it('revokes refresh successors committed after logout authentication while preserving unrelated sessions', async () => {
    const account = await createAccount('logout-refresh-race');
    const login = await emailSignIn({
      email: account.email,
      deviceName: 'Second Mac',
      installationId: 'logout-refresh-race-installation-two',
    });
    expect(login.status).toBe(200);
    const unrelated = await login.json() as any;
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
    let recovered!: { accessToken: string; refreshToken: string };
    const base = env as unknown as Env;
    // Commit a rotation and grace replay after logout authenticates, just
    // before its revocation batch: both intermediate sessions are revoked.
    const DB = new Proxy(base.DB, {
      get(target, prop) {
        if (prop === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            const rotated = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
            expect(rotated.status).toBe(200);
            const replay = await api('auth/refresh', json({ refreshToken: account.refreshToken }));
            expect(replay.status).toBe(200);
            recovered = await replay.json();
            expect((await api('me', bearer(recovered.accessToken))).status).toBe(200);
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const context = createExecutionContext();
    const logout = await worker.fetch(
      new Request('https://test/api/v1/auth/logout', json({ refreshToken: account.refreshToken }, account.accessToken)),
      { ...base, DB },
      context,
    );
    await waitOnExecutionContext(context);
    expect(logout.status).toBe(204);
    expect((await api('me', bearer(recovered.accessToken))).status).toBe(401);
    expect((await api('auth/refresh', json({ refreshToken: recovered.refreshToken }))).status).toBe(401);
    expect((await api('me', bearer(unrelated.accessToken))).status).toBe(200);
    expect((await api('auth/refresh', json({ refreshToken: unrelated.refreshToken }))).status).toBe(200);
  });

  it('rejects a session inserted after its device was revoked', async () => {
    const account = await createAccount('late-session');
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE devices SET status = 'revoked', updated_at = unixepoch() WHERE id = ?",
      ).bind(account.device.id),
      env.DB.prepare(
        'UPDATE sessions SET revoked_at = unixepoch() WHERE device_id = ? AND revoked_at IS NULL',
      ).bind(account.device.id),
    ]);

    await expect(env.DB.prepare(
      `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id)
       VALUES(?, ?, ?, unixepoch() + 3600, unixepoch(), ?)`,
    ).bind(
      crypto.randomUUID(),
      account.user.id,
      `late-session-${crypto.randomUUID()}`,
      account.device.id,
    ).run()).rejects.toThrow('SESSION_DEVICE_INELIGIBLE');
  });

  it('returns a state-change conflict when session authorization changes during sign-in', async () => {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = 'false';
    const account = await createAccount('session-state-race');
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_session_authorization
       BEFORE INSERT ON sessions
       WHEN NEW.device_id = '${account.device.id}'
       BEGIN
         SELECT RAISE(ABORT, 'SESSION_DEVICE_INELIGIBLE');
       END`,
    ).run();

    const response = await emailSignIn({
      email: account.email,
      deviceName: 'Racing Mac',
      installationId: 'session-state-race-installation-one',
    });
    const responseBody = await response.json() as any;
    expect(response.status, JSON.stringify(responseBody)).toBe(409);
    expect(responseBody.error.code).toBe('DEVICE_AUTHORIZATION_CHANGED');
  });

  it('atomically evicts every excess device after a device-limit contraction', async () => {
    const account = await createAccount('lru-limit-contraction');
    expect((await admin(`users/${account.user.id}`, { deviceLimit: 5 }, 'PATCH')).status).toBe(200);
    for (const suffix of ['two', 'three', 'four', 'five']) {
      expect((await emailSignIn({
        email: account.email,
        deviceName: `Device ${suffix}`,
        installationId: `lru-limit-contraction-${suffix}`,
      })).status).toBe(200);
    }
    const live = await env.DB.prepare(
      "SELECT id FROM devices WHERE user_id = ? AND status IN ('pending', 'active') ORDER BY rowid",
    ).bind(account.user.id).all<any>();
    for (const [index, device] of live.results.entries()) {
      await env.DB.prepare(
        'UPDATE devices SET tailscale_node_id = ? WHERE id = ?',
      ).bind(`node-limit-contraction-${index}`, device.id).run();
    }
    // An account already over its cap (lowered before the cap took effect on
    // write) is still brought back under it by the next login.
    await env.DB.prepare('UPDATE users SET device_limit = 1 WHERE id = ?').bind(account.user.id).run();

    const replacement = await emailSignIn({
      email: account.email,
      deviceName: 'Replacement',
      installationId: 'lru-limit-contraction-replacement',
    });
    expect(replacement.status).toBe(200);
    const states = await env.DB.prepare(
      'SELECT status, COUNT(*) AS count FROM devices WHERE user_id = ? GROUP BY status',
    ).bind(account.user.id).all<any>();
    expect(Object.fromEntries(states.results.map((row: any) => [row.status, row.count])))
      .toEqual({ pending: 1, revoked: 5 });
    expect((await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM revocation_jobs WHERE reason = 'device_rotated'",
    ).first<any>()).count).toBe(5);
  });

  it('revokes the least recently seen excess devices of that account only when the device limit is lowered', async () => {
    const account = await createAccount('limit-lowered');
    const other = await createAccount('limit-lowered-other');
    expect((await admin(`users/${account.user.id}`, { deviceLimit: 5 }, 'PATCH')).status).toBe(200);
    const accessTokens = new Map<string, string>([[String(account.device.id), account.accessToken]]);
    for (const suffix of ['two', 'three', 'four', 'five']) {
      const signedIn = await emailSignIn({
        email: account.email,
        deviceName: `Device ${suffix}`,
        installationId: `limit-lowered-${suffix}`,
      });
      expect(signedIn.status).toBe(200);
      const signedInBody = await signedIn.json() as any;
      accessTokens.set(String(signedInBody.device.id), signedInBody.accessToken);
    }
    const live = (await env.DB.prepare(
      "SELECT id FROM devices WHERE user_id = ? AND status IN ('pending', 'active') ORDER BY rowid",
    ).bind(account.user.id).all<any>()).results.map((row: any) => String(row.id));
    expect(live).toHaveLength(5);
    // Last seen, oldest first: live[1], then live[2] and live[3] tied (rowid
    // breaks it), live[4], and the first-created live[0] seen most recently.
    // The other account's device is the oldest of all and must not count.
    const seen = [500, 100, 300, 300, 400];
    for (const [index, deviceId] of live.entries()) {
      await env.DB.prepare(
        'UPDATE devices SET last_seen_at = ?, created_at = 1, tailscale_node_id = ? WHERE id = ?',
      ).bind(seen[index], `node-limit-lowered-${index}`, deviceId).run();
      await env.DB.prepare(
        'INSERT OR IGNORE INTO device_exit_credentials(device_id, user_id, client_uuid, created_at) VALUES(?, ?, ?, 1)',
      ).bind(deviceId, account.user.id, crypto.randomUUID()).run();
    }
    await env.DB.prepare('UPDATE devices SET last_seen_at = 1, created_at = 1 WHERE user_id = ?')
      .bind(other.user.id).run();

    const liveIds = async (userId: string) => (await env.DB.prepare(
      "SELECT id FROM devices WHERE user_id = ? AND status IN ('pending', 'active') ORDER BY id",
    ).bind(userId).all<any>()).results.map((row: any) => String(row.id));
    const revokeAudits = async () => (await env.DB.prepare(
      "SELECT target_id FROM ops_audit WHERE action = 'device.revoke' AND actor_type = 'token_admin' ORDER BY target_id",
    ).all<any>()).results.map((row: any) => String(row.target_id));
    const otherLive = await liveIds(other.user.id);

    // An account already over a lower stored cap (set before the cap took
    // effect on write) is not evicted by raising it: 5 live, cap 1 -> 3.
    await env.DB.prepare('UPDATE users SET device_limit = 1 WHERE id = ?').bind(account.user.id).run();
    expect((await admin(`users/${account.user.id}`, { deviceLimit: 3 }, 'PATCH')).status).toBe(200);
    expect(await liveIds(account.user.id)).toEqual([...live].sort());
    expect(await revokeAudits()).toEqual([]);
    expect((await admin(`users/${account.user.id}`, { deviceLimit: 5 }, 'PATCH')).status).toBe(200);

    expect((await admin(`users/${account.user.id}`, { deviceLimit: 3 }, 'PATCH')).status).toBe(200);
    const evicted = [live[1], live[2]].sort();
    expect(await liveIds(account.user.id)).toEqual([live[0], live[3], live[4]].sort());
    expect(await liveIds(other.user.id)).toEqual(otherLive);
    expect(await revokeAudits()).toEqual(evicted);
    const jobs = await env.DB.prepare(
      "SELECT device_id FROM revocation_jobs WHERE reason = 'device_limit_lowered' ORDER BY device_id",
    ).all<any>();
    expect(jobs.results.map((row: any) => String(row.device_id))).toEqual(evicted);
    for (const deviceId of evicted) {
      expect((await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM sessions WHERE device_id = ? AND revoked_at IS NULL',
      ).bind(deviceId).first<any>()).count).toBe(0);
      expect(await env.DB.prepare('SELECT 1 FROM device_exit_credentials WHERE device_id = ?')
        .bind(deviceId).first()).toBeNull();
    }
    const meStatus = async (deviceId: string | undefined) => (await api('me', {
      headers: { authorization: `Bearer ${accessTokens.get(String(deviceId))}` },
    })).status;
    expect(await meStatus(live[1])).toBe(401);
    expect(await meStatus(live[0])).toBe(200);

    // A retry at the same cap and a raised cap revoke nothing more.
    expect((await admin(`users/${account.user.id}`, { deviceLimit: 3 }, 'PATCH')).status).toBe(200);
    expect((await admin(`users/${account.user.id}`, { deviceLimit: 5 }, 'PATCH')).status).toBe(200);
    expect(await liveIds(account.user.id)).toEqual([live[0], live[3], live[4]].sort());
    expect(await revokeAudits()).toEqual(evicted);

    // The cap and the eviction are one transaction: a failed eviction leaves
    // the previous cap and every device in place, and the request fails.
    await env.DB.prepare(
      `CREATE TRIGGER fail_limit_eviction BEFORE INSERT ON revocation_jobs
       WHEN NEW.reason = 'device_limit_lowered'
       BEGIN SELECT RAISE(ABORT, 'EVICTION_FAILED'); END`,
    ).run();
    expect((await admin(`users/${account.user.id}`, { deviceLimit: 1 }, 'PATCH')).status).toBe(500);
    await env.DB.prepare('DROP TRIGGER fail_limit_eviction').run();
    expect((await env.DB.prepare('SELECT device_limit FROM users WHERE id = ?')
      .bind(account.user.id).first<any>()).device_limit).toBe(5);
    expect(await liveIds(account.user.id)).toEqual([live[0], live[3], live[4]].sort());
  });

  it('confirm resolves via inventory with distinct IDs and stores management id', async () => {
    const account = await createAccount('three-id');
    resetMockInventory(account.device.id, account.enrollment.hostname);

    const tokenRequest = tailscaleRequests.find((request) => request.includes('/oauth/token'));
    expect(tokenRequest).toContain('scope=auth_keys+devices%3Acore');
    expect(tokenRequest).toContain('tags=tag%3Atono-controller');

    const conf = await confirm(account, { stableNodeId: STABLE_ID, nodeId: API_NODE_ID });
    expect(conf.status).toBe(200);
    const body = await conf.json() as any;
    expect(body.device.status).toBe('active');
    expect(body.device.tailscaleNodeId).toBe(MGMT_ID);
    expect(body.device.stableNodeId).toBe(STABLE_ID);
    expect(body.device.tailscaleApiNodeId).toBe(API_NODE_ID);
    expect(body.device.tailscaleIPs).toEqual(TS_IPS);
    expect(account.enrollment.hostname).toMatch(/^tono-[a-f0-9]{32}$/);

    const row = await env.DB.prepare(
      'SELECT tailscale_node_id, tailscale_stable_id, tailscale_api_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.tailscale_node_id).toBe(MGMT_ID);
    expect(row.tailscale_stable_id).toBe(STABLE_ID);
    expect(row.tailscale_api_node_id).toBe(API_NODE_ID);

    // Tags + delete paths use management id only
    expect(tailscaleRequests.some((r) => r.includes(`/device/${MGMT_ID}/tags`))).toBe(true);
    expect(tailscaleRequests.some((r) => r.includes(`/device/${API_NODE_ID}`) || r.includes(`/device/${STABLE_ID}`))).toBe(false);
  });

  it('derives device and installation identity from D1, not mutable JWT claims', async () => {
    const account = await createAccount('jwt-device-context');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    const session = await env.DB.prepare(
      'SELECT id FROM sessions WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
    ).bind(account.user.id, account.device.id).first<any>();
    const forgedClaims = await jwtSign({
      sub: account.user.id,
      sid: session.id,
      did: 'attacker-controlled-device-id',
      iid: 'attacker-controlled-installation-id',
      exp: Math.floor(Date.now() / 1000) + 60,
      }, JWT_TEST_SECRET);

    const devices = await api('devices', {
      headers: { authorization: `Bearer ${forgedClaims}` },
    });
    expect(devices.status).toBe(200);
    const listed = await devices.json() as any;
    expect(listed.devices.find((device: any) => device.id === account.device.id)?.current).toBe(true);

    const wrongDevice = await api('devices/attacker-controlled-device-id/enrollment', json({
      installationId: 'attacker-controlled-installation-id',
    }, forgedClaims));
    expect(wrongDevice.status).toBe(404);

    const confirmed = await confirm({ ...account, accessToken: forgedClaims });
    expect(confirmed.status).toBe(200);
  });

  it('concurrent confirm race: second confirm of same device gets 409; winner stays active', async () => {
    const account = await createAccount('race');
    resetMockInventory(account.device.id, account.enrollment.hostname);

    // Hold the first request at the external tag call, after its D1 claim and
    // durable guard have been written. The second request is truly concurrent.
    const gate = pauseNextTagPromotion();
    const firstRequest = confirm(account);
    await gate.started;
    const second = await confirm(account);
    expect(second.status).toBe(409);
    gate.release();
    const first = await firstRequest;
    expect(first.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT status, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.status).toBe('active');
    expect(row.tailscale_node_id).toBe(MGMT_ID);

    // Winner's node must not have been wrongfully deleted
    expect(mockInventory.some((d) => d.id === MGMT_ID)).toBe(true);
    const deleteOfWinner = tailscaleRequests.filter(
      (r) => r.startsWith('DELETE ') && r.includes(`/device/${MGMT_ID}`),
    );
    expect(deleteOfWinner.length).toBe(0);
  });

  it('does not rotate enrollment while a confirm claim is live', async () => {
    const account = await createAccount('enrollment-claim-race');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    await env.DB.prepare(
      'UPDATE devices SET enrollment_issued_at = ? WHERE id = ?',
    ).bind(Math.floor(Date.now() / 1000) - 61, account.device.id).run();
    const gate = pauseNextTagPromotion();
    const confirming = confirm(account);
    await gate.started;
    try {
      const enrollment = await api(`devices/${account.device.id}/enrollment`, json({
        installationId: 'enrollment-claim-race-installation-one',
      }, account.accessToken));
      expect(enrollment.status).toBe(429);
      const row = await env.DB.prepare(
        'SELECT enrollment_hostname FROM devices WHERE id = ?',
      ).bind(account.device.id).first<any>();
      expect(row.enrollment_hostname).toBe(account.enrollment.hostname);
    } finally {
      gate.release();
    }
    expect((await confirming).status).toBe(200);
  });

  it('second sequential claim while first holds claim returns 409 without deleting', async () => {
    const account = await createAccount('claim-race');
    resetMockInventory(account.device.id, account.enrollment.hostname);

    // Simulate an in-flight claim held by another worker
    const t = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "UPDATE devices SET claim_token = 'held-by-other', claim_expires_at = ? WHERE id = ?",
    ).bind(t + 30, account.device.id).run();

    const conf = await confirm(account);
    expect(conf.status).toBe(409);

    // Still pending, management id not stolen/deleted
    const row = await env.DB.prepare('SELECT status, tailscale_node_id FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>();
    expect(row.status).toBe('pending');
    expect(tailscaleRequests.filter((r) => r.startsWith('DELETE ')).length).toBe(0);
  });

  it('email-code verification rate limit returns 429 after threshold', async () => {
    const account = await createAccount('ratelimit');
    const started = await startEmailSignIn({
      email: account.email,
      deviceName: 'Mac',
      installationId: 'ratelimit-installation-one',
    });
    const wrongCode = started.code === '000000' ? '000001' : '000000';
    const attempt = () => api('auth/email/verify', json({
      challengeId: started.challengeId,
      code: wrongCode,
    }));

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await attempt();
      statuses.push(r.status);
      if (r.status === 429) {
        const body = await r.json() as any;
        expect(body.error.code).toBe('RATE_LIMITED');
      }
    }
    expect(statuses).toContain(429);
    // First attempts are rejected as invalid codes before the limiter closes.
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(1);
  });

  it('atomically limits parallel email-code attempts', async () => {
    const account = await createAccount('parallel-ratelimit');
    const started = await startEmailSignIn({
      email: account.email,
      deviceName: 'Mac',
      installationId: 'parallel-rate-install',
    });
    const wrongCode = started.code === '000000' ? '000001' : '000000';
    const attempts = await Promise.all(Array.from({ length: 12 }, () =>
      api('auth/email/verify', json({
        challengeId: started.challengeId,
        code: wrongCode,
      })),
    ));
    const statuses = attempts.map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(9);
  });

  it('bounds request bodies before JSON parsing', async () => {
    const response = await api('auth/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(20 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect((await response.json() as any).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a mismatched public key instead of falling back to the sole IP candidate', async () => {
    const account = await createAccount('identity-mismatch');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    const response = await confirm(account, { publicKey: 'not-the-inventory-key' });
    expect(response.status).toBe(400);
    expect(tailscaleRequests.some((request) => request.includes('/tags'))).toBe(false);
    const row = await env.DB.prepare(
      'SELECT status, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.status).toBe('pending');
    expect(row.tailscale_node_id).toBeNull();
  });

  it('binds confirm to the server-issued enrollment hostname', async () => {
    const account = await createAccount('hostname-binding');
    resetMockInventory(account.device.id, 'tono-ffffffffffffffffffffffffffffffff');
    const response = await confirm(account);
    expect(response.status).toBe(400);
    expect(tailscaleRequests.some((request) => request.includes('/tags'))).toBe(false);
    const row = await env.DB.prepare(
      'SELECT status, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.status).toBe('pending');
    expect(row.tailscale_node_id).toBeNull();
  });

  it('rejects a mismatched stable id when inventory exposes one', async () => {
    const account = await createAccount('stable-id-mismatch');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    mockInventory[0].stableNodeId = 'server-stable-id';
    const response = await confirm(account, { stableNodeId: 'different-client-stable-id' });
    expect(response.status).toBe(400);
    expect(tailscaleRequests.some((request) => request.includes('/tags'))).toBe(false);
    const row = await env.DB.prepare(
      'SELECT status, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(row.status).toBe('pending');
    expect(row.tailscale_node_id).toBeNull();
  });

  it('failed promotion compensation enqueues revocation job', async () => {
    const account = await createAccount('promo-fail');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    failNext('tagPromotion');

    const conf = await confirm(account);
    expect(conf.status).toBe(502);

    const job = await env.DB.prepare(
      'SELECT * FROM revocation_jobs WHERE tailscale_node_id = ?',
    ).bind(MGMT_ID).first<any>();
    expect(job).toBeTruthy();
    expect(job.device_id).toBe(account.device.id);
    // Best-effort process should complete the delete in mock
    expect(job.completed_at).toBeTypeOf('number');

    const device = await env.DB.prepare(
      'SELECT status, claim_token, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(device.status).toBe('pending');
    expect(device.claim_token).toBeNull();
    expect(device.tailscale_node_id).toBeNull();
  });

  it('keeps a durable deletion guard when D1 activation throws after promotion', async () => {
    const account = await createAccount('activate-fail');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_activation
       BEFORE UPDATE OF status ON devices
       WHEN NEW.status = 'active'
       BEGIN
         SELECT RAISE(ABORT, 'TEST_ACTIVATION_FAILURE');
       END`,
    ).run();
    try {
      const response = await confirm(account);
      expect(response.status).toBe(503);
      const job = await env.DB.prepare(
        'SELECT completed_at, reason FROM revocation_jobs WHERE tailscale_node_id = ?',
      ).bind(MGMT_ID).first<any>();
      expect(job).toBeTruthy();
      expect(job.reason).toBe('confirm_guard');
      expect(job.completed_at).toBeTypeOf('number');
      expect(mockInventory.some((device) => device.id === MGMT_ID)).toBe(false);
      const device = await env.DB.prepare(
        'SELECT status, tailscale_node_id, claim_token FROM devices WHERE id = ?',
      ).bind(account.device.id).first<any>();
      expect(device.status).toBe('pending');
      expect(device.tailscale_node_id).toBeNull();
      expect(device.claim_token).toBeNull();
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_activation').run();
    }
  });

  it('fences re-enrollment until an expired in-flight identity is deleted', async () => {
    const account = await createAccount('expiry-race');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    const gate = pauseNextTagPromotion();
    const confirmRequest = confirm(account);
    await gate.started;

    // The claim is in flight with its guard persisted. Expire the pending row
    // and reopen the installation through the normal login path.
    await env.DB.prepare(
      'UPDATE devices SET pending_expires_at = ? WHERE id = ?',
    ).bind(Math.floor(Date.now() / 1000) - 1, account.device.id).run();
    const login = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expiry-race-installation-one',
    });
    expect(login.status).toBe(409);
    expect((await login.json() as any).error.code).toBe('REVOCATION_PENDING');

    gate.release();
    const staleConfirm = await confirmRequest;
    expect(staleConfirm.status).toBe(409);
    const retry = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expiry-race-installation-one',
    });
    expect(retry.status).toBe(200);
    const device = await env.DB.prepare(
      'SELECT status, claim_generation, tailscale_node_id FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>();
    expect(device.status).toBe('pending');
    expect(device.tailscale_node_id).toBeNull();
    expect(mockInventory.some((candidate) => candidate.id === MGMT_ID)).toBe(false);
  });

  it('pending expire enqueues revocation when management id present', async () => {
    const account = await createAccount('expire-rev');
    const t = Math.floor(Date.now() / 1000);
    // Simulate mid-confirm: management id stored on still-pending device that is now expired
    await env.DB.prepare(
      `UPDATE devices SET tailscale_node_id = ?, pending_expires_at = ?, status = 'pending' WHERE id = ?`,
    ).bind(MGMT_ID, t - 10, account.device.id).run();

    // Login runs ensureDevice → expirePending (auth for expired pending session would 401)
    const login = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expire-rev-installation-one',
    });
    expect(login.status).toBe(409);
    expect((await login.json() as any).error.code).toBe('REVOCATION_PENDING');

    const device = await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>();
    // expirePending revokes; ensureDevice then re-opens a pending row on the same device id
    expect(['revoked', 'pending']).toContain(device.status);

    const job = await env.DB.prepare(
      'SELECT * FROM revocation_jobs WHERE device_id = ? AND tailscale_node_id = ?',
    ).bind(account.device.id, MGMT_ID).first<any>();
    expect(job).toBeTruthy();

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);
    const retry = await emailSignIn({
      email: account.email,
      deviceName: 'Primary Mac',
      installationId: 'expire-rev-installation-one',
    });
    expect(retry.status).toBe(200);
  });

  it('removes an expired pending device credential in the revocation transaction', async () => {
    const account = await createAccount('expire-device-credential');
    expect(await env.DB.prepare(
      'SELECT device_id FROM device_exit_credentials WHERE device_id = ?',
    ).bind(account.device.id).first()).not.toBeNull();
    await env.DB.prepare(
      'UPDATE devices SET pending_expires_at = ? WHERE id = ?',
    ).bind(Math.floor(Date.now() / 1000) - 1, account.device.id).run();

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);

    expect(await env.DB.prepare(
      'SELECT device_id FROM device_exit_credentials WHERE device_id = ?',
    ).bind(account.device.id).first()).toBeNull();
    expect(await env.DB.prepare(
      'SELECT status FROM devices WHERE id = ?',
    ).bind(account.device.id).first<any>()).toMatchObject({ status: 'revoked' });
  });

  describe('True LRU device eviction and last_seen_at updates', () => {
    it('uses lifecycle requests for last_seen_at and telemetry rows for activity liveness', async () => {
      const account = await createAccount('lru-test');
      resetMockInventory(account.device.id, account.enrollment.hostname);
      const conf = await confirm(account);
      expect(conf.status).toBe(200);
      const devId = account.device.id;

      // 1. Initial confirmed_at and last_seen_at are populated
      const initialDev = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?').bind(devId).first<any>();
      expect(Number(initialDev.last_seen_at)).toBeGreaterThan(0);

      // Backdate last_seen_at to simulate time passing
      const backdatedTime = Number(initialDev.last_seen_at) - 1000;
      await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(backdatedTime, devId).run();

      // 2. Active device re-login updates last_seen_at
      const reLogin = await emailSignIn({
        email: account.email,
        deviceName: 'Primary Mac',
        installationId: 'lru-test-installation-one',
      });
      expect(reLogin.status).toBe(200);
      const relogged = await reLogin.json() as any;
      const afterReLogin = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?').bind(devId).first<any>();
      expect(Number(afterReLogin.last_seen_at)).toBeGreaterThan(backdatedTime);

      // Backdate again
      await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(backdatedTime, devId).run();

      // 3. Telemetry is already an immutable, device-attributed heartbeat for
      // the activity view. It must not duplicate that write into the device LRU
      // watermark merely because another periodic window arrived.
      // Re-login revoked the first session; the new access token is the live one.
      const telRes = await api('telemetry/windows', json(telemetryWindowPayload({
        selectedServer: 'Test Node',
      }), relogged.accessToken));
      expect(telRes.status).toBe(201);
      const afterTel = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?').bind(devId).first<any>();
      expect(Number(afterTel.last_seen_at)).toBe(backdatedTime);
      expect(await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM telemetry_windows WHERE device_id = ?',
      ).bind(devId).first()).toMatchObject({ n: 1 });

      // Backdate again
      await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(backdatedTime, devId).run();

      // 4. Auth refresh update
      const refreshRes = await api('auth/refresh', json({ refreshToken: relogged.refreshToken }));
      expect(refreshRes.status).toBe(200);
      const afterRefresh = await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?').bind(devId).first<any>();
      expect(Number(afterRefresh.last_seen_at)).toBeGreaterThan(backdatedTime);
    });

    it('evicts the least recently seen device rather than oldest created device', async () => {
      const account = await createAccount('lru-evict-order');
      const devA = account.device.id;

      const login = (name: string, installationId: string) => emailSignIn({
        email: account.email,
        deviceName: name,
        installationId,
      });

      // Login on device 2
      const res2 = await login('Device 2', 'installation-order-two');
      expect(res2.status).toBe(200);
      const acc2 = await res2.json() as any;
      const devB = acc2.device.id;

      // Ensure user has deviceLimit = 2
      await env.DB.prepare('UPDATE users SET device_limit = 2 WHERE id = ?').bind(account.user.id).run();

      // Device A was created earlier than Device B.
      // But Device A was used very recently, while Device B is stale.
      const nowSec = Math.floor(Date.now() / 1000);
      await env.DB.prepare("UPDATE devices SET status = 'active', last_seen_at = ? WHERE id = ?").bind(nowSec + 100, devA).run();
      await env.DB.prepare("UPDATE devices SET status = 'active', last_seen_at = ? WHERE id = ?").bind(nowSec - 1000, devB).run();

      // Login on device 3 (exceeds limit 2)
      const res3 = await login('Device 3', 'installation-order-three');
      expect(res3.status).toBe(200);

      // Check statuses: Device B (least recently active) must be revoked, Device A remains active!
      const statusA = await env.DB.prepare('SELECT status FROM devices WHERE id = ?').bind(devA).first<any>();
      const statusB = await env.DB.prepare('SELECT status FROM devices WHERE id = ?').bind(devB).first<any>();

      expect(statusA.status).toBe('active');
      expect(statusB.status).toBe('revoked');
    });

    it('uses the immutable telemetry heartbeat for LRU without rewriting the device row', async () => {
      const account = await createAccount('lru-telemetry-order');
      const devA = account.device.id;
      const login = (name: string, installationId: string) => emailSignIn({
        email: account.email,
        deviceName: name,
        installationId,
      });
      const second = await login('Device 2', 'installation-telemetry-two');
      expect(second.status).toBe(200);
      const devB = (await second.json() as any).device.id;
      await env.DB.prepare('UPDATE users SET device_limit = 2 WHERE id = ?')
        .bind(account.user.id).run();
      const timestamp = Math.floor(Date.now() / 1000);
      await env.DB.prepare("UPDATE devices SET status = 'active', last_seen_at = ? WHERE id = ?")
        .bind(timestamp - 1_000, devA).run();
      await env.DB.prepare("UPDATE devices SET status = 'active', last_seen_at = ? WHERE id = ?")
        .bind(timestamp - 500, devB).run();

      expect((await api('telemetry/windows', json(
        telemetryWindowPayload(),
        account.accessToken,
      ))).status).toBe(201);
      expect(await env.DB.prepare('SELECT last_seen_at FROM devices WHERE id = ?')
        .bind(devA).first()).toMatchObject({ last_seen_at: timestamp - 1_000 });

      expect((await login('Device 3', 'installation-telemetry-three')).status).toBe(200);
      expect(await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
        .bind(devA).first()).toMatchObject({ status: 'active' });
      expect(await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
        .bind(devB).first()).toMatchObject({ status: 'revoked' });
    });

    it('serializes concurrent logins for the same new installation without double eviction', async () => {
      const account = await createAccount('lru-same-install-race');
      const second = await emailSignIn({
        email: account.email,
        deviceName: 'Second Mac',
        installationId: 'lru-same-install-race-two',
      });
      expect(second.status).toBe(200);

      const before = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM devices WHERE user_id = ? AND status = 'revoked'",
      ).bind(account.user.id).first<any>();
      const login = () => emailSignIn({
        email: account.email,
        deviceName: 'Racing Mac',
        installationId: 'lru-same-install-race-three',
      });
      const responses = await Promise.all([login(), login(), login(), login()]);
      const outcomes = await Promise.all(responses.map(async (response) => ({
        status: response.status,
        body: await response.clone().json(),
      })));
      expect(outcomes.some((outcome) => outcome.status === 200), JSON.stringify(outcomes)).toBe(true);
      expect(
        outcomes.every((outcome) => outcome.status === 200 || outcome.status === 429),
        JSON.stringify(outcomes),
      ).toBe(true);

      const rows = await env.DB.prepare(
        `SELECT installation_id, status FROM devices
         WHERE user_id = ? ORDER BY installation_id`,
      ).bind(account.user.id).all<any>();
      expect(rows.results.filter((row: any) => (
        row.installation_id === 'lru-same-install-race-three'
      ))).toHaveLength(1);
      expect(rows.results.filter((row: any) => (
        row.status === 'pending' || row.status === 'active'
      ))).toHaveLength(2);
      expect(rows.results.filter((row: any) => row.status === 'revoked')).toHaveLength(
        Number(before?.c ?? 0) + 1,
      );
    });
  });
});
