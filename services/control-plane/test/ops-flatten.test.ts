import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  edgeAttribution,
  flattenBacklog,
  flattenWindow,
  retainConnectionDaily,
  retainConnectionEvents,
  rollupConnectionDaily,
  sniffPlatform,
  type FlattenWindowRow,
} from '../src/ops/flatten';

const db = () => (env as unknown as { DB: D1Database }).DB;

const USER = 'u-flatten';
const DEVICE = 'd-flatten';
const RECEIVED = 1_800_000_000;

function payload(
  events: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: 'periodic_window',
    windowStartMs: RECEIVED * 1000,
    windowEndMs: RECEIVED * 1000 + 60_000,
    appVersion: '0.0.72',
    osVersion: 'macOS 14.4',
    osArch: 'arm64',
    selectedServer: 'Tokyo · Fuji',
    catalogRevision: 9,
    exitDelayMs: 80,
    tcpDelayMs: 35,
    eventsDropped: 0,
    ...extra,
    eventCount: events.length,
    events,
  });
}

function windowRow(id: string, events: Array<Record<string, unknown>>, extra: Partial<FlattenWindowRow> = {}): FlattenWindowRow {
  return {
    id,
    user_id: USER,
    device_id: DEVICE,
    received_at: RECEIVED,
    client_version: '0.0.72',
    os_version: 'macOS 14.4',
    payload_json: payload(events),
    ...extra,
  };
}

