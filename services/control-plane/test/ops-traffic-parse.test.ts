import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  etld1,
  familyForHost,
  isLikelyDomestic,
  SERVICE_FAMILIES,
  SERVICE_FAMILIES_VERSION,
} from '../src/ops/service-families';
import {
  deriveRoute,
  IP_ETLD1,
  MAX_DISTINCT_ETLD1,
  MAX_PROCESS_CHARS,
  MAX_SEGMENT_LINES,
  OTHER_ETLD1,
  parseAuditSegment,
  retainTrafficDaily,
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

beforeEach(async () => {
  await db().prepare('DELETE FROM traffic_destination_daily').run();
  await db().prepare('DELETE FROM service_usage_daily').run();
  await db().prepare('DELETE FROM direct_candidates').run();
});

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
    const cand = parsed.candidates.get('baidu.com');
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

describe('writeParsedSegment and retainTrafficDaily', () => {
  it('accumulates upserts across two segments and retains old daily rows', async () => {
    const first = await parseAuditSegment(
      line({ host: 'www.baidu.com', process: 'Safari', route: 'Tono-Exit', bytes_up: 100 }),
      ctx,
    );
    await writeParsedSegment(db(), first, RECEIVED);
    const second = await parseAuditSegment(
      line({ host: 'www.baidu.com', process: 'Chrome', route: 'Tono-Exit', bytes_down: 250 }),
      ctx,
    );
    await writeParsedSegment(db(), second, RECEIVED + 10);

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

    const cand = await db().prepare(
      'SELECT connections_30d, bytes_30d, users, status FROM direct_candidates WHERE etld1 = ?',
    ).bind('baidu.com').first<{
      connections_30d: number; bytes_30d: number; users: number; status: string;
    }>();
    expect(cand).toMatchObject({
      connections_30d: 2, bytes_30d: 350, users: 2, status: 'new',
    });

    await db().prepare(
      `INSERT INTO traffic_destination_daily(
         user_id, device_id, day_at, etld1, route, node,
         connections, bytes_up, bytes_down, updated_at
       ) VALUES('u-old', '', 1000, 'old.cn', 'cloud', '', 1, 0, 0, 1000)`,
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
  });
});
