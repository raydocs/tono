import {
  env,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { type Env } from '../src/index';
import {
  ADMIN_TOKEN,
  HOME_TOKEN,
  EXIT_NODE_TOKENS,
  api,
  json,
  admin,
  ACCESS_ADMIN_EMAIL,
  accessAssertion,
  useWorkerHarness,
} from './worker-harness';

describe('Worker routes with D1 and mocked Tailscale', () => {
  useWorkerHarness();

  it('accepts usage from the collector under its own token, on the same rules', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_usage', 'usage@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();

    const unconfigured = await api('ops-ingest/usage', {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reports: [] }),
    });
    expect(unconfigured.status).toBe(503);

    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const headers = {
      authorization: 'Bearer collector-test-token-with-at-least-32-chars',
      'content-type': 'application/json',
    };
    const send = (reportId: string, totalBytes: number) => api('ops-ingest/usage', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reports: [{ reportId, userId: 'usr_usage', totalBytes, observedAt: seeded }],
      }),
    });

    expect((await send('usr_usage-1', 5_000)).status).toBe(200);
    const after = await (env as unknown as Env).DB.prepare(
      'SELECT usage_bytes FROM users WHERE id = ?',
    ).bind('usr_usage').first<Record<string, unknown>>();
    expect(Number(after!.usage_bytes)).toBe(5_000);
    const sourceBeforeNoops = await env.DB.prepare(
      `SELECT last_total_bytes, accumulated_bytes, observed_at, updated_at
       FROM usage_report_sources WHERE user_id = ? AND source_id = ''`,
    ).bind('usr_usage').first<any>();

    // `usage_bytes` is written with MAX(), so a replay cannot inflate it and a
    // lower figure cannot walk it back — the property the reporting agent has
    // to be built around, since over-reporting once suspends an account for
    // good.
    expect((await send('usr_usage-1', 5_000)).status).toBe(200);
    expect((await send('usr_usage-2', 1_000)).status).toBe(200);
    const settled = await (env as unknown as Env).DB.prepare(
      'SELECT usage_bytes FROM users WHERE id = ?',
    ).bind('usr_usage').first<Record<string, unknown>>();
    expect(Number(settled!.usage_bytes)).toBe(5_000);
    expect(await env.DB.prepare(
      `SELECT last_total_bytes, accumulated_bytes, observed_at, updated_at
       FROM usage_report_sources WHERE user_id = ? AND source_id = ''`,
    ).bind('usr_usage').first()).toEqual(sourceBeforeNoops);
    // The fresh lower report ID is not durable evidence: legacy MAX can never
    // consume it, so keeping it would add a D1 insert/index/delete cycle solely
    // because the collector polled an unchanged account.
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM usage_reports WHERE user_id = 'usr_usage'",
    ).first()).toMatchObject({ count: 1 });

    // Same reportId with different content is a conflict, not a silent write.
    expect((await send('usr_usage-1', 9_999)).status).toBe(409);
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('blocks unpaired legacy cutover even after quiet-window named growth', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO users(id,email,password_hash,password_salt,status,created_at,updated_at)
       VALUES('usr-handoff','handoff@example.com','h','s','active',?,?)`,
    ).bind(timestamp, timestamp).run();
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    expect((await api('ops-ingest/usage', json({ reports: [{
      reportId: 'handoff-legacy', userId: 'usr-handoff', totalBytes: 1000, observedAt: timestamp,
    }] }, 'collector-test-token-with-at-least-32-chars'))).status).toBe(200);
    for (const [index, totalBytes] of [400, 600].entries()) {
      expect((await api('home/usage', json({ reports: [{
        reportId: `handoff-named-${index}`, userId: 'usr-handoff', sourceId: 'exit-default',
        protocolVersion: 2, totalBytes, observedAt: timestamp + index,
      }] }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);
    }
    await env.DB.prepare('UPDATE exit_nodes SET metering_protocol_version = 2, metering_last_seen_at = ?')
      .bind(timestamp).run();
    await env.DB.prepare('UPDATE usage_metering_rollout SET legacy_last_seen_at = ?')
      .bind(timestamp - 1801).run();
    expect(await (await admin('usage-metering-rollout', undefined, 'GET')).json()).toMatchObject({
      canRequireV2: false, blockers: ['legacy_handoff_boundary_unavailable'],
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await admin('usage-metering-rollout', { phase: 'v2_required' }, 'POST')).status).toBe(409);
    }
    // Exercise the database race boundary and atomic baseline rollback too.
    await expect(env.DB.batch([
      env.DB.prepare(`INSERT INTO usage_metering_cutover_baselines VALUES('usr-handoff',1000,600,?)`).bind(timestamp),
      env.DB.prepare("UPDATE usage_metering_rollout SET phase = 'v2_required'"),
    ])).rejects.toThrow('USAGE_METERING_ROLLOUT_NOT_READY');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM usage_metering_cutover_baselines').first()).toMatchObject({ n: 0 });
    expect(await env.DB.prepare("SELECT phase FROM usage_metering_rollout").first()).toMatchObject({ phase: 'dual' });
    expect(await env.DB.prepare("SELECT usage_reported_bytes FROM users WHERE id = 'usr-handoff'").first()).toMatchObject({ usage_reported_bytes: 1000 });
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('exposes readiness and permits explicit v2 cutover without legacy history', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO users(id,email,password_hash,password_salt,status,usage_bytes,created_at,updated_at)
       VALUES('usr-meter-cutover','meter-cutover@example.com','h','s','active',0,?,?)`,
    ).bind(timestamp, timestamp).run();
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const legacy = (reportId: string, totalBytes: number) => api('ops-ingest/usage', json({
      reports: [{ reportId, userId: 'usr-meter-cutover', totalBytes, observedAt: timestamp }],
    }, 'collector-test-token-with-at-least-32-chars'));
    const named = (
      nodeId: keyof typeof EXIT_NODE_TOKENS,
      reportId: string,
      totalBytes: number,
      protocolVersion = 2,
      observedAt = timestamp,
    ) => api('home/usage', json({ reports: [{
      reportId,
      userId: 'usr-meter-cutover',
      sourceId: nodeId,
      protocolVersion,
      totalBytes,
      observedAt,
    }] }, EXIT_NODE_TOKENS[nodeId]));

    expect((await named('exit-default', 'meter-shadow-1', 400)).status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT usage_reported_bytes FROM users WHERE id = 'usr-meter-cutover'",
    ).first()).toMatchObject({ usage_reported_bytes: 400 });

    const blockedState = await admin('usage-metering-rollout', undefined, 'GET');
    expect(blockedState.status).toBe(200);
    expect(await blockedState.json()).toMatchObject({
      phase: 'dual',
      legacy: { sourceRows: 0, users: 0 },
      named: { sourceRows: 1, sources: 1, v2Rows: 1 },
      canRequireV2: false,
      blockers: expect.arrayContaining([
        'active_exit_without_v2_readiness',
      ]),
    });
    expect((await admin(
      'usage-metering-rollout', { phase: 'v2_required' }, 'POST',
    )).status).toBe(409);

    for (const nodeId of Object.keys(EXIT_NODE_TOKENS) as Array<keyof typeof EXIT_NODE_TOKENS>) {
      const ack = await api('home/metering-ack', json({
        meteringProtocolVersion: 2, observedAt: timestamp,
      }, EXIT_NODE_TOKENS[nodeId]));
      expect(ack.status).toBe(200);
    }
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM usage_report_sources WHERE source_id != ''",
    ).first()).toMatchObject({ count: 1 });
    expect((await api('home/metering-ack', json({
      meteringProtocolVersion: 3,
      observedAt: timestamp,
    }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(400);
    // Replaying the same observation is idempotent and does not create usage.
    expect((await api('home/metering-ack', json({
      meteringProtocolVersion: 2,
      observedAt: timestamp,
    }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);
    await env.DB.prepare(
      `UPDATE exit_nodes SET metering_last_seen_at = ? WHERE id = 'exit-default'`,
    ).bind(timestamp - 901).run();
    expect((await admin(
      'usage-metering-rollout', { phase: 'v2_required' }, 'POST',
    )).status).toBe(409);
    await expect(env.DB.prepare(
      "UPDATE usage_metering_rollout SET phase = 'v2_required' WHERE singleton_id = 1",
    ).run()).rejects.toThrow('USAGE_METERING_ROLLOUT_NOT_READY');
    expect((await api('home/metering-ack', json({
      meteringProtocolVersion: 2,
      observedAt: timestamp,
    }, EXIT_NODE_TOKENS['exit-default']))).status).toBe(200);
    const ready = await admin('usage-metering-rollout', undefined, 'GET');
    expect(await ready.json()).toMatchObject({ canRequireV2: true, blockers: [] });

    await env.DB.prepare(
      `CREATE TRIGGER test_fail_metering_audit
       BEFORE INSERT ON ops_audit
       WHEN NEW.action = 'usage-metering.require-v2'
       BEGIN SELECT RAISE(ABORT, 'TEST_METERING_AUDIT_FAILURE'); END`,
    ).run();
    expect((await admin(
      'usage-metering-rollout', { phase: 'v2_required' }, 'POST',
    )).status).toBe(500);
    expect(await env.DB.prepare(
      'SELECT phase FROM usage_metering_rollout WHERE singleton_id = 1',
    ).first()).toMatchObject({ phase: 'dual' });
    expect(await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM usage_metering_cutover_baselines',
    ).first()).toMatchObject({ count: 0 });
    await env.DB.prepare('DROP TRIGGER test_fail_metering_audit').run();

    const advanced = await admin(
      'usage-metering-rollout', { phase: 'v2_required' }, 'POST',
    );
    expect(advanced.status).toBe(200);
    expect(await advanced.json()).toMatchObject({
      phase: 'v2_required', canRequireV2: false, cutoverBaselineUsers: 1,
    });
    expect(await env.DB.prepare(
      "SELECT reported_bytes, named_bytes FROM usage_metering_cutover_baselines WHERE user_id = 'usr-meter-cutover'",
    ).first()).toMatchObject({ reported_bytes: 400, named_bytes: 400 });

    expect((await legacy('meter-legacy-after', 1_100)).status).toBe(409);
    expect((await named('exit-default', 'meter-v1-after', 450, 1, timestamp + 10)).status).toBe(409);
    expect((await named('exit-default', 'meter-v2-after', 450, 2, timestamp + 10)).status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT usage_reported_bytes FROM users WHERE id = 'usr-meter-cutover'",
    ).first()).toMatchObject({ usage_reported_bytes: 450 });

    // Retrying the phase request is idempotent: it neither moves the baseline
    // nor records a second operator transition.
    expect((await admin(
      'usage-metering-rollout', { phase: 'v2_required' }, 'POST',
    )).status).toBe(200);
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ops_audit WHERE action = 'usage-metering.require-v2'",
    ).first()).toMatchObject({ n: 1 });
    await expect(env.DB.prepare(
      `UPDATE usage_metering_rollout
       SET legacy_last_seen_at = legacy_last_seen_at + 1
       WHERE singleton_id = 1`,
    ).run()).rejects.toThrow('USAGE_METERING_V2_REQUIRED');
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('adds up the exits metering an account instead of billing the largest one', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_sources', 'sources@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    const report = (reportId: string, sourceId: string, totalBytes: number, at = seeded) =>
      api('home/usage', json({
        reports: [{
          reportId,
          userId: 'usr_sources',
          sourceId,
          protocolVersion: 2,
          totalBytes,
          observedAt: at,
        }],
      }, EXIT_NODE_TOKENS[sourceId as keyof typeof EXIT_NODE_TOKENS]));
    const counted = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes FROM users WHERE id = ?',
      ).bind('usr_sources').first<Record<string, unknown>>();
      return Number(row!.usage_bytes);
    };

    // Each exit meters only what crossed it. Folded with MAX() this account was
    // billed 500 of the 1000 it used, so it never reached a quota it had passed.
    expect((await report('src-a-1', 'exit-a', 300)).status).toBe(200);
    expect((await report('src-b-1', 'exit-b', 500)).status).toBe(200);
    expect((await report('src-c-1', 'exit-c', 200)).status).toBe(200);
    expect(await counted()).toBe(1_000);
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM usage_reports WHERE user_id = 'usr_sources'",
    ).first<any>()).toMatchObject({ count: 0 });

    // A source's figure is cumulative, so a later one replaces its own
    // predecessor rather than adding to it.
    expect((await report('src-a-2', 'exit-a', 450, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_150);

    // Replaying is what an agent does when it loses an acknowledgement, and it
    // must cost nothing.
    expect((await report('src-a-2', 'exit-a', 450, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_150);

    // A batch that arrives after a newer one is stale, not a rebuilt node.
    expect((await report('src-a-3', 'exit-a', 400, seeded + 30)).status).toBe(200);
    expect(await counted()).toBe(1_150);

    // A higher but older row is stale. Accepting it becomes unsafe once old
    // idempotency rows are pruned: after a later counter reset, replaying this
    // row would look like fresh growth and bill history twice. The exit agent
    // uses a server-anchored monotonic timestamp for legitimate growth.
    expect((await report('src-a-4', 'exit-a', 500, seeded + 30)).status).toBe(200);
    expect(await counted()).toBe(1_150);

    // Protocol-v2 idempotency is scoped by the authenticated source's monotonic
    // clock, not a D1 row per report. A random report ID collision on another
    // node therefore cannot suppress that node's legitimate growth.
    expect((await report('src-a-2', 'exit-b', 550, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_200);

    const ambiguousBatch = await api('home/usage', json({
      reports: [
        {
          reportId: 'src-a-5', userId: 'usr_sources', sourceId: 'exit-a',
          totalBytes: 550, observedAt: seeded + 90,
        },
        {
          reportId: 'src-a-6', userId: 'usr_sources', sourceId: 'exit-a',
          totalBytes: 100, observedAt: seeded + 120,
        },
      ],
    }, EXIT_NODE_TOKENS['exit-a']));
    expect(ambiguousBatch.status).toBe(400);
    expect((await ambiguousBatch.json() as any).error.code).toBe('VALIDATION_ERROR');
    expect(await counted()).toBe(1_200);

    const oversized = await api('home/usage', json({
      reports: [{
        reportId: 'src-long', userId: 'usr_sources', sourceId: 'x'.repeat(65),
        totalBytes: 1, observedAt: seeded,
      }],
    }, EXIT_NODE_TOKENS['exit-a']));
    expect(oversized.status).toBe(400);
  });

  it('does not let the shared roster token forge usage for an arbitrary source', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_shared_token', 'shared-token@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    const response = await api('home/usage', json({
      reports: [{
        reportId: 'shared-token-forgery',
        userId: 'usr_shared_token',
        sourceId: 'some-other-exit',
        totalBytes: 9_999_999,
        observedAt: seeded,
      }],
    }, HOME_TOKEN));
    expect(response.status).toBe(401);
    const stored = await env.DB.prepare(
      'SELECT usage_bytes FROM users WHERE id = ?',
    ).bind('usr_shared_token').first<any>();
    expect(Number(stored?.usage_bytes)).toBe(0);
  });

  it('carries a rebuilt exit forward, and leaves a reporter that names none on MAX', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_rebuilt', 'rebuilt@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    const report = (reportId: string, totalBytes: number, at: number, sourceId?: string) => {
      const reports = [{
        reportId, userId: 'usr_rebuilt', totalBytes, observedAt: at,
        ...(sourceId === undefined ? {} : { sourceId, protocolVersion: 2 }),
      }];
      return sourceId === undefined
        ? api('ops-ingest/usage', json(
          { reports },
          'collector-test-token-with-at-least-32-chars',
        ))
        : api('home/usage', json(
          { reports },
          EXIT_NODE_TOKENS[sourceId as keyof typeof EXIT_NODE_TOKENS],
        ));
    };
    const counted = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes FROM users WHERE id = ?',
      ).bind('usr_rebuilt').first<Record<string, unknown>>();
      return Number(row!.usage_bytes);
    };

    expect((await report('rb-1', 900, seeded, 'exit-r')).status).toBe(200);
    expect(await counted()).toBe(900);

    // The node was rebuilt and its counter starts again from zero. Under MAX the
    // account was billed nothing at all until the new counter climbed past 900;
    // taking the new figure as the total would forgive the 900 instead.
    expect((await report('rb-2', 120, seeded + 60, 'exit-r')).status).toBe(200);
    expect(await counted()).toBe(1_020);

    // The collector's aggregate overlaps the per-exit counter. In dual it stays
    // authoritative while named sources are shadowed, rather than summing both
    // and charging the same traffic twice.
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    expect((await report('rb-3', 400, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_020);
    expect((await report('rb-4', 250, seeded + 120)).status).toBe(200);
    expect(await counted()).toBe(1_020);
    expect((await report('rb-5', 600, seeded + 120)).status).toBe(200);
    expect(await counted()).toBe(1_020);
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('does not read a fallen figure sharing a timestamp as a rebuilt exit', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, created_at, updated_at)
       VALUES('usr_tied', 'tied@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    const report = (reportId: string, totalBytes: number, at: number) =>
      api('home/usage', json({
        reports: [{
          reportId,
          userId: 'usr_tied',
          sourceId: 'exit-t',
          protocolVersion: 2,
          totalBytes,
          observedAt: at,
        }],
      }, EXIT_NODE_TOKENS['exit-t']));
    const counted = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes FROM users WHERE id = ?',
      ).bind('usr_tied').first<Record<string, unknown>>();
      return Number(row!.usage_bytes);
    };

    expect((await report('tie-1', 900, seeded)).status).toBe(200);
    expect(await counted()).toBe(900);

    // A duplicate process or malformed sender can race two observations with
    // one timestamp. The lower one is not proof of a rebuild: carrying it
    // forward would bill the whole cumulative figure a second time.
    expect((await report('tie-2', 400, seeded)).status).toBe(200);
    expect(await counted()).toBe(900);

    // A rebuilt node's counter is always later than the figure it replaces.
    expect((await report('tie-3', 120, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_020);
  });

  it('does not rebill a retained report after its idempotency row is pruned', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, status,
                         usage_bytes, created_at, updated_at)
       VALUES('usr-pruned-replay', 'pruned-replay@example.com', 'h', 's', 'active', 0, ?, ?)`,
    ).bind(seeded, seeded).run();
    const send = (reportId: string, totalBytes: number, observedAt: number) =>
      api('home/usage', json({ reports: [{
        reportId,
        userId: 'usr-pruned-replay',
        sourceId: 'exit-r',
        protocolVersion: 2,
        totalBytes,
        observedAt,
      }] }, EXIT_NODE_TOKENS['exit-r']));
    const counted = async () => Number((await env.DB.prepare(
      'SELECT usage_bytes FROM users WHERE id = ?',
    ).bind('usr-pruned-replay').first<any>())?.usage_bytes);

    expect((await send('pruned-old', 900, seeded)).status).toBe(200);
    expect((await send('pruned-reset', 120, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_020);

    // Retention removes old report IDs but deliberately keeps the cumulative
    // source ledger. Replaying the old high-water row after a counter reset must
    // not look like 780 new bytes merely because its ID can be inserted again.
    await env.DB.prepare(
      "DELETE FROM usage_reports WHERE report_id = 'pruned-old'",
    ).run();
    expect((await send('pruned-old', 900, seeded)).status).toBe(200);
    expect(await counted()).toBe(1_020);
  });

  it('settles legacy clock skew once and rejects legacy growth after protocol v2', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO users(id,email,password_hash,password_salt,status,usage_bytes,created_at,updated_at)
       VALUES('usr_usage_v2','usage-v2@example.com','h','s','active',0,?,?)`,
    ).bind(seeded, seeded).run();
    const token = EXIT_NODE_TOKENS['exit-default'];
    const send = (
      reportId: string,
      totalBytes: number,
      observedAt: number,
      protocolVersion?: number,
    ) => api('home/usage', json({ reports: [{
      reportId,
      userId: 'usr_usage_v2',
      sourceId: 'exit-default',
      ...(protocolVersion === undefined ? {} : { protocolVersion }),
      totalBytes,
      observedAt,
    }] }, token));
    const counted = async () => Number((await env.DB.prepare(
      "SELECT usage_reported_bytes FROM users WHERE id = 'usr_usage_v2'",
    ).first<any>())?.usage_reported_bytes ?? -1);

    expect((await send('legacy-first', 900, seeded + 100)).status).toBe(200);
    // Old agents used their wall clock. A legitimate cumulative increase from
    // one whose clock stepped backwards must settle before the v2 cutover.
    expect((await send('legacy-skewed', 1_000, seeded + 50)).status).toBe(200);
    expect(await counted()).toBe(1_000);

    // First v2 report replaces the wall-clock watermark with its roster-derived
    // monotonic clock, even when the previous wall clock was further ahead.
    expect((await send('v2-cutover', 1_020, seeded + 60, 2)).status).toBe(200);
    expect(await counted()).toBe(1_020);

    // Delayed v1 evidence cannot move a source after v2 cutover, even if its ID
    // happens to match the v2 report (v2 does not spend a D1 row per report ID).
    expect((await send('v2-cutover', 1_020, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_020);

    // Delayed/replayed v1 evidence can never move a source after that cutover.
    expect((await send('legacy-after-v2', 5_000, seeded + 200)).status).toBe(200);
    expect(await counted()).toBe(1_020);
    expect((await send('invalid-protocol', 5_001, seeded + 201, 3)).status).toBe(400);
  });

  it('does not refold a replayed legacy v1 report after a counter reset (#816)', async () => {
    const seeded = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO users(id,email,password_hash,password_salt,status,usage_bytes,created_at,updated_at)
       VALUES('usr_v1_replay','v1-replay@example.com','h','s','active',0,?,?)`,
    ).bind(seeded, seeded).run();
    const send = (reportId: string, totalBytes: number, observedAt: number) =>
      api('home/usage', json({ reports: [{
        reportId,
        userId: 'usr_v1_replay',
        sourceId: 'exit-default',
        protocolVersion: 1,
        totalBytes,
        observedAt,
      }] }, EXIT_NODE_TOKENS['exit-default']));
    const counted = async () => Number((await env.DB.prepare(
      "SELECT usage_reported_bytes FROM users WHERE id = 'usr_v1_replay'",
    ).first<any>())?.usage_reported_bytes ?? -1);

    expect((await send('v1-high', 900, seeded)).status).toBe(200);
    expect((await send('v1-reset', 120, seeded + 60)).status).toBe(200);
    expect(await counted()).toBe(1_020);
    expect((await send('v1-high', 900, seeded)).status).toBe(200);
    expect(await counted()).toBe(1_020);
  });

  it('lets a billing cycle be reset without the next report undoing it', async () => {
    const t = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, quota_bytes, created_at, updated_at)
       VALUES('usr_cycle', 'cycle@example.com', 'h', 's', 'active', 0, 1000, ?, ?)`,
    ).bind(t, t).run();
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const headers = {
      authorization: 'Bearer collector-test-token-with-at-least-32-chars',
      'content-type': 'application/json',
    };
    const report = (reportId: string, totalBytes: number) => api('ops-ingest/usage', {
      method: 'POST',
      headers,
      body: JSON.stringify({ reports: [{ reportId, userId: 'usr_cycle', totalBytes, observedAt: t }] }),
    });
    const usage = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes, usage_reported_bytes, usage_baseline_bytes FROM users WHERE id = ?',
      ).bind('usr_cycle').first<Record<string, unknown>>();
      return {
        billed: Number(row!.usage_bytes),
        counter: Number(row!.usage_reported_bytes),
        baseline: Number(row!.usage_baseline_bytes),
      };
    };

    await report('cycle-1', 900);
    expect(await usage()).toMatchObject({ billed: 900, counter: 900, baseline: 0 });

    // A typo must not read as success. This valve exists to get a locked-out
    // customer working again; a silent no-op is discovered only by the customer.
    const typo = await api('admin/users/usr_cycle', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resetUsge: true }),
    });
    expect(typo.status).toBe(400);

    // The console's own route keeps its own fields; tightening the scripted one
    // must not start rejecting a note or a plan change.
    const consoleEdit = await api('ops/users/usr_cycle', {
      method: 'PATCH',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ notes: 'still editable' }),
    });
    expect(consoleEdit.status).toBe(200);

    const reset = await api('admin/users/usr_cycle', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resetUsage: true }),
    });
    expect(reset.status).toBe(200);
    expect(await usage()).toMatchObject({ billed: 0, counter: 900, baseline: 900 });

    // The collector never lowers its fleet-wide total, so the very next report
    // carries the pre-reset figure. Before the baseline existed, MAX() put the
    // account straight back over its quota and the reset meant nothing.
    await report('cycle-2', 950);
    expect(await usage()).toMatchObject({ billed: 50, counter: 950, baseline: 900 });

    // And the account is under quota again, which is the whole point: with no
    // way down, one over-report suspended a paying customer for good.
    const suspended = await (env as unknown as Env).DB.prepare(
      'SELECT 1 AS hit FROM users WHERE id = ? AND quota_bytes IS NOT NULL AND usage_bytes >= quota_bytes',
    ).bind('usr_cycle').first<Record<string, unknown>>();
    expect(suspended).toBeNull();
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });

  it('lets the console end a billing cycle, which is where the lockout is seen', async () => {
    // The dashboard raises 已超配额 from the console's own user list, and the
    // rollback manual names resetUsage as the remedy — but the field existed
    // only on the token-admin route, so the console could show the lockout and
    // not clear it. Every assertion here is about the console's own session.
    const t = Math.floor(Date.now() / 1000);
    await (env as unknown as Env).DB.prepare(
      `INSERT OR IGNORE INTO users(id, email, password_hash, password_salt, status,
                                   usage_bytes, quota_bytes, created_at, updated_at)
       VALUES('usr_opscycle', 'opscycle@example.com', 'h', 's', 'active', 0, 1000, ?, ?)`,
    ).bind(t, t).run();
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = 'collector-test-token-with-at-least-32-chars';
    const console_ = async (payload: unknown) => api('ops/users/usr_opscycle', {
      method: 'PATCH',
      headers: {
        'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL),
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const usage = async () => {
      const row = await (env as unknown as Env).DB.prepare(
        'SELECT usage_bytes, usage_reported_bytes, usage_baseline_bytes FROM users WHERE id = ?',
      ).bind('usr_opscycle').first<Record<string, unknown>>();
      return {
        billed: Number(row!.usage_bytes),
        counter: Number(row!.usage_reported_bytes),
        baseline: Number(row!.usage_baseline_bytes),
      };
    };
    const report = (reportId: string, totalBytes: number) => api('ops-ingest/usage', {
      method: 'POST',
      headers: {
        authorization: 'Bearer collector-test-token-with-at-least-32-chars',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reports: [{ reportId, userId: 'usr_opscycle', totalBytes, observedAt: t }] }),
    });

    await report('ops-cycle-1', 900);
    expect(await usage()).toMatchObject({ billed: 900, counter: 900, baseline: 0 });

    // A misspelling still has to fail loudly on this route too. A silent 200 on
    // the endpoint that unlocks a paying customer is discovered by the customer.
    expect((await console_({ resetUsge: true })).status).toBe(400);
    // And only `true` — nothing that could be read as "no" may pass as one.
    expect((await console_({ resetUsage: false })).status).toBe(400);
    expect(await usage()).toMatchObject({ billed: 900 });

    expect((await console_({ resetUsage: true })).status).toBe(200);
    expect(await usage()).toMatchObject({ billed: 0, counter: 900, baseline: 900 });

    // The collector's total only ever rises, so the next report re-sends the
    // pre-reset figure. The baseline is what keeps the reset from being undone.
    await report('ops-cycle-2', 950);
    expect(await usage()).toMatchObject({ billed: 50, counter: 950, baseline: 900 });

    // Ending a cycle must not disturb the fields the console already edited.
    expect((await console_({ notes: 'kept' })).status).toBe(200);
    expect(await usage()).toMatchObject({ billed: 50, baseline: 900 });
    (env as unknown as Env).OPS_COLLECTOR_TOKEN = undefined;
  });
});
