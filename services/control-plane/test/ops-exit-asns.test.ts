import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jwtSign, sha256 } from '../src/crypto';
import worker, { type Env } from '../src/index';
import {
  loadKnownExitAsns,
  resetKnownExitAsnsCache,
  upsertExitAsn,
} from '../src/ops/exit-asns';

const JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
const EXIT_ID = 'exit-default';
const EXIT_NAME = 'Test exit-default';
const EXIT_TOKEN = 'exit-default-token-with-at-least-32-characters';
const db = () => (env as unknown as Env).DB;

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://test/api/v1/${path}`, init),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const json = (value: unknown, token: string, cf?: { asn?: number; asOrganization?: string }): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(value),
  ...(cf ? { cf } : {}),
});

async function seedAccount(prefix: string) {
  const t = Math.floor(Date.now() / 1000);
  const userId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'x', 'active', 0, ?, ?)`,
  ).bind(userId, `${prefix}@example.com`, t, t).run();
  await db().prepare(
    `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
     VALUES(?, ?, ?, 'Test', 'active', ?, ?)`,
  ).bind(deviceId, userId, `${prefix}-install`, t, t).run();
  await db().prepare(
    `INSERT INTO sessions(id, user_id, refresh_hash, expires_at, created_at, device_id)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, userId, `h-${sessionId}`, t + 86_400, t, deviceId).run();
  const token = await jwtSign({ sub: userId, sid: sessionId, exp: t + 3600 }, JWT_SECRET);
  return { userId, deviceId, token };
}

function telemetryWindow() {
  const nowMs = Date.now();
  return {
    window: {
      schemaVersion: 1,
      kind: 'periodic_window',
      windowStartMs: nowMs - 20 * 60 * 1000,
      windowEndMs: nowMs,
      appVersion: '0.0.72',
      osVersion: 'Windows 11 Pro 23H2',
      osArch: 'x86_64',
      uiState: 'connected',
      selectedServer: 'Salt Lake City · Summit',
      catalogRevision: 7,
      eventCount: 2,
      eventsDropped: 0,
      events: [
        { ts: nowMs - 60_000, kind: 'networkChange', counter: 1 },
        { ts: nowMs - 30_000, kind: 'connectOk', node: 'Salt Lake City · Summit', elapsedMs: 2100 },
      ],
    },
  };
}

async function seedExitNode() {
  const t = Math.floor(Date.now() / 1000);
  await db().prepare(
    `INSERT INTO exit_nodes(id, name, token_hash, status, last_roster_at, created_at, updated_at)
     VALUES(?, ?, ?, 'active', ?, ?, ?)`,
  ).bind(EXIT_ID, EXIT_NAME, await sha256(EXIT_TOKEN), t + 3600, t, t).run();
}