async function insertWindow(row: FlattenWindowRow, startMs = RECEIVED * 1000, endMs = RECEIVED * 1000 + 60_000) {
  await db().prepare(
    `INSERT INTO telemetry_windows(
       id, user_id, device_id, received_at, window_start_ms, window_end_ms,
       client_version, os_version, payload_json
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    row.id, row.user_id, row.device_id, row.received_at, startMs, endMs,
    row.client_version, row.os_version, row.payload_json,
  ).run();
}

async function eventCount(where = ''): Promise<number> {
  const row = await db().prepare(
    `SELECT COUNT(*) AS c FROM connection_events ${where}`,
  ).first<{ c: number }>();
  return Number(row?.c ?? 0);
}

describe('sniffPlatform', () => {
  it('maps osVersion prefixes onto the five stored platforms', () => {
    expect(sniffPlatform('Windows 11')).toBe('windows');
    expect(sniffPlatform('macOS 14.4')).toBe('macos');
    expect(sniffPlatform('Mac OS X 10.15')).toBe('macos');
    expect(sniffPlatform('Linux')).toBe('linux');
    expect(sniffPlatform('Android 14')).toBe('android');
    expect(sniffPlatform('iOS 17.4')).toBe('ios');
    expect(sniffPlatform('iPadOS 17')).toBe('ios');
    expect(sniffPlatform('FreeBSD')).toBeNull();
    expect(sniffPlatform('')).toBeNull();
    expect(sniffPlatform(null)).toBeNull();
    expect(sniffPlatform(undefined)).toBeNull();
  });
});

describe('edgeAttribution', () => {
  it('copies colo/ISP fields and never an IP, flagging known exit ASNs', () => {
    const via = edgeAttribution(
      { asn: 64512, asOrganization: 'Tono Exit', country: 'JP', regionCode: '13' },
      new Set([64512]),
    );
    expect(via).toEqual({
      edge_asn: 64512,
      edge_as_org: 'Tono Exit',
      edge_country: 'JP',
      edge_region: '13',
      edge_via_exit: 1,
    });
    expect(Object.keys(via).sort()).toEqual([
      'edge_as_org', 'edge_asn', 'edge_country', 'edge_region', 'edge_via_exit',
    ]);

    const transit = edgeAttribution({ asn: '13335', asOrganization: 'Cloudflare' }, new Set([64512]));
    expect(transit.edge_asn).toBe(13335);
    expect(transit.edge_via_exit).toBe(0);

    const empty = edgeAttribution(undefined, new Set([64512]));
    expect(empty).toEqual({
      edge_asn: null, edge_as_org: null, edge_country: null, edge_region: null, edge_via_exit: 0,
    });
  });
});

describe('telemetry flatten', () => {
  beforeEach(async () => {
    await db().prepare(
      `INSERT INTO users (id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
       VALUES (?, 'flatten@example.com', 'x', 'y', 'active', 0, 1, 1)`,
    ).bind(USER).run();
  });

  it('writes a 3-event window, sniffs platform, copies window delays, and coalesces node', async () => {
    const row = windowRow('win-3', [
      { ts: RECEIVED * 1000 - 5_000, kind: 'connectBegin' },
      { ts: RECEIVED * 1000 - 4_000, kind: 'connectOk', node: 'Tokyo · Fuji', elapsedMs: 40 },
      { ts: RECEIVED * 1000 + 9_000_000_000, kind: 'nodeSwitch', from: 'Tokyo · Fuji', to: 'Seoul · Han' },
    ]);
    const edge = edgeAttribution(
      { asn: 64512, asOrganization: 'Tono Exit', country: 'JP', regionCode: '13' },
      new Set([64512]),
    );
    expect(await flattenWindow(db(), row, edge)).toBe(3);
    expect(await eventCount()).toBe(3);

    const rows = await db().prepare(
      'SELECT id, at_ms, kind, node, from_node, to_node, platform, os_arch, exit_delay_ms, tcp_delay_ms, edge_via_exit, edge_asn FROM connection_events ORDER BY id',
    ).all<Record<string, unknown>>();
    expect(rows.results.map((event) => event.id)).toEqual(['win-3:0', 'win-3:1', 'win-3:2']);
    expect(rows.results[0]).toMatchObject({
      kind: 'connectBegin',
      node: 'Tokyo · Fuji',
      platform: 'macos',
      os_arch: 'arm64',
      exit_delay_ms: 80,
      tcp_delay_ms: 35,
      edge_via_exit: 1,
      edge_asn: 64512,
    });
    expect(Number(rows.results[0].at_ms)).toBe(RECEIVED * 1000 - 5_000);
    expect(Number(rows.results[2].at_ms)).toBe(RECEIVED * 1000);
    expect(rows.results[2]).toMatchObject({
      kind: 'nodeSwitch', from_node: 'Tokyo · Fuji', to_node: 'Seoul · Han',
    });
  });

  it('keeps only flatten kinds from a 200-event window', async () => {
    const events = Array.from({ length: 200 }, (_, index) => {
      if (index === 10) return { ts: RECEIVED * 1000 + index, kind: 'connectBegin' };
      if (index === 20) return { ts: RECEIVED * 1000 + index, kind: 'connectOk', elapsedMs: 12 };
      if (index === 30) return { ts: RECEIVED * 1000 + index, kind: 'connectFail', code: 'timeout' };
      if (index === 40) return { ts: RECEIVED * 1000 + index, kind: 'healthProbeFail' };
      if (index === 50) return { ts: RECEIVED * 1000 + index, kind: 'reconnectScheduled' };
      return { ts: RECEIVED * 1000 + index, kind: 'uiTick' };
    });
    expect(await flattenWindow(db(), windowRow('win-200', events), edgeAttribution(undefined, new Set()))).toBe(5);
    expect(await eventCount()).toBe(5);
    const kinds = await db().prepare(
      'SELECT kind FROM connection_events ORDER BY id',
    ).all<{ kind: string }>();
    expect(kinds.results.map((row) => row.kind)).toEqual([
      'connectBegin', 'connectOk', 'connectFail', 'healthProbeFail', 'reconnectScheduled',
    ]);
  });

  it('writes nothing for a window with no events', async () => {
    expect(await flattenWindow(db(), windowRow('win-empty', []), edgeAttribution(undefined, new Set()))).toBe(0);
    expect(await eventCount()).toBe(0);
  });

  it('stores attemptId from window events onto connection_events', async () => {
    const row = windowRow('win-att', [
      { ts: RECEIVED * 1000, kind: 'connectFail', code: 'timeout', attemptId: 'att-flat-1' },
    ]);
    expect(await flattenWindow(db(), row, edgeAttribution(undefined, new Set()))).toBe(1);
    const stored = await db().prepare(
      'SELECT attempt_id FROM connection_events WHERE id = ?',
    ).bind('win-att:0').first<{ attempt_id: string }>();
    expect(stored?.attempt_id).toBe('att-flat-1');
  });

  it('makes re-flatten a no-op via deterministic ids', async () => {
    const row = windowRow('win-dup', [
      { ts: RECEIVED * 1000, kind: 'connectBegin' },
      { ts: RECEIVED * 1000 + 1, kind: 'connectFail', error: 'timeout' },
    ]);
    const edge = edgeAttribution(undefined, new Set());
    expect(await flattenWindow(db(), row, edge)).toBe(2);
    expect(await flattenWindow(db(), row, edge)).toBe(0);
    expect(await eventCount()).toBe(2);
    const ids = await db().prepare('SELECT id FROM connection_events ORDER BY id').all<{ id: string }>();
    expect(ids.results.map((event) => event.id)).toEqual(['win-dup:0', 'win-dup:1']);
  });

  it('advances the cursor, respects the backlog limit, and continues after it', async () => {
    for (let index = 0; index < 5; index++) {
      await insertWindow(windowRow(`win-${index}`, [
        { ts: RECEIVED * 1000 + index, kind: 'connectBegin' },
      ], { received_at: RECEIVED + index }));
    }
    const first = await flattenBacklog(db(), RECEIVED + 10, 2);
    expect(first).toEqual({ windows: 2, rows: 2 });
    const cursor = await db().prepare(
      'SELECT last_received_at, last_window_id FROM ops_flatten_cursor WHERE singleton_id = 1',
    ).first<{ last_received_at: number; last_window_id: string }>();
    expect(Number(cursor!.last_received_at)).toBe(RECEIVED + 1);
    expect(cursor!.last_window_id).toBe('win-1');

    const second = await flattenBacklog(db(), RECEIVED + 11, 2);
    expect(second).toEqual({ windows: 2, rows: 2 });
    const third = await flattenBacklog(db(), RECEIVED + 12, 2);
    expect(third).toEqual({ windows: 1, rows: 1 });
    expect(await flattenBacklog(db(), RECEIVED + 13, 2)).toEqual({ windows: 0, rows: 0 });
    expect(await eventCount()).toBe(5);
  });

  it('rolls up attempts, distinct users, and discrete p50 elapsed for a UTC day', async () => {
    await db().prepare(
      `INSERT INTO users (id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
       VALUES ('u-flatten-b', 'flatten-b@example.com', 'x', 'y', 'active', 0, 1, 1)`,
    ).run();
    const day = Math.floor(RECEIVED / 86400) * 86400;
    const elapsed = [10, 20, 30, 40, 50];
    for (const [index, value] of elapsed.entries()) {
      await flattenWindow(db(), windowRow(`win-p50-${index}`, [
        { ts: day * 1000 + 1_000 + index, kind: 'connectOk', node: 'Tokyo · Fuji', elapsedMs: value },
      ], { user_id: index < 3 ? USER : 'u-flatten-b', received_at: day + 60 }), edgeAttribution(undefined, new Set()));
    }
    await rollupConnectionDaily(db(), day + 3_600);
    const daily = await db().prepare(
      `SELECT attempts, users, p50_elapsed_ms, node, platform, kind, code
       FROM ops_connection_daily WHERE day_at = ?`,
    ).bind(day).first<Record<string, unknown>>();
    expect(daily).toMatchObject({
      attempts: 5,
      users: 2,
      p50_elapsed_ms: 30,
      node: 'Tokyo · Fuji',
      platform: 'macos',
      kind: 'connectOk',
      code: '',
    });
    await rollupConnectionDaily(db(), day);
    expect(Number((await db().prepare(
      'SELECT COUNT(*) AS c FROM ops_connection_daily',
    ).first<{ c: number }>())?.c)).toBe(1);
  });

  it('deletes expired events and daily rows up to the retain limit', async () => {
    const nowSec = RECEIVED;
    for (let index = 0; index < 4; index++) {
      await flattenWindow(db(), windowRow(`win-old-${index}`, [
        { ts: (nowSec - 40 * 86400) * 1000, kind: 'connectFail' },
      ], { received_at: nowSec - 40 * 86400 + index }), edgeAttribution(undefined, new Set()));
    }
    await flattenWindow(db(), windowRow('win-new', [
      { ts: nowSec * 1000, kind: 'connectOk' },
    ], { received_at: nowSec - 60 }), edgeAttribution(undefined, new Set()));
    expect(await retainConnectionEvents(db(), nowSec, 30, 2)).toBe(2);
    expect(await eventCount()).toBe(3);
    expect(await retainConnectionEvents(db(), nowSec, 30, 500)).toBe(2);
    expect(await eventCount()).toBe(1);
    expect(await eventCount("WHERE id LIKE 'win-new:%'")).toBe(1);

    const oldDay = Math.floor((nowSec - 500 * 86400) / 86400) * 86400;
    const keepDay = Math.floor(nowSec / 86400) * 86400;
    await db().batch([
      db().prepare(
        `INSERT INTO ops_connection_daily(day_at, node, platform, kind, code, attempts, users)
         VALUES(?, 'Tokyo · Fuji', 'macos', 'connectOk', '', 1, 1)`,
      ).bind(oldDay),
      db().prepare(
        `INSERT INTO ops_connection_daily(day_at, node, platform, kind, code, attempts, users)
         VALUES(?, 'Tokyo · Fuji', 'macos', 'connectFail', '', 1, 1)`,
      ).bind(oldDay + 86400),
      db().prepare(
        `INSERT INTO ops_connection_daily(day_at, node, platform, kind, code, attempts, users)
         VALUES(?, 'Tokyo · Fuji', 'macos', 'connectOk', '', 4, 2)`,
      ).bind(keepDay),
    ]);
    expect(await retainConnectionDaily(db(), nowSec, 400, 1)).toBe(1);
    expect(await retainConnectionDaily(db(), nowSec, 400, 500)).toBe(1);
    const remaining = await db().prepare(
      'SELECT day_at FROM ops_connection_daily',
    ).all<{ day_at: number }>();
    expect(remaining.results.map((row) => Number(row.day_at))).toEqual([keepDay]);
  });
});
