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
  MGMT_ID,
  tailscaleRequests,
  mockInventory,
  resetMockInventory,
  createAccount,
  emailSignIn,
  confirm,
  nextSequence,
  failNext,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  // Two cron ticks over 40 mocked Tailscale DELETEs: slowest worker case (0.6-0.7 s on Linux), and it hit the 5 s default in a deploy run (A27).
  it('rotates failed revocations so a full failing batch cannot starve newer jobs', async () => {
    const originalFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
    const attempts: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.method === 'DELETE') {
        const node = new URL(request.url).pathname.split('/').pop()!;
        attempts.push(node);
        if (node.startsWith('poison-')) return new Response('upstream failure', { status: 500 });
      }
      return originalFetch(input, init);
    });
    try {
      await env.DB.batch(Array.from({ length: 41 }, (_, index) => env.DB.prepare(
        `INSERT INTO revocation_jobs(id, device_id, tailscale_node_id, created_at)
         VALUES(?, ?, ?, ?)`,
      ).bind(`fair-${index}`, `missing-${index}`, index < 40 ? `poison-${index}` : 'healthy-newer', index)));
      const tick = async () => {
        const context = createExecutionContext();
        await worker.scheduled(createScheduledController(), env as unknown as Env, context);
        await waitOnExecutionContext(context);
      };
      await tick();
      expect(attempts).toHaveLength(40);
      expect(attempts).not.toContain('healthy-newer');
      attempts.length = 0;
      await tick();
      expect(attempts).toHaveLength(40);
      expect(attempts[0]).toBe('healthy-newer');
      const healthy = await env.DB.prepare(
        "SELECT completed_at, last_error FROM revocation_jobs WHERE id = 'fair-40'",
      ).first<any>();
      expect(healthy.completed_at).toBeTypeOf('number');
      expect(healthy.last_error).toBeNull();
      expect(await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM revocation_jobs WHERE completed_at IS NULL',
      ).first<any>()).toMatchObject({ count: 40 });
    } finally {
      fetchSpy.mockImplementation(originalFetch);
    }
  }, 15_000);

  it('deletes a queued tailnet node on the cron tick while enrollment is paused', async () => {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = 'false';
    await env.DB.prepare(
      `INSERT INTO revocation_jobs(id, device_id, tailscale_node_id, created_at, reason)
       VALUES('paused-job', 'gone-device', 'paused-node', 1, 'device_revoked')`,
    ).run();
    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);
    expect(tailscaleRequests.some((request) =>
      request.startsWith('DELETE ') && request.includes('/device/paused-node'),
    )).toBe(true);
    const job = await env.DB.prepare(
      "SELECT completed_at FROM revocation_jobs WHERE id = 'paused-job'",
    ).first<any>();
    expect(job.completed_at).toBeTypeOf('number');
  });

  // A sign-in plus a cron tick over 40 mocked Tailscale DELETEs: 0.45-0.5 s on Linux, among the slowest cases (A27).
  it('reopens a revocation job with a fresh attempt stamp so failing work cannot delay it', async () => {
    const originalFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
    const attempts: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.method === 'DELETE') {
        const node = new URL(request.url).pathname.split('/').pop()!;
        attempts.push(node);
        if (node.startsWith('poison-')) return new Response('upstream failure', { status: 500 });
      }
      return originalFetch(input, init);
    });
    try {
      const account = await createAccount('reopen-fairness');
      const t = Math.floor(Date.now() / 1000);
      // This node was revoked before: the completed job keeps the stamp of that
      // attempt, and a full batch of failing jobs was attempted around it.
      await env.DB.prepare(
        `INSERT INTO revocation_jobs(
           id, device_id, tailscale_node_id, created_at, last_attempt_at, completed_at, reason
         ) VALUES('reopen-prior', ?, ?, ?, ?, ?, 'device_revoked')`,
      ).bind(account.device.id, MGMT_ID, t - 100, t, t).run();
      await env.DB.batch(Array.from({ length: 40 }, (_, index) => env.DB.prepare(
        `INSERT INTO revocation_jobs(id, device_id, tailscale_node_id, created_at, last_attempt_at)
         VALUES(?, ?, ?, ?, ?)`,
      ).bind(`reopen-fair-${index}`, `missing-${index}`, `poison-${index}`, index, t)));

      // The login path (expirePending) reopens the completed job without
      // processing it, so the inherited stamp is observable before any attempt.
      await env.DB.prepare(
        `UPDATE devices SET tailscale_node_id = ?, pending_expires_at = ?, status = 'pending' WHERE id = ?`,
      ).bind(MGMT_ID, t - 10, account.device.id).run();
      const login = await emailSignIn({
        email: account.email,
        deviceName: 'Primary Mac',
        installationId: 'reopen-fairness-installation-one',
      });
      expect(login.status).toBe(409);
      const reopened = await env.DB.prepare(
        "SELECT last_attempt_at FROM revocation_jobs WHERE id = 'reopen-prior'",
      ).first<any>();
      expect(reopened.last_attempt_at).toBe(0);

      const context = createExecutionContext();
      await worker.scheduled(createScheduledController(), env as unknown as Env, context);
      await waitOnExecutionContext(context);
      expect(attempts).toContain(MGMT_ID);
      expect(attempts.indexOf(MGMT_ID)).toBeLessThan(attempts.indexOf('poison-0'));
      const done = await env.DB.prepare(
        "SELECT completed_at, last_error FROM revocation_jobs WHERE id = 'reopen-prior'",
      ).first<any>();
      expect(done.completed_at).toBeTypeOf('number');
      expect(done.last_error).toBeNull();
    } finally {
      fetchSpy.mockImplementation(originalFetch);
    }
  }, 15_000);

  // Four full cron ticks across 45 seeded users: 0.5-0.6 s on Linux, among the slowest cases (A27).
  it('keeps cron enforcement cost flat as already-enforced users accumulate', async () => {
    const tick = async () => {
      let prepares = 0;
      const base = env as unknown as Env;
      const DB = new Proxy(base.DB, {
        get(target, prop, receiver) {
          if (prop === 'prepare') {
            return (...args: Parameters<D1Database['prepare']>) => {
              prepares += 1;
              return target.prepare(...args);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
      const context = createExecutionContext();
      await worker.scheduled(createScheduledController(), { ...base, DB }, context);
      await waitOnExecutionContext(context);
      return prepares;
    };
    // Disabled long ago: no live device, no unrevoked session, nothing to revoke.
    const seedEnforced = async (prefix: string, count: number) => {
      const t = Math.floor(Date.now() / 1000);
      await env.DB.batch(Array.from({ length: count }, (_, index) => env.DB.prepare(
        `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
         VALUES(?, ?, 'x', 'x', 'disabled', 0, ?, ?)`,
      ).bind(`${prefix}-${index}`, `${prefix}-${index}@example.com`, t, t)));
    };
    await seedEnforced('enforced-early', 5);
    await tick();
    const baseline = await tick();
    await seedEnforced('enforced-later', 40);
    expect(await tick()).toBe(baseline);

    // A user who just lost eligibility and still holds a device is enforced.
    const account = await createAccount('cron-enforce-live');
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .bind(account.user.id).run();
    await tick();
    expect(await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
      .bind(account.device.id).first<any>()).toMatchObject({ status: 'revoked' });
  }, 15_000);

  it('processes durable revocations before retention housekeeping can fail', async () => {
    const account = await createAccount('revocation-before-retention');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);

    // Leave the outbox pending after the request path's immediate attempt.
    failNext('delete');
    const disabled = await admin(`users/${account.user.id}`, { status: 'disabled' }, 'PATCH');
    expect(disabled.status).toBe(200);
    const pending = await env.DB.prepare(
      'SELECT id, completed_at FROM revocation_jobs WHERE device_id = ?',
    ).bind(account.device.id).first<any>();
    expect(pending).toBeTruthy();
    expect(pending.completed_at).toBeNull();

    // Force the first retention statement to abort. Security enforcement must
    // already have retried the durable deletion when this failure surfaces, and
    // the retention steps after it must still run.
    await env.DB.prepare(
      "INSERT INTO rate_limits(key, count, window_start) VALUES('force-retention-failure', 1, 0)",
    ).run();
    const longRevoked = Math.floor(Date.now() / 1000) - 2 * 86_400;
    await env.DB.prepare(
      `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, revoked_at, created_at)
       VALUES('retention-after-failure', ?, 'retention-after-failure', ?, ?, ?)`,
    ).bind(account.user.id, longRevoked, longRevoked, longRevoked).run();
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_retention
       BEFORE DELETE ON rate_limits
       BEGIN
         SELECT RAISE(ABORT, 'TEST_RETENTION_FAILURE');
       END`,
    ).run();
    try {
      const context = createExecutionContext();
      await worker.scheduled(createScheduledController(), env as unknown as Env, context);
      await waitOnExecutionContext(context);

      const completed = await env.DB.prepare(
        'SELECT completed_at, last_error FROM revocation_jobs WHERE id = ?',
      ).bind(pending.id).first<any>();
      expect(completed.completed_at).toBeTypeOf('number');
      expect(completed.last_error).toBeNull();
      expect(mockInventory.some((device) => device.id === MGMT_ID)).toBe(false);
      expect(await env.DB.prepare("SELECT id FROM sessions WHERE id = 'retention-after-failure'")
        .first()).toBeNull();
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_retention').run();
    }
  });

  it('scheduled cleanup revokes superseded pending enrollment hostnames', async () => {
    const account = await createAccount('stale-enrollment');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    mockInventory.push({
      id: 'mgmt-superseded',
      nodeId: 'nodeid-superseded',
      name: 'tono-ffffffffffffffffffffffffffffffff',
      nodeKey: 'nodekey:public-key-superseded',
      addresses: ['100.64.0.99'],
      tags: ['tag:pending-tunnel-client'],
      description: `tono-device-${account.device.id}`,
    });

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);

    expect(tailscaleRequests.some((request) =>
      request.startsWith('DELETE ') && request.includes('/device/mgmt-superseded'),
    )).toBe(true);
    expect(tailscaleRequests.some((request) =>
      request.startsWith('DELETE ') && request.includes(`/device/${MGMT_ID}`),
    )).toBe(false);
  });

  it('disables access and revokes the active tailnet device', async () => {
    const account = await createAccount('disabled');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    const response = await admin(`users/${account.user.id}`, { status: 'disabled' }, 'PATCH');
    expect(response.status).toBe(200);
    expect((await api('me', { headers: { authorization: `Bearer ${account.accessToken}` } })).status).toBe(401);
    expect((await api('auth/refresh', json({ refreshToken: account.refreshToken }))).status).toBe(401);
    const device = await env.DB.prepare('SELECT status FROM devices WHERE id=?').bind(account.device.id).first<any>();
    expect(device.status).toBe('revoked');
    const job = await env.DB.prepare('SELECT completed_at FROM revocation_jobs WHERE device_id=?').bind(account.device.id).first<any>();
    expect(job.completed_at).toBeTypeOf('number');
  });

  it('refuses to re-enable a user if a prior disable left a live device without an outbox job', async () => {
    const account = await createAccount('reenable-invariant');
    // Simulate an invocation ending immediately after the user status write,
    // before enforceUser could transition the pending device and create jobs.
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .bind(account.user.id).run();
    const response = await admin(`users/${account.user.id}`, { status: 'active' }, 'PATCH');
    expect(response.status).toBe(409);
    expect((await response.json() as any).error.code).toBe('REVOCATION_PENDING');
    const user = await env.DB.prepare('SELECT status FROM users WHERE id = ?')
      .bind(account.user.id).first<any>();
    expect(user.status).toBe('disabled');
  });

  // Eight fetch+waitUntil hops (sign-in, confirm, re-enroll, second sign-in).
  // After the rest of this file has run, miniflare+D1 can push that past Vitest's
  // 5s default; CI then reports a timeout though the contract still holds.
  it('only lets the bound installation re-enroll its active device', async () => {
    const account = await createAccount('reenroll');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    // Re-enroll needs inventory for any subsequent confirm; enrollment issues a key
    const own = await api(`devices/${account.device.id}/enrollment`, json({
      installationId: 'reenroll-installation-one',
    }, account.accessToken));
    expect(own.status).toBe(200);
    expect((await own.json() as any).enrollment.authKey).toMatch(/^tskey-mock-/);

    const other = await emailSignIn({
      email: account.email,
      deviceName: 'Other Mac',
      installationId: 'reenroll-installation-two',
    });
    expect(other.status).toBe(200);
    const otherAuth = await other.json() as any;
    expect((await api(`devices/${account.device.id}/enrollment`, json({}, otherAuth.accessToken))).status).toBe(404);
  }, 15_000);

  it('does not issue a replacement enrollment while the prior identity revocation is pending', async () => {
    const account = await createAccount('reenroll-revoke-failure');
    resetMockInventory(account.device.id, account.enrollment.hostname);
    expect((await confirm(account)).status).toBe(200);
    const keyRequestsBefore = tailscaleRequests.filter(
      (request) => request.startsWith('POST ') && request.includes('/keys'),
    ).length;

    failNext('delete');
    const blocked = await api(`devices/${account.device.id}/enrollment`, json({
      installationId: 'reenroll-revoke-failure-installation-one',
    }, account.accessToken));
    expect(blocked.status).toBe(409);
    expect((await blocked.json() as any).error.code).toBe('REVOCATION_PENDING');
    expect(tailscaleRequests.filter(
      (request) => request.startsWith('POST ') && request.includes('/keys'),
    )).toHaveLength(keyRequestsBefore);

    const pendingJob = await env.DB.prepare(
      'SELECT completed_at FROM revocation_jobs WHERE device_id = ? AND tailscale_node_id = ?',
    ).bind(account.device.id, MGMT_ID).first<any>();
    expect(pendingJob).toBeTruthy();
    expect(pendingJob.completed_at).toBeNull();

    const context = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, context);
    await waitOnExecutionContext(context);

    const retry = await api(`devices/${account.device.id}/enrollment`, json({
      installationId: 'reenroll-revoke-failure-installation-one',
    }, account.accessToken));
    expect(retry.status).toBe(200);
    expect((await retry.json() as any).enrollment.authKey).toMatch(/^tskey-mock-/);
  });

  it('releases the enrollment lease after a transient key-issuance failure', async () => {
    const email = `key-retry-${nextSequence()}@example.com`;
    failNext('keyIssue');
    const redeem = await emailSignIn({
      email,
      deviceName: 'Primary Mac',
      installationId: 'key-retry-installation-one',
    });
    expect(redeem.status).toBe(502);

    const login = await emailSignIn({
      email,
      deviceName: 'Primary Mac',
      installationId: 'key-retry-installation-one',
    });
    expect(login.status).toBe(200);
    expect((await login.json() as any).enrollment.authKey).toMatch(/^tskey-mock-/);
  });
});