describe('ops exit ASNs', () => {
  beforeEach(async () => {
    resetKnownExitAsnsCache();
    await db().prepare('DELETE FROM ops_exit_asns').run();
    await seedExitNode();
  });

  it('upserts from an exit-agent request and updates last_seen_at only on repeat', async () => {
    const observedAt = Math.floor(Date.now() / 1000);
    const first = await api('home/roster-ack', json(
      { observedAt },
      EXIT_TOKEN,
      { asn: 64512, asOrganization: 'Tono Exit' },
    ));
    expect(first.status).toBe(200);
    const row = await db().prepare(
      'SELECT asn, as_org, node_hint, source, first_seen_at, last_seen_at FROM ops_exit_asns',
    ).first<{
      asn: number;
      as_org: string;
      node_hint: string;
      source: string;
      first_seen_at: number;
      last_seen_at: number;
    }>();
    expect(row).toMatchObject({
      asn: 64512,
      as_org: 'Tono Exit',
      node_hint: EXIT_NAME,
      source: 'exit-agent',
    });
    expect(Number(row?.first_seen_at)).toBe(Number(row?.last_seen_at));

    const later = Number(row?.last_seen_at) + 30;
    const asn = await upsertExitAsn(
      db(),
      { asn: 64512, asOrganization: 'Renamed Org' },
      'other-node',
      later,
    );
    expect(asn).toBe(64512);
    const again = await db().prepare(
      'SELECT asn, as_org, node_hint, source, first_seen_at, last_seen_at FROM ops_exit_asns',
    ).first<{
      asn: number;
      as_org: string;
      node_hint: string;
      source: string;
      first_seen_at: number;
      last_seen_at: number;
    }>();
    expect(again).toMatchObject({
      asn: 64512,
      as_org: 'Tono Exit',
      node_hint: EXIT_NAME,
      source: 'exit-agent',
      first_seen_at: row?.first_seen_at,
      last_seen_at: later,
    });
  });

  it('a telemetry window from a known exit ASN sets edge_via_exit, an unknown ASN does not', async () => {
    const observedAt = Math.floor(Date.now() / 1000);
    expect((await api('home/roster-ack', json(
      { observedAt },
      EXIT_TOKEN,
      { asn: 64512, asOrganization: 'Tono Exit' },
    ))).status).toBe(200);

    resetKnownExitAsnsCache();
    const via = await seedAccount('asn-via');
    const viaRes = await api('telemetry/windows', json(
      telemetryWindow(),
      via.token,
      { asn: 64512, asOrganization: 'Tono Exit' },
    ));
    expect(viaRes.status).toBe(201);
    const viaBody = await viaRes.json() as { id: string };
    const viaRow = await db().prepare(
      'SELECT edge_via_exit, edge_asn FROM connection_events WHERE window_id = ? LIMIT 1',
    ).bind(viaBody.id).first<{ edge_via_exit: number; edge_asn: number }>();
    expect(Number(viaRow?.edge_via_exit)).toBe(1);
    expect(Number(viaRow?.edge_asn)).toBe(64512);

    const other = await seedAccount('asn-other');
    const otherRes = await api('telemetry/windows', json(
      telemetryWindow(),
      other.token,
      { asn: 64513, asOrganization: 'Someone Else' },
    ));
    expect(otherRes.status).toBe(201);
    const otherBody = await otherRes.json() as { id: string };
    const otherRow = await db().prepare(
      'SELECT edge_via_exit, edge_asn FROM connection_events WHERE window_id = ? LIMIT 1',
    ).bind(otherBody.id).first<{ edge_via_exit: number; edge_asn: number }>();
    expect(Number(otherRow?.edge_via_exit)).toBe(0);
    expect(Number(otherRow?.edge_asn)).toBe(64513);
  });

  it('a request with no cf is a no-op, and a failing insert still returns 200', async () => {
    const observedAt = Math.floor(Date.now() / 1000);
    const missing = await api('home/roster-ack', json({ observedAt }, EXIT_TOKEN));
    expect(missing.status).toBe(200);
    const empty = await db().prepare('SELECT COUNT(*) AS c FROM ops_exit_asns').first<{ c: number }>();
    expect(Number(empty?.c)).toBe(0);

    await db().prepare(
      `CREATE TRIGGER test_fail_exit_asn BEFORE INSERT ON ops_exit_asns
       BEGIN SELECT RAISE(ABORT, 'test_fail_exit_asn'); END`,
    ).run();
    try {
      const boom = await api('home/roster-ack', json(
        { observedAt: observedAt + 1 },
        EXIT_TOKEN,
        { asn: 64512, asOrganization: 'Tono Exit' },
      ));
      expect(boom.status).toBe(200);
      const stillEmpty = await db().prepare('SELECT COUNT(*) AS c FROM ops_exit_asns').first<{ c: number }>();
      expect(Number(stillEmpty?.c)).toBe(0);
    } finally {
      await db().prepare('DROP TRIGGER IF EXISTS test_fail_exit_asn').run();
    }
  });

  it('resetKnownExitAsnsCache forces the next load to re-read D1', async () => {
    await upsertExitAsn(db(), { asn: 64512, asOrganization: 'Tono Exit' }, EXIT_NAME, 1_700_000_000);
    const first = await loadKnownExitAsns(db());
    expect(first.has(64512)).toBe(true);
    await db().prepare('DELETE FROM ops_exit_asns').run();
    const cached = await loadKnownExitAsns(db());
    expect(cached.has(64512)).toBe(true);
    resetKnownExitAsnsCache();
    const reloaded = await loadKnownExitAsns(db());
    expect(reloaded.has(64512)).toBe(false);
  });
});
