// Mobile clients send `X-Tono-Client: android/<v>` / `ios/<v>`. The parser and
// the column CHECK (0092, widened by 0103) must agree, or the stamp is either
// dropped at the header or swallowed by a failing UPDATE.
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { CLIENT_PLATFORMS, clientIdentity, recordClient } from '../src/client-identity';
import type { Env } from '../src/env';

const db = () => (env as unknown as Env).DB;
const req = (client?: string) =>
  new Request('https://api.example.com/v1/exit-catalog', client === undefined ? {} : { headers: { 'X-Tono-Client': client } });

it('accepts desktop and mobile platforms, case-insensitively', () => {
  expect([...CLIENT_PLATFORMS].sort()).toEqual(['android', 'ios', 'macos', 'windows']);
  expect(clientIdentity(req('android/1.2.3'))).toEqual({ platform: 'android', version: '1.2.3' });
  expect(clientIdentity(req('iOS/1.0.0+42'))).toEqual({ platform: 'ios', version: '1.0.0+42' });
  expect(clientIdentity(req('windows/0.0.75'))).toEqual({ platform: 'windows', version: '0.0.75' });
});

it('still reads unknown platforms and malformed values as absent', () => {
  for (const raw of ['linux/1.0', 'harmony/1.0', 'android/', 'android/v1', 'android', '/1.0', `android/${'1'.repeat(70)}`]) {
    expect(clientIdentity(req(raw)), raw).toBeNull();
  }
  expect(clientIdentity(req())).toBeNull();
});

it('0103 lets the device row hold android and ios and still refuses anything else', async () => {
  const t = Math.floor(Date.now() / 1000);
  for (const id of ['android', 'ios']) {
    await db().prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
       VALUES(?, ?, 'x', 'x', 'active', 0, ?, ?)`,
    ).bind(`u-ci-${id}`, `ci-${id}@example.com`, t, t).run();
    await db().prepare(
      `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
       VALUES(?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(`d-ci-${id}`, `u-ci-${id}`, `inst-ci-${id}`, id, t, t).run();
    await recordClient(env as unknown as Env, req(`${id}/2.0.1`), `d-ci-${id}`);
    const row = await db().prepare('SELECT client_platform, client_version FROM devices WHERE id = ?')
      .bind(`d-ci-${id}`).first();
    expect(row).toEqual({ client_platform: id, client_version: '2.0.1' });
  }
  await expect(db().prepare(`UPDATE devices SET client_platform = 'linux' WHERE id = 'd-ci-ios'`).run()).rejects.toThrow(/CHECK/i);
  const cols = await db().prepare(`SELECT name FROM pragma_table_info('devices') WHERE name LIKE 'client_platform%'`).all<{ name: string }>();
  expect(cols.results.map((c) => c.name)).toEqual(['client_platform']);
});
