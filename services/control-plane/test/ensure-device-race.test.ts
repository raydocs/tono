import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDevice } from '../src/devices';
import type { Env } from '../src/env';

const db = () => (env as unknown as { DB: D1Database }).DB;

// Both sign-ins read "no device" before either insert. The second batch then
// hits UNIQUE (user_id, installation_id). No sleeps: the second read releases
// the first.
function dbWithLostInsertRace(database: D1Database): { db: D1Database; raced: () => boolean } {
  let reads = 0;
  let open = false;
  let overlapped = false;
  const waiters: Array<() => void> = [];
  const initial = 'SELECT * FROM devices WHERE user_id = ? AND installation_id = ?';
  const db = new Proxy(database, {
    get(target, prop, receiver) {
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          if (reads >= 2) overlapped = true;
          return target.batch(statements);
        };
      }
      if (prop !== 'prepare') {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (sql: string) => {
        const stmt = target.prepare(sql);
        if (sql !== initial) return stmt;
        const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
          get(inner, key, stmtReceiver) {
            if (key === 'bind') {
              return (...args: unknown[]) => wrap(inner.bind(...(args as [])));
            }
            if (key !== 'first') {
              const value = Reflect.get(inner, key, stmtReceiver);
              return typeof value === 'function' ? value.bind(inner) : value;
            }
            return async <T>() => {
              const row = await inner.first<T>();
              reads += 1;
              if (reads <= 2) {
                if (reads === 2) {
                  open = true;
                  for (const wake of waiters) wake();
                } else {
                  await new Promise<void>((resolve) => {
                    if (open) resolve();
                    else waiters.push(resolve);
                  });
                }
              }
              return row;
            };
          },
        }) as D1PreparedStatement;
        return wrap(stmt);
      };
    },
  });
  return { db, raced: () => overlapped };
}

async function seedUser(id: string) {
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, created_at, updated_at)
     VALUES(?, ?, 'x', 'y', 'active', 1, 1)`,
  ).bind(id, `${id}@example.com`).run();
}

describe('ensureDevice unique-conflict recovery', () => {
  const previous = (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED;

  afterEach(() => {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = previous;
  });

  async function race(userId: string, enrollment: 'true' | 'false') {
    (env as unknown as Env).TAILSCALE_ENROLLMENT_ENABLED = enrollment;
    await seedUser(userId);
    const gate = dbWithLostInsertRace(db());
    const racing = { ...(env as unknown as Env), DB: gate.db };
    const [left, right] = await Promise.all([
      ensureDevice(racing, userId, 'Left', 'inst-1'),
      ensureDevice(racing, userId, 'Right', 'inst-1'),
    ]);
    expect(gate.raced()).toBe(true);
    const devices = await db().prepare(
      `SELECT id, status FROM devices WHERE user_id = ? AND installation_id = 'inst-1'`,
    ).bind(userId).all<{ id: string; status: string }>();
    const credentials = await db().prepare(
      `SELECT device_id FROM device_exit_credentials WHERE user_id = ?`,
    ).bind(userId).all<{ device_id: string }>();
    return { left, right, devices: devices.results, credentials: credentials.results };
  }

  it('keeps one active device and its exit credential when enrollment is off', async () => {
    const result = await race('race-enroll-off', 'false');
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.status).toBe('active');
    expect(result.left.id).toBe(result.devices[0]?.id);
    expect(result.right.id).toBe(result.devices[0]?.id);
    expect(result.left.status).toBe('active');
    expect(result.right.status).toBe('active');
    expect(result.credentials.map((row) => row.device_id)).toEqual([result.devices[0]?.id]);
  });

  it('keeps the pending device and its exit credential when enrollment is on', async () => {
    const result = await race('race-enroll-on', 'true');
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.status).toBe('pending');
    expect(result.left.status).toBe('pending');
    expect(result.right.status).toBe('pending');
    expect(result.credentials.map((row) => row.device_id)).toEqual([result.devices[0]?.id]);
  });
});
