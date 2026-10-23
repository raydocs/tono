import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { recordClient } from '../src/client-identity';
import type { Env } from '../src/env';

it('upgrades existing client metadata without losing device dependants or weakening the platform check', async () => {
  const db = (env as typeof env & { CLIENT_IDENTITY_MIGRATION_DB: D1Database }).CLIENT_IDENTITY_MIGRATION_DB;
  const prior = env.TEST_MIGRATIONS.filter((m) => Number.parseInt(m.name, 10) <= 102);
  const pending = env.TEST_MIGRATIONS.filter((m) => Number.parseInt(m.name, 10) > 102);
  await applyD1Migrations(db, prior);
  await db.batch([
    db.prepare(`INSERT INTO users(id, email, password_hash, password_salt, created_at, updated_at)
      VALUES('identity-desktop', 'identity-desktop@example.com', 'test', 'test', 1, 1),
            ('identity-mobile', 'identity-mobile@example.com', 'test', 'test', 1, 1)`),
    db.prepare(`INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at, client_platform, client_version)
      VALUES('identity-mac', 'identity-desktop', 'mac', 'Mac', 'active', 1, 1, 'macos', '0.0.80'),
            ('identity-win', 'identity-desktop', 'win', 'Windows', 'active', 1, 1, 'windows', '0.0.79'),
            ('identity-phone', 'identity-mobile', 'phone', 'Phone', 'active', 1, 1, NULL, NULL)`),
    db.prepare(`INSERT INTO sessions(id, user_id, device_id, refresh_hash, expires_at, created_at)
      VALUES('identity-session', 'identity-desktop', 'identity-mac', 'test-refresh-hash', 2000000000, 1)`),
    db.prepare(`INSERT INTO device_exit_credentials(device_id, user_id, client_uuid, created_at)
      VALUES('identity-mac', 'identity-desktop', '11111111-1111-4111-8111-111111111111', 1)`),
  ]);
  const snapshot = async () => ({
    devices: (await db.prepare('SELECT * FROM devices ORDER BY id').all()).results,
    sessions: (await db.prepare('SELECT * FROM sessions ORDER BY id').all()).results,
    exits: (await db.prepare('SELECT * FROM device_exit_credentials ORDER BY device_id').all()).results,
    guards: (await db.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'devices' AND type != 'table' ORDER BY type, name").all()).results,
  });
  const before = await snapshot();
  const schemaBefore = (await db.prepare('PRAGMA table_info(devices)').all()).results;
  // Exercise D1 transaction rollback after every pending migration statement.
  await expect(db.batch([
    ...pending.flatMap((m) => m.queries.map((query) => db.prepare(query))),
    db.prepare('INSERT INTO test_missing_identity_rollback_table VALUES (1)'),
  ])).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
  expect((await db.prepare('PRAGMA table_info(devices)').all()).results).toEqual(schemaBefore);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  expect(await snapshot()).toEqual(before);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  const request = new Request('https://test/api/v1/exit-catalog', { headers: { 'x-tono-client': 'android/0.0.1' } });
  await recordClient({ ...env, DB: db } as unknown as Env, request, 'identity-phone');
  expect(await db.prepare('SELECT client_platform, client_version FROM devices WHERE id = ?').bind('identity-phone').first())
    .toEqual({ client_platform: 'android', client_version: '0.0.1' });
  await expect(db.prepare("UPDATE devices SET client_platform = 'ios' WHERE id = 'identity-phone'").run()).rejects.toThrow(/CHECK constraint/);
  await expect(db.prepare("UPDATE devices SET client_platform = 'other' WHERE id = 'identity-phone'").run()).rejects.toThrow(/CHECK constraint/);
  await expect(db.prepare("UPDATE devices SET client_version = '' WHERE id = 'identity-phone'").run()).rejects.toThrow(/CHECK constraint/);
  await db.prepare("DELETE FROM users WHERE id = 'identity-desktop'").run();
  expect((await db.prepare('SELECT id FROM sessions').all()).results).toEqual([]);
  expect((await db.prepare('SELECT device_id FROM device_exit_credentials').all()).results).toEqual([]);
  expect((await db.prepare('SELECT id FROM devices').all()).results).toEqual([{ id: 'identity-phone' }]);
});
