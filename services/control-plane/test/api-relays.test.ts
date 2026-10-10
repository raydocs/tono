import { env } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { probeApiRelays, type RelayConnect } from '../src/api-relays';
import { recordClient } from '../src/client-identity';
import type { Env } from '../src/env';

const db = () => (env as unknown as Env).DB;

it('records a known X-Tono-Path on the device and drops an unknown one', async () => {
  // A relayed request arrives from an exit node's address, so the edge ASN
  // describes the node; the client's own word for its path is the only truth.
  const t = Math.floor(Date.now() / 1000);
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES('u-path', 'path@example.com', 'x', 'x', 'active', 0, ?, ?)`,
  ).bind(t, t).run();
  await db().prepare(
    `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
     VALUES('d-path', 'u-path', 'inst-path', 'Path Mac', 'active', ?, ?)`,
  ).bind(t, t).run();
  const call = (path: string) => recordClient(env as unknown as Env, new Request('https://test/', {
    headers: { 'x-tono-client': 'macos/0.0.76', 'x-tono-path': path },
  }), 'd-path');
  const row = () => db().prepare('SELECT client_path, client_path_at, client_version FROM devices WHERE id = ?')
    .bind('d-path').first<{ client_path: string | null; client_path_at: number | null; client_version: string }>();

  await call('relay');
  const first = await row();
  expect(first?.client_path).toBe('relay');
  expect(first?.client_path_at).toBeGreaterThanOrEqual(t);
  expect(first?.client_version).toBe('0.0.76');

  await call('carrier_pigeon');
  await call('RELAY');
  await call('relay; drop table');
  expect((await row())?.client_path).toBe('relay');

  await call('doh');
  expect((await row())?.client_path).toBe('doh');
});

it('the relay probe writes ok and failing rows through the injected connect', async () => {
  const relays = [
    { name: 'Relay Up', host: '198.51.100.1', port: 2053 },
    { name: 'Relay Down', host: '198.51.100.2', port: 2053 },
  ];
  const closed = vi.fn();
  const connect: RelayConnect = ({ hostname }) => ({
    opened: hostname === '198.51.100.1' ? Promise.resolve({}) : Promise.reject(new Error('connection refused')),
    close: async () => { closed(hostname); },
  });
  const read = () => db().prepare(
    'SELECT relay, checked_at, ok, latency_ms, error, ok_since, failing_since FROM api_relay_probes ORDER BY relay',
  ).all<Record<string, unknown>>().then((r) => r.results);

  await probeApiRelays(db(), 1_000, connect, relays);
  expect(await read()).toEqual([
    expect.objectContaining({
      relay: '198.51.100.1:2053', checked_at: 1_000, ok: 1, error: null, ok_since: 1_000, failing_since: null,
    }),
    expect.objectContaining({
      relay: '198.51.100.2:2053', checked_at: 1_000, ok: 0, latency_ms: null,
      error: 'tcp connect: connection refused', ok_since: null, failing_since: 1_000,
    }),
  ]);
  expect(closed).toHaveBeenCalledWith('198.51.100.1');

  // A second tick keeps each "since" and only moves checked_at; a hung open is
  // cut at the timeout and recorded as a failure, never thrown.
  const hung: RelayConnect = ({ hostname }) => ({
    opened: hostname === '198.51.100.1' ? new Promise(() => undefined) : Promise.reject(new Error('refused')),
    close: async () => undefined,
  });
  await probeApiRelays(db(), 1_300, hung, relays, 20);
  expect(await read()).toEqual([
    expect.objectContaining({
      relay: '198.51.100.1:2053', checked_at: 1_300, ok: 0, ok_since: null, failing_since: 1_300,
      error: 'tcp connect: timed out after 20 ms',
    }),
    expect.objectContaining({ relay: '198.51.100.2:2053', checked_at: 1_300, ok: 0, failing_since: 1_000 }),
  ]);
});
