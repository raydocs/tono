import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { runHousekeepingRetention } from '../src/retention';

const db = () => (env as unknown as { DB: D1Database }).DB;

describe('housekeeping retention batches', () => {
  it('deletes at most 500 aged diagnostic rows per pass and keeps a fresh row', async () => {
    const batch = 500;
    const t = 2_000_000_000;
    const database = db();
    const oldRows = Array.from({ length: batch + 1 }, (_, i) => database.prepare(
      `INSERT INTO client_sessions(id, user_id, started_at_ms, app_version, received_at)
       VALUES(?, 'retention-user', 1, '0.0.0', 1)`,
    ).bind(`old-${i}`));
    for (let i = 0; i < oldRows.length; i += 100) {
      await database.batch(oldRows.slice(i, i + 100));
    }
    await database.prepare(
      `INSERT INTO client_sessions(id, user_id, started_at_ms, app_version, received_at)
       VALUES('fresh', 'retention-user', 1, '0.0.0', ?)`,
    ).bind(t).run();
    await database.prepare(
      `INSERT INTO failure_clusters(
         id, group_key, code, stage, app_version, platform, node,
         event_count, user_count, device_count, first_seen_ms, last_seen_ms,
         opened_at, updated_at, status
       ) VALUES('c-old', 'g-old', 'X', 'connect', '0', 'mac', 'n', 1, 1, 1, 1, 1, 1, 1, 'open')`,
    ).run();
    await database.prepare(
      `INSERT INTO failure_cluster_members(cluster_id, user_id, device_id)
       VALUES('c-old', 'retention-user', 'd-old')`,
    ).run();

    await runHousekeepingRetention(env as unknown as Env, t);

    const aged = await database.prepare(
      `SELECT COUNT(*) AS c FROM client_sessions WHERE id LIKE 'old-%'`,
    ).first<{ c: number }>();
    const fresh = await database.prepare(
      `SELECT COUNT(*) AS c FROM client_sessions WHERE id = 'fresh'`,
    ).first<{ c: number }>();
    expect(aged?.c).toBe(1);
    expect(fresh?.c).toBe(1);
    expect(await database.prepare(
      `SELECT id FROM failure_clusters WHERE id = 'c-old'`,
    ).first()).toBeNull();
    expect(await database.prepare(
      `SELECT cluster_id FROM failure_cluster_members WHERE cluster_id = 'c-old'`,
    ).first()).toBeNull();

    await runHousekeepingRetention(env as unknown as Env, t);
    const drained = await database.prepare(
      `SELECT COUNT(*) AS c FROM client_sessions WHERE id LIKE 'old-%'`,
    ).first<{ c: number }>();
    const freshAfter = await database.prepare(
      `SELECT COUNT(*) AS c FROM client_sessions WHERE id = 'fresh'`,
    ).first<{ c: number }>();
    expect(drained?.c).toBe(0);
    expect(freshAfter?.c).toBe(1);
  });
});
