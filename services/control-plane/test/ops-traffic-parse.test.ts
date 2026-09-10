import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  etld1,
  familyForHost,
  isLikelyDomestic,
  SERVICE_FAMILIES,
  SERVICE_FAMILIES_VERSION,
} from '../src/ops/service-families';
import {
  candidateKey,
  deriveRoute,
  IP_ETLD1,
  MAX_DISTINCT_ETLD1,
  MAX_PROCESS_CHARS,
  MAX_SEGMENT_LINES,
  OTHER_ETLD1,
  parseAuditSegment,
  retainTrafficDaily,
  rollupDirectCandidates30d,
  writeParsedSegment,
} from '../src/ops/traffic-parse';

const db = () => (env as unknown as { DB: D1Database }).DB;
const TS = '2026-09-08T20:36:26.618Z';
const DAY = Math.floor(Date.parse(TS) / 86_400_000) * 86_400;
const RECEIVED = Math.floor(Date.parse(TS) / 1000);

const line = (fields: Record<string, unknown>) => JSON.stringify({
  kind: 'connection',
  timestamp: TS,
  ...fields,
});

const gzip = async (text: string): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );

const ctx = { userId: 'u-parse', deviceId: 'd-parse', receivedAt: RECEIVED };

describe('etld1 and familyForHost', () => {
  it('splits compound ccTLDs and generic last-two-labels', () => {
    expect(etld1('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(etld1('www.sina.com.cn')).toBe('sina.com.cn');
    expect(etld1('a.b.example.com')).toBe('example.com');
    expect(etld1('example.com.')).toBe('example.com');
    expect(etld1('8.8.8.8')).toBe(IP_ETLD1);
    expect(etld1('[2001:db8::1]')).toBe(IP_ETLD1);
    expect(etld1('oauth2.googleapis.com:443')).toBe('googleapis.com');
  });

  it('maps hosts onto the versioned family suffix list', () => {
    expect(SERVICE_FAMILIES_VERSION).toBe(1);
    expect(familyForHost('api.anthropic.com')).toBe('claude');
    expect(familyForHost('chat.openai.com')).toBe('chatgpt');
    expect(familyForHost('grok.x.com')).toBe('grok');
    expect(familyForHost('gemini.google.com')).toBe('gemini');
    expect(familyForHost('www.google.com')).toBe('google');
    expect(familyForHost('generativelanguage.googleapis.com')).toBe('gemini');
    expect(familyForHost('muse.ai')).toBe('meta');
    expect(familyForHost('instagram.com')).toBe('meta');
    expect(familyForHost('weixin.qq.com')).toBe('wechat');
    expect(familyForHost('work.weixin.qq.com')).toBe('wecom');
    expect(familyForHost('y.qq.com')).toBe('qq_music');
    expect(familyForHost('api.github.com')).toBe('github');
    expect(familyForHost('unknown.example')).toBe(null);
    expect(SERVICE_FAMILIES.safari).toEqual([]);
  });

  it('flags curated mainland suffixes without a lookup', () => {
    expect(isLikelyDomestic('baidu.com')).toBe(true);
    expect(isLikelyDomestic('example.cn')).toBe(true);
    expect(isLikelyDomestic('sina.com.cn')).toBe(true);
    expect(isLikelyDomestic('google.com')).toBe(false);
    expect(isLikelyDomestic(IP_ETLD1)).toBe(false);
  });
});

describe('parseAuditSegment', () => {
  it('keeps connection rows, skips other kinds, and tolerates a truncated last line', async () => {
    const jsonl = [
      line({ host: 'api.anthropic.com', process: 'Claude', route: 'Tono-Exit' }),
      JSON.stringify({ kind: 'protection_event', event: 'connect', timestamp: TS }),
      line({ host: 'oauth2.googleapis.com', process: 'Chrome', destination_port: '443', route: 'Tono-Exit' }),
      '{"kind":"connection","host":"truncated.example.com"',
    ].join('\n');
    const parsed = await parseAuditSegment(jsonl, ctx);
    expect(parsed.truncatedLine).toBe(true);
    expect(parsed.connectionRows).toBe(2);
    expect([...parsed.destinations.keys()].some((k) => k.includes('anthropic.com'))).toBe(true);
    expect([...parsed.destinations.keys()].some((k) => k.includes('googleapis.com'))).toBe(true);
    expect([...parsed.destinations.keys()].some((k) => k.includes('truncated.example.com'))).toBe(false);
    expect(parsed.services.get(`${DAY}\tclaude\tcloud`)?.sessions).toBe(1);
    expect(parsed.services.get(`${DAY}\tgoogle\tcloud`)?.sessions).toBe(1);
  });

  it('maps an IP-literal host to __ip__ and never stores the address', async () => {
    const parsed = await parseAuditSegment(
      line({ host: '203.0.113.10', process: 'WeChat', route: 'DIRECT' }),
      ctx,
    );
    expect(parsed.connectionRows).toBe(1);
    const keys = [...parsed.destinations.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(IP_ETLD1);
    expect(keys[0]).not.toContain('203.0.113.10');
  });

  it('derives residential from the home group / SOCKS5 outbound names', async () => {
    expect(deriveRoute({ route: 'Tono-Claude-Home -> Tono-Home-Residential' }, 'connection'))
      .toBe('residential');
    expect(deriveRoute({ chain: 'Tono-China-Direct', rule: 'MATCH' }, 'directDial')).toBe('direct');
    expect(deriveRoute({ route: 'REJECT' }, 'connection')).toBe('reject');
    expect(deriveRoute({ route_classification: 'BLOCKED' }, 'connection_opened')).toBe('reject');
    expect(deriveRoute({}, 'directDial')).toBe('direct');
    expect(deriveRoute({}, 'connection')).toBe('unknown');
    const parsed = await parseAuditSegment(
      line({
        host: 'claude.ai',
        process: 'Claude',
        route: 'Tono-Claude-Home -> Tono-Home-Residential',
        selected_exit: 'Home-US',
      }),
      ctx,
    );
    const key = [...parsed.destinations.keys()][0];
    expect(key).toContain('\tresidential\t');
    expect(parsed.candidates.size).toBe(0);
    expect(parsed.services.get(`${DAY}\tclaude\tresidential`)?.sessions).toBe(1);
  });

  it('records a domestic cloud host as a DIRECT candidate', async () => {
    const parsed = await parseAuditSegment(
      line({ host: 'www.baidu.com', process: 'Safari', route: 'Tono-Exit', bytes_up: 10, bytes_down: 20 }),
      ctx,
    );
    const cand = parsed.candidates.get(candidateKey(DAY, 'baidu.com'));
    expect(cand).toMatchObject({ connections: 1, bytes: 30 });
    const dest = [...parsed.destinations.values()][0];
    expect(dest.connections).toBe(1);
    expect(dest.bytesUp).toBe(10);
    expect(dest.bytesDown).toBe(20);
  });

  it('counts connections when byte counters are absent', async () => {
    const parsed = await parseAuditSegment(line({ host: 'example.com', process: 'curl' }), ctx);
    const dest = [...parsed.destinations.values()][0];
    expect(dest).toMatchObject({ connections: 1, bytesUp: 0, bytesDown: 0 });
  });

  it('overflows distinct etld1 past the cap into __other__', async () => {
    const rows = Array.from({ length: MAX_DISTINCT_ETLD1 + 1 }, (_, i) =>
      line({ host: `h${i}.n${i}.test` }),
    );
    const parsed = await parseAuditSegment(rows.join('\n'), ctx);
    expect(parsed.etld1Overflow).toBe(1);
    const etlds = new Set([...parsed.destinations.keys()].map((k) => k.split('\t')[1]));
    expect(etlds.has(OTHER_ETLD1)).toBe(true);
    expect(etlds.size).toBe(MAX_DISTINCT_ETLD1 + 1);
  });

  it('stops after the per-segment line cap', async () => {
    const rows = Array.from({ length: MAX_SEGMENT_LINES + 5 }, () => line({ host: 'cap.example.com' }));
    const parsed = await parseAuditSegment(rows.join('\n'), ctx);
    expect(parsed.lines).toBe(MAX_SEGMENT_LINES);
    expect(parsed.connectionRows).toBe(MAX_SEGMENT_LINES);
  });

  it('truncates process names and accepts macOS / Windows writer shapes', async () => {
    const long = 'P'.repeat(80);
    const macos = JSON.stringify({
      kind: 'connection_opened',
      timestamp: TS,
      host: 'api.github.com',
      process: long,
      destination_port: '443',
      route: 'Tono-Exit -> US-VLESS-Reality',
      selected_exit: 'Los Angeles',
    });
    const windows = JSON.stringify({
      ts: Date.parse(TS),
      kind: 'directDial',
      host: 'weixin.qq.com',
      port: 443,
      process: 'WeChat.exe',
      chain: 'Tono-China-Direct',
      rule: 'MATCH',
    });
    const parsed = await parseAuditSegment(`${macos}\n${windows}`, ctx);
    expect(parsed.connectionRows).toBe(2);
    const github = [...parsed.destinations.values()].find((d) => d.processes.has(long.slice(0, MAX_PROCESS_CHARS)));
    expect(github?.processes.has(long.slice(0, MAX_PROCESS_CHARS))).toBe(true);
    const wechat = [...parsed.destinations.keys()].find((k) => k.includes('qq.com') && k.includes('direct'));
    expect(wechat).toBeTruthy();
  });

  it('round-trips a gzip segment via DecompressionStream', async () => {
    const jsonl = [
      line({ host: 'chat.openai.com', process: 'Safari', route: 'Tono-Claude-Home' }),
      line({ kind: 'protection_event', host: 'ignored.example' }),
    ].join('\n');
    const compressed = await gzip(jsonl);
    const fromGz = await parseAuditSegment(compressed, { ...ctx, gunzip: true });
    const fromText = await parseAuditSegment(jsonl, ctx);
    expect(fromGz.connectionRows).toBe(1);
    expect(fromGz.connectionRows).toBe(fromText.connectionRows);
    expect([...fromGz.destinations.keys()]).toEqual([...fromText.destinations.keys()]);
    expect(fromGz.services.get(`${DAY}\tchatgpt\tresidential`)?.sessions).toBe(1);
  });
});

async function baiduSegment(fields: Record<string, unknown>, over = ctx) {
  return await parseAuditSegment(
    line({ host: 'www.baidu.com', process: 'Safari', route: 'Tono-Exit', ...fields }),
    over,
  );
}

async function counts() {
  const row = await db().prepare(
    `SELECT
       (SELECT COUNT(*) FROM traffic_destination_daily) AS dest,
       (SELECT COUNT(*) FROM service_usage_daily) AS svc,
       (SELECT COUNT(*) FROM direct_candidate_daily) AS daily,
       (SELECT COALESCE(SUM(bytes_30d), 0) FROM direct_candidates) AS bytes,
       (SELECT COALESCE(SUM(connections_30d), 0) FROM direct_candidates) AS conns`,
  ).first<Record<string, number>>();
  return {
    dest: Number(row?.dest), svc: Number(row?.svc), daily: Number(row?.daily),
    bytes: Number(row?.bytes), conns: Number(row?.conns),
  };
}

const candidateRow = () => db().prepare(
  'SELECT users, bytes_30d, connections_30d, first_seen, last_seen, status FROM direct_candidates WHERE etld1 = ?',
).bind('baidu.com').first<{
  users: number; bytes_30d: number; connections_30d: number;
  first_seen: number; last_seen: number; status: string;
}>();

describe('writeParsedSegment and retainTrafficDaily', () => {
  it('folds two segments from one customer into one daily row and one customer', async () => {
    await writeParsedSegment(db(), await baiduSegment({ bytes_up: 100 }), RECEIVED, 'seg-1');
    await writeParsedSegment(db(), await baiduSegment({ bytes_down: 250, process: 'Chrome' }), RECEIVED + 10, 'seg-2');

    const dest = await db().prepare(
      `SELECT connections, bytes_up, bytes_down, top_process, day_at
       FROM traffic_destination_daily
       WHERE user_id = ? AND etld1 = ?`,
    ).bind(ctx.userId, 'baidu.com').first<{
      connections: number; bytes_up: number; bytes_down: number; top_process: string; day_at: number;
    }>();
    expect(dest).toMatchObject({
      connections: 2, bytes_up: 100, bytes_down: 250, day_at: DAY,
    });
    expect(dest?.top_process).toMatch(/Safari|Chrome/);

    const daily = await db().prepare(
      'SELECT user_id, day_at, bytes, connections FROM direct_candidate_daily WHERE etld1 = ?',
    ).bind('baidu.com').all<{ user_id: string; day_at: number; bytes: number; connections: number }>();
    expect(daily.results).toEqual([
      { user_id: ctx.userId, day_at: DAY, bytes: 350, connections: 2 },
    ]);

    // Between rollups the byte counters are already live; `users` is not.
    expect(await candidateRow()).toMatchObject({
      users: 0, bytes_30d: 350, connections_30d: 2, status: 'new',
    });
    await rollupDirectCandidates30d(db(), RECEIVED);
    expect(await candidateRow()).toMatchObject({
      users: 1, bytes_30d: 350, connections_30d: 2, status: 'new',
    });
  });

  it('counts two customers on one domain as two', async () => {
    await writeParsedSegment(db(), await baiduSegment({ bytes_up: 100 }), RECEIVED, 'seg-a');
    await writeParsedSegment(
      db(),
      await baiduSegment({ bytes_up: 40 }, { ...ctx, userId: 'u-two', deviceId: 'd-two' }),
      RECEIVED,
      'seg-b',
    );
    await rollupDirectCandidates30d(db(), RECEIVED);
    expect(await candidateRow()).toMatchObject({ users: 2, bytes_30d: 140, connections_30d: 2 });
  });

  it('recomputes rather than accumulates: rows outside the window drop back out', async () => {
    await writeParsedSegment(db(), await baiduSegment({ bytes_up: 100 }), RECEIVED, 'seg-window');
    await db().prepare(
      `INSERT INTO direct_candidate_daily(user_id, day_at, etld1, bytes, connections, last_seen_at)
       VALUES('u-stale', ?, 'baidu.com', 999, 9, ?)`,
    ).bind(DAY - 31 * 86_400, RECEIVED).run();

    await rollupDirectCandidates30d(db(), RECEIVED);
    expect(await candidateRow()).toMatchObject({ users: 1, bytes_30d: 100, connections_30d: 1 });

    // Move the window past everything: the counters shrink to zero.
    await rollupDirectCandidates30d(db(), RECEIVED + 31 * 86_400);
    expect(await candidateRow()).toMatchObject({ users: 0, bytes_30d: 0, connections_30d: 0 });
  });

  it('writes nothing the second time a segment id is parsed', async () => {
    const parsed = await baiduSegment({ bytes_up: 100 });
    expect(await writeParsedSegment(db(), parsed, RECEIVED, 'seg-once'))
      .toMatchObject({ skipped: false });
    const before = await counts();

    expect(await writeParsedSegment(db(), parsed, RECEIVED + 5, 'seg-once'))
      .toEqual({ skipped: true, rows: 0 });
    expect(await counts()).toEqual(before);

    const ledger = await db().prepare(
      'SELECT segment_id, user_id, lines, connection_rows FROM ops_traffic_segments',
    ).all<{ segment_id: string; user_id: string; lines: number; connection_rows: number }>();
    expect(ledger.results).toEqual([
      { segment_id: 'seg-once', user_id: ctx.userId, lines: 1, connection_rows: 1 },
    ]);

    // A different id carrying the same bytes is a different segment.
    expect(await writeParsedSegment(db(), parsed, RECEIVED + 6, 'seg-twice'))
      .toMatchObject({ skipped: false });
    const after = await counts();
    expect(after.bytes).toBe(before.bytes + 100);
    expect(after.conns).toBe(before.conns + 1);
    expect(after.daily).toBe(before.daily);
  });

  it('backfills direct_candidate_daily from the destination rollup exactly once', async () => {
    const seedDest = (userId: string, etld1: string, up: number, down: number) => db().prepare(
      `INSERT INTO traffic_destination_daily(
         user_id, device_id, day_at, etld1, route, node,
         connections, bytes_up, bytes_down, updated_at
       ) VALUES(?, '', ?, ?, 'cloud', '', 3, ?, ?, ?)`,
    ).bind(userId, DAY, etld1, up, down, RECEIVED).run();
    await seedDest('u-bf', 'baidu.com', 100, 200);
    await seedDest('u-bf', 'google.com', 1, 2);
    await seedDest('u-bf', OTHER_ETLD1, 1, 2);
    await seedDest('u-bf', IP_ETLD1, 1, 2);

    expect(await rollupDirectCandidates30d(db(), RECEIVED)).toMatchObject({ backfilled: 1 });
    const rows = await db().prepare(
      'SELECT user_id, etld1, bytes, connections FROM direct_candidate_daily ORDER BY etld1',
    ).all<{ user_id: string; etld1: string; bytes: number; connections: number }>();
    expect(rows.results).toEqual([
      { user_id: 'u-bf', etld1: 'baidu.com', bytes: 300, connections: 3 },
    ]);

    await seedDest('u-bf', 'sina.com.cn', 5, 5);
    expect(await rollupDirectCandidates30d(db(), RECEIVED)).toMatchObject({ backfilled: 0 });
    const again = await db().prepare(
      'SELECT COUNT(*) AS c FROM direct_candidate_daily',
    ).first<{ c: number }>();
    expect(Number(again?.c)).toBe(1);
  });

  it('retains recent daily rows, segments and candidates, and prunes the rest', async () => {
    await writeParsedSegment(db(), await baiduSegment({ bytes_up: 100 }), RECEIVED, 'seg-keep');
    await db().prepare(
      `INSERT INTO traffic_destination_daily(
         user_id, device_id, day_at, etld1, route, node,
         connections, bytes_up, bytes_down, updated_at
       ) VALUES('u-old', '', 1000, 'old.cn', 'cloud', '', 1, 0, 0, 1000)`,
    ).run();
    await db().prepare(
      `INSERT INTO direct_candidate_daily(user_id, day_at, etld1, bytes, connections, last_seen_at)
       VALUES('u-old', 1000, 'old.cn', 1, 1, 1000)`,
    ).run();
    await db().prepare(
      `INSERT INTO ops_traffic_segments(
         segment_id, user_id, device_id, received_at, parsed_at, lines, connection_rows
       ) VALUES('seg-old', 'u-old', NULL, 1000, 1000, 1, 1)`,
    ).run();

    await retainTrafficDaily(db(), RECEIVED, 90, 500);

    const leftover = await db().prepare(
      "SELECT COUNT(*) AS count FROM traffic_destination_daily WHERE user_id = 'u-old'",
    ).first<{ count: number }>();
    expect(Number(leftover?.count)).toBe(0);
    const kept = await db().prepare(
      'SELECT COUNT(*) AS count FROM traffic_destination_daily WHERE user_id = ?',
    ).bind(ctx.userId).first<{ count: number }>();
    expect(Number(kept?.count)).toBe(1);
    const daily = await db().prepare(
      'SELECT user_id FROM direct_candidate_daily',
    ).all<{ user_id: string }>();
    expect(daily.results.map((row) => row.user_id)).toEqual([ctx.userId]);
    const segments = await db().prepare(
      'SELECT segment_id FROM ops_traffic_segments',
    ).all<{ segment_id: string }>();
    expect(segments.results.map((row) => row.segment_id)).toEqual(['seg-keep']);
  });
});
