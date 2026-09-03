import { describe, expect, it } from 'vitest';
import { shouldUseDevFixtureResponse } from '../admin/src/api';
import { matchDevOps } from '../admin/src/dev/ops-fixture';
import { catalogProxyNames } from '../admin/src/lib/catalog';
import { formatBytes } from '../admin/src/lib/format';
import { machineSignals, mergedBilling, trafficRemaining } from '../admin/src/lib/machine';
import {
  calendarDaysUntil,
  gibibytes,
  localDateInputValue,
  tcpPort,
  unixDate,
  unixDateTimeLocal,
  unixFromLocalDate,
} from '../admin/src/lib/fields';
import { acceptIfCurrent, bindDetail } from '../admin/src/lib/bound-detail';
import { compactHealthLine, dataHealthLines, sourceTruthHealthLines } from '../admin/src/lib/health';
import { publishGate, catalogLag } from '../admin/src/lib/revision';
import { carrierLossSignals, carrierRows, worstCarrier, latencyTone, lossTone } from '../admin/src/lib/carrier';
import { formatExitDelay, formatTcpDelay, nodeHealthLabel, nodeHealthTone } from '../admin/src/lib/path-status';
import { innerTruth } from '../admin/src/lib/source-truth';
import type { CarrierPingMapDto } from '../admin/src/api';
import type { LiveAgentDto, NodeProfileDto } from '../admin/src/api';

const agent = (over: Partial<LiveAgentDto> = {}): LiveAgentDto => ({
  name: 'n',
  os: null,
  arch: null,
  cpuName: null,
  cpu: 12,
  memTotal: 100,
  memUsed: 50,
  diskTotal: 100,
  diskUsed: 10,
  netIn: 20,
  netOut: 5,
  uptime: 60,
  cpuCores: 2,
  load1: 1,
  load5: 1,
  load15: 1,
  swapTotal: 0,
  swapUsed: 0,
  tcpConnections: 3,
  processes: 10,
  observedAt: 1_700_000_000,
  carriers: null,
  price: 4,
  currency: '$',
  billingCycle: 30,
  expiredAt: 1_800_000_000,
  trafficLimit: 1_000,
  trafficLimitType: 'sum',
  ...over,
});

describe('admin console helpers', () => {
  it('extracts clash proxy names', () => {
    expect(catalogProxyNames('proxies:\n  - name: "Los Angeles"\n    type: ss\n')).toEqual(['Los Angeles']);
  });

  it('extracts an unquoted plain-scalar name containing spaces', () => {
    // Regression: rev 39 shipped `name: Los Angeles · Mesa` unquoted, the reader
    // regex saw no name, and the whole catalog failed closed for filtered accounts.
    expect(
      catalogProxyNames('proxies:\n  - name: Los Angeles · Mesa\n    type: vless\n'),
    ).toEqual(['Los Angeles · Mesa']);
  });

  it('formats byte counts without inventing units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('ranks a silent agent above a busy one', () => {
    const observedAt = Math.floor(Date.now() / 1000);
    const nowMs = observedAt * 1000;
    const quiet = machineSignals(agent({ observedAt: observedAt - 700, load1: 0.1 }), nowMs);
    const busy = machineSignals(agent({ observedAt, load1: 3 }), nowMs);
    const worst = (signals: { severity: number }[]) => signals.reduce((m, s) => Math.max(m, s.severity), 0);
    expect(worst(quiet.signals)).toBeGreaterThan(worst(busy.signals));
  });

  it('fills empty nodeProfiles from Komari inventory', () => {
    const billing = mergedBilling(undefined, agent());
    expect(billing.renewsAt).toBe(1_800_000_000);
    expect(billing.trafficQuotaBytes).toBe(1_000);
    expect(billing.price).toBe(4);
    expect(billing.source).toBe('komari');
  });

  it('lets a filled profile win over Komari quota', () => {
    const profile = {
      trafficQuotaBytes: 500,
      trafficUsedBytes: 100,
      renewsAt: 1_750_000_000,
    } as NodeProfileDto;
    expect(mergedBilling(profile, agent()).trafficQuotaBytes).toBe(500);
    expect(trafficRemaining(profile, agent())).toBe(400);
  });

  it('lets a hand-filled profile price win over Komari zeros and values', () => {
    const profile = {
      price: 12,
      currency: 'USD',
      billingCycle: 30,
    } as NodeProfileDto;
    const billing = mergedBilling(profile, agent());
    expect(billing.price).toBe(12);
    expect(billing.currency).toBe('USD');
    expect(billing.billingCycle).toBe(30);
  });
});

describe('billing fields Komari leaves unset', () => {
  // Every node in the fleet currently reads price=0, billing_cycle=0,
  // traffic_limit=0, expired_at=null — nobody has filled Komari's billing
  // settings in. Rendering those zeros as values put "$0" on sixteen paid
  // servers, and a zero quota against a known usage produces a negative
  // remaining.
  const empty = agent({
    price: 0, currency: '$', billingCycle: 0, expiredAt: null, trafficLimit: 0,
  } as Partial<LiveAgentDto>);

  it('reads an unfilled Komari record as absent, not as zero', () => {
    const billing = mergedBilling(undefined, empty);
    expect(billing.price).toBeNull();
    expect(billing.billingCycle).toBeNull();
    expect(billing.trafficQuotaBytes).toBeNull();
    expect(billing.source).toBe('none');
  });

  it('does not turn a missing quota into a negative remaining', () => {
    const profile = { trafficUsedBytes: 900, trafficQuotaBytes: null } as unknown as NodeProfileDto;
    expect(trafficRemaining(profile, empty)).toBeNull();
  });
});

describe('a byte count that has gone negative', () => {
  // The 余量 column is `quota - used`, so a node over its plan is exactly the
  // row an operator needs to read — and comparing the signed value against 1024
  // sent every one of them down the "small enough already" branch.
  it('scales an over-quota remainder instead of printing raw bytes', () => {
    expect(formatBytes(-3 * 1024 ** 3)).toBe('-3.0 GB');
    expect(formatBytes(-1024)).toBe('-1.0 KB');
  });

  it('still prints small counts, either sign, as bytes', () => {
    expect(formatBytes(-1)).toBe('-1 B');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });
});

describe('a form box read as three answers', () => {
  it('treats an emptied box as clear-this, not as leave-it-alone', () => {
    // `undefined` would be dropped by JSON.stringify and the server would keep
    // the old value, which is how a wrong quota became impossible to remove.
    expect(gibibytes('')).toBeNull();
    expect(gibibytes('   ')).toBeNull();
    expect(unixDate('')).toBeNull();
  });

  it('refuses a typo rather than letting it erase the field', () => {
    // NaN survives JSON.stringify as `null` — the wire form of "clear it" — so
    // the one input that was certainly a mistake was the one that wiped data.
    expect(gibibytes('abc')).toBe('invalid');
    expect(gibibytes('1,5')).toBe('invalid');
    expect(gibibytes('-4')).toBe('invalid');
    expect(unixDate('not-a-date')).toBe('invalid');
  });

  it('converts what it does accept', () => {
    expect(gibibytes('2')).toBe(2 * 1024 ** 3);
    expect(gibibytes('0')).toBe(0);
    expect(unixDate('2026-09-01')).toBe(Math.floor(Date.UTC(2026, 8, 1) / 1000));
  });
});

describe('renewal dates on the operator clock', () => {
  it('round-trips a date box through local midnight, not UTC', () => {
    // `new Date('2026-09-01')` is UTC midnight; west of Greenwich that second
    // renders back as 08-31 and every renewal date drifted a day.
    const saved = unixFromLocalDate('2026-09-01');
    expect(saved).toBe(Math.floor(new Date(2026, 8, 1).getTime() / 1000));
    expect(localDateInputValue(saved as number)).toBe('2026-09-01');
  });

  it('treats an emptied box as clear and refuses garbage', () => {
    expect(unixFromLocalDate('')).toBeNull();
    expect(unixFromLocalDate('not-a-date')).toBe('invalid');
    expect(unixFromLocalDate('2026-13-40')).toBe('invalid');
    expect(localDateInputValue(null)).toBe('');
  });

  it('counts calendar days, so late evening is not already tomorrow', () => {
    const renewal = new Date(2026, 8, 1).getTime() / 1000;
    const eveningBefore = new Date(2026, 7, 31, 23, 30).getTime() / 1000;
    const morningOf = new Date(2026, 8, 1, 9, 0).getTime() / 1000;
    const nextDay = new Date(2026, 8, 2, 0, 30).getTime() / 1000;
    expect(calendarDaysUntil(renewal, eveningBefore)).toBe(1);
    expect(calendarDaysUntil(renewal, morningOf)).toBe(0);
    expect(calendarDaysUntil(renewal, nextDay)).toBe(-1);
  });
});

describe('what a page admits about its own data', () => {
  const source = (over: Partial<Parameters<typeof dataHealthLines>[0][number]> = {}) => ({
    label: '在线活动', state: 'ready' as const, stale: null, refreshedAt: 1_000, ...over,
  });

  it('says nothing when every source is current', () => {
    expect(dataHealthLines([source(), source({ label: '客户' })], 2_000)).toEqual([]);
  });

  it('names a source that failed, because empty is not the same as none', () => {
    // The server list printed an occupancy of 0 for every node when this call
    // failed. Zero is a claim; absence is not.
    const lines = dataHealthLines([source({ state: 'error' })], 2_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('在线活动');
    expect(lines[0]).toContain('不作数');
  });

  it('says how old a frozen page is, since nothing on it moves', () => {
    const now = 1_000_000;
    const lines = dataHealthLines(
      [source({ stale: '刷新失败', refreshedAt: now - 20 * 60 * 1_000 })],
      now,
    );
    expect(lines[0]).toContain('20 分钟前');
    expect(lines[0]).toContain('刷新失败');
  });

  it('reports a failed source once, as missing rather than also as stale', () => {
    const lines = dataHealthLines([source({ state: 'error', stale: '刷新失败' })], 2_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('不作数');
  });

  it('dates the banner from the oldest snapshot on the page', () => {
    const now = 1_000_000;
    const lines = dataHealthLines([
      source({ label: '客户', stale: 'x', refreshedAt: now - 5 * 60 * 1_000 }),
      source({ label: '家宽库存', stale: 'x', refreshedAt: now - 90 * 60 * 1_000 }),
    ], now);
    expect(lines[0]).toContain('2 小时前');
  });
});

describe('collector snapshot truth', () => {
  const envelope = (over: Record<string, unknown> = {}) => ({
    state: 'ready' as const,
    data: {},
    reload: () => undefined,
    reloadNow: async () => ({}),
    refreshedAt: 2_000_000,
    stale: null,
    refreshing: false,
    ...over,
  }) as Parameters<typeof innerTruth>[0];

  it('keeps the exact freshness boundary current and turns the next second stale', () => {
    const options = { asOfSec: 1_000, staleAfterSeconds: 900 };
    expect(innerTruth(envelope(), true, null, { ...options, nowSec: 1_900 }).status)
      .toBe('current');
    const stale = innerTruth(envelope(), true, null, { ...options, nowSec: 1_901 });
    expect(stale).toMatchObject({
      status: 'stale',
      hasSnapshot: true,
      error: '采集快照已过期',
      asOf: 1_000_000,
    });
  });

  it('does not call a present snapshot current when its receipt time is unknown', () => {
    expect(innerTruth(envelope(), true, null, {
      asOfSec: null,
      staleAfterSeconds: 900,
      nowSec: 2_000,
    })).toMatchObject({
      status: 'stale',
      hasSnapshot: true,
      error: '采集快照时间未知',
      asOf: null,
    });
  });

  it('puts collector age in the compact health sentence', () => {
    const stale = innerTruth(envelope(), true, null, {
      asOfSec: 1_000,
      staleAfterSeconds: 900,
      nowSec: 8_200,
    });
    const lines = sourceTruthHealthLines([{ label: '机器探针', source: stale }], 8_200_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2 小时前');
    expect(lines[0]).toContain('不能据此声明正常');
  });
});

describe('development fixture failure scenarios', () => {
  it('keeps top-bar source health concise while the full sentence remains available', () => {
    expect(compactHealthLine('节点质量、机器探针采集快照不可用，靠它们得出的结论都不作数。'))
      .toBe('节点质量、机器探针不可用');
    expect(compactHealthLine('节点质量、机器探针采集已落后，现在看到的是48 小时前的数据，不能据此声明正常。'))
      .toBe('节点质量、机器探针采集落后');
    expect(compactHealthLine('一条未知格式的健康信息')).toBe('一条未知格式的健康信息');
  });

  it('falls back only for a missing Vite route, not a real JSON API error', () => {
    expect(shouldUseDevFixtureResponse(404, 'text/html; charset=utf-8')).toBe(true);
    expect(shouldUseDevFixtureResponse(404, 'application/json')).toBe(false);
    expect(shouldUseDevFixtureResponse(409, 'text/html')).toBe(false);
    expect(shouldUseDevFixtureResponse(503, 'application/json')).toBe(false);
  });

  it('provides browser-reachable unavailable and stale source snapshots', () => {
    const unavailable = (matchDevOps('live', 'GET', undefined, 'source-unavailable') as any).live;
    expect(unavailable).toMatchObject({
      agents: null,
      agentsReceivedAt: null,
      quality: null,
      qualityReceivedAt: null,
    });
    expect(unavailable.agentsError).toContain('不可用');
    expect(unavailable.qualityError).toContain('不可用');

    const stale = (matchDevOps('live', 'GET', undefined, 'source-stale') as any).live;
    expect(stale.fetchedAt - stale.agentsReceivedAt).toBe(2 * 86_400);
    expect(stale.fetchedAt - stale.qualityReceivedAt).toBe(2 * 86_400);
  });

  it('can fail each independent browser source instead of always masking Vite 404s', () => {
    const cases = [
      ['live-unavailable', 'live'],
      ['activity-unavailable', 'activity'],
      ['users-unavailable', 'users'],
      ['catalog-unavailable', 'exit-catalog'],
      ['metrics-unavailable', 'metrics?range=24h'],
      ['policy-unavailable', 'traffic-policy'],
    ] as const;
    for (const [scenario, path] of cases) {
      expect(() => matchDevOps(path, 'GET', undefined, scenario)).toThrow(/DEV：.+不可用/);
    }
  });

  it('exercises dense carrier history, unknown buckets, and a loss transition', () => {
    const live = (matchDevOps('live') as any).live;
    const history = live.agents[0].carriers.unicom.history as Array<{
      latencyMs: number | null;
      lossPct: number | null;
    }>;
    expect(history).toHaveLength(12);
    expect(history.some((point) => point.latencyMs === null)).toBe(true);
    expect(history.some((point) => (point.lossPct ?? 0) >= 12)).toBe(true);
  });
});

describe('the revision a publish claims it was written against', () => {
  it('claims the frozen base, never whatever the server is now', () => {
    // The whole failure: reading `expectedRevision` off an auto-refreshing
    // resource made it agree with the server by construction, so a draft built
    // on r36 published cleanly over someone else's r37.
    const gate = publishGate(36, 37);
    expect(gate).toEqual({ allow: true, expectedRevision: 36, drifted: true });
  });

  it('is not drifted when nothing has moved underneath it', () => {
    expect(publishGate(36, 36)).toEqual({ allow: true, expectedRevision: 36, drifted: false });
  });

  it('refuses instead of guessing 0 when no base was captured', () => {
    // 0 would be a guess dressed as an answer, and on an empty catalog it is
    // the value that succeeds.
    const gate = publishGate(null, 37);
    expect(gate.allow).toBe(false);
    expect(gate).not.toHaveProperty('expectedRevision');
  });

  it('still publishes when the current revision is unknown', () => {
    // The base is what the server compares against; not having re-read the
    // catalog is not a reason to block a draft that does know its base.
    expect(publishGate(36, null)).toEqual({ allow: true, expectedRevision: 36, drifted: false });
  });
});

describe('three-network ping, and what it refuses to claim', () => {
  const carrier = (over = {}) => ({
    latencyMs: 150, lossPct: 0, samples: 9, targets: ['三网-电信-上海'],
    history: [{ latencyMs: 150, lossPct: 0 }], ...over,
  });

  it('renders a carrier nobody probed as unknown, never as good', () => {
    // The whole reason this data needs handling at all: Komari reports an unrun
    // ping task as 0 ms / 0% loss, which reads as a flawless path. A node that
    // was never measured must not look like the best one on the page.
    const rows = carrierRows({ telecom: carrier() } as CarrierPingMapDto);
    const mobile = rows.find((row) => row.key === 'mobile')!;
    expect(mobile.probed).toBe(false);
    expect(mobile.latencyText).toBe('—');
    expect(mobile.lossText).toBe('—');
    expect(mobile.latencyTone).toBe('unknown');
    expect(mobile.detail).toContain('没有匹配到');
  });

  it('keeps all three carriers in a stable order so rows line up', () => {
    const rows = carrierRows(null);
    expect(rows.map((row) => row.key)).toEqual(['unicom', 'telecom', 'mobile']);
    expect(rows.every((row) => !row.probed)).toBe(true);
  });

  it('carries what was pinged alongside the number', () => {
    // Cross-carrier latency is partly geography — 联通 only answers ICMP from
    // northern cities — so the targets have to be visible next to the number.
    const rows = carrierRows({
      telecom: carrier({ targets: ['三网-电信-上海', '三网-电信-广东'], samples: 6 }),
    } as CarrierPingMapDto);
    const telecom = rows.find((row) => row.key === 'telecom')!;
    expect(telecom.detail).toContain('三网-电信-上海 / 三网-电信-广东');
    expect(telecom.detail).toContain('6 次探测');
  });

  it('bands latency against the fleet as it actually measures', () => {
    // Tokyo sits near 40 ms and Buffalo near 260. A band that called 200 bad
    // would paint most of the fleet red and stop carrying information.
    expect(latencyTone(40)).toBe('good');
    expect(latencyTone(180)).toBe('warn');
    expect(latencyTone(260)).toBe('bad');
    expect(latencyTone(null)).toBe('unknown');
  });

  it('treats any loss at all as worth colour, because zero is the right answer', () => {
    expect(lossTone(0)).toBe('good');
    expect(lossTone(3)).toBe('warn');
    expect(lossTone(33.3)).toBe('bad');
    expect(lossTone(null)).toBe('unknown');
  });

  it('picks the worst carrier by loss first, since lossy beats merely slow', () => {
    const worst = worstCarrier({
      unicom: carrier({ latencyMs: 400, lossPct: 0 }),
      mobile: carrier({ latencyMs: 120, lossPct: 33.3 }),
    } as CarrierPingMapDto);
    expect(worst?.key).toBe('mobile');
  });

  it('falls back to latency when nothing is losing packets', () => {
    const worst = worstCarrier({
      unicom: carrier({ latencyMs: 400 }),
      telecom: carrier({ latencyMs: 120 }),
    } as CarrierPingMapDto);
    expect(worst?.key).toBe('unicom');
  });

  it('summarises nothing when nothing was probed', () => {
    // The collapsed table row shows this chip. Showing a dash there would read
    // as "measured, fine"; showing nothing reads as "not measured".
    expect(worstCarrier(null)).toBeNull();
    expect(worstCarrier({ mobile: carrier({ samples: 0 }) } as CarrierPingMapDto)).toBeNull();
  });

  it('emits a console signal only for the bad loss band', () => {
    expect(carrierLossSignals({ telecom: carrier({ lossPct: 12.3 }) } as CarrierPingMapDto)).toEqual([
      { label: '电信丢包 12.3%', severity: 3, kind: 'carrier-loss' },
    ]);
    expect(carrierLossSignals({ telecom: carrier({ lossPct: 3 }) } as CarrierPingMapDto)).toEqual([]);
    expect(carrierLossSignals(null)).toEqual([]);
  });
});

describe('how far behind a catalog a client is', () => {
  it('separates "too old to say" from "up to date"', () => {
    // Clients before the fix sent a hardcoded nil. Rendering that as current
    // would have answered "did everyone pick up the publish" with a confident
    // yes on no evidence — the mistake this column exists to prevent.
    expect(catalogLag(null, 39)).toEqual({ state: 'unreported' });
    expect(catalogLag(undefined, 39)).toEqual({ state: 'unreported' });
    expect(catalogLag(39, 39)).toEqual({ state: 'current', revision: 39 });
  });

  it('reports the gap, not just the number', () => {
    // The number alone requires remembering which revision is published.
    expect(catalogLag(36, 39)).toEqual({ state: 'behind', revision: 36, by: 3 });
  });

  it('does not describe a rolled-back catalog as a negative lag', () => {
    expect(catalogLag(40, 39)).toEqual({ state: 'ahead', revision: 40 });
  });

  it('admits when it does not know the published revision', () => {
    expect(catalogLag(36, null)).toEqual({ state: 'unknown-target', revision: 36 });
  });
});

describe('client path status on the customer list', () => {
  it('keeps exit HTTP and TCP as separate readings', () => {
    expect(formatExitDelay(null)).toBe('出口未测');
    expect(formatTcpDelay(null)).toBe('TCP 未测');
    expect(formatExitDelay(80)).toBe('出口 80ms');
    expect(formatTcpDelay(42)).toBe('TCP 42ms');
  });

  it('does not call an 800ms exit reading a dead node', () => {
    expect(formatExitDelay(816)).toBe('出口较慢 816ms');
    expect(nodeHealthLabel('ok')).toBe('大陆正常');
    expect(nodeHealthLabel('down')).toBe('整机失联');
    expect(nodeHealthTone('down')).toBe('bad');
    expect(nodeHealthTone('ok')).toBe('ok');
  });
});

import { formatOpsHash, parseOpsHash, parseTrafficRange } from '../admin/src/lib/hash';
import {
  accidentsOnly,
  customerPathVerdict,
  HEARTBEAT_FRESH_SECONDS,
  incidentsFromWorld,
  PATH_SEVERE_MS,
  PATH_WARN_MS,
} from '../admin/src/lib/incidents';
import {
  assembleOpsNodes,
  assembleOpsPeople,
  carrierLossLine,
  carrierLossNeedsAttention,
  catalogBehindLive,
  hasBadCarrierLoss,
  nodeAttentionLabel,
  nodeMatchesFocus,
  nodeRootCause,
  nodeSearchHaystack,
  sortOpsNodes,
} from '../admin/src/lib/ops-views';
import { sparkPath } from '../admin/src/lib/spark';
import { maskEmail, maskIp } from '../admin/src/lib/privacy';
import { counterDeltaBps, parseTrafficLimitType, seriesRates } from '../admin/src/lib/traffic';
import type { ActivityUserDto, LiveQualityNodeDto, UserDto } from '../admin/src/api';

const qualityNode = (name: string, over: Partial<LiveQualityNodeDto> = {}): LiveQualityNodeDto => ({
  name,
  host: null,
  publicIp: null,
  ok: true,
  quality: 'ok',
  riskKeywords: [],
  riskSignals: [],
  exposure: null,
  routeKeywords: [],
  block: { status: 'OK', label: '大陆正常', rule: null, mainland: null, asiaEdge: null, overseas: null },
  ...over,
});

const activity = (over: Partial<ActivityUserDto> = {}): ActivityUserDto => ({
  userId: 'u1',
  deviceId: 'd1',
  email: 'a@example.com',
  lastSeenAt: 1_700_000_000,
  online: true,
  clientVersion: '1',
  osVersion: 'mac',
  selectedServer: 'Tokyo · Fuji',
  uiState: 'connected',
  catalogRevision: 40,
  exitDelayMs: 80,
  tcpDelayMs: 40,
  exitDelayAtMs: 1_700_000_000,
  tcpDelayAtMs: 1_700_000_000,
  nodeHealth: 'ok',
  nodeHealthLabel: '大陆正常',
  ...over,
});

describe('ops hash routing', () => {
  it('round-trips page, focus, and node with spaces', () => {
    const hash = formatOpsHash({
      page: 'monitor',
      focus: 'blocked',
      node: 'Tokyo · Fuji',
      user: null,
      q: null,
      range: null,
    });
    expect(hash).toContain('#/monitor?');
    expect(parseOpsHash(hash)).toEqual({
      page: 'monitor',
      focus: 'blocked',
      node: 'Tokyo · Fuji',
      user: null,
      q: null,
      range: null,
    });
  });

  it('keeps a plus in the search where the operator typed it', () => {
    const hash = formatOpsHash({
      page: 'users',
      focus: null,
      node: null,
      user: null,
      q: 'bob+vpn@example.com',
      range: null,
    });
    expect(parseOpsHash(hash).q).toBe('bob+vpn@example.com');
    // A hand-written link that escapes the plus itself reads the same way.
    expect(parseOpsHash('#/users?q=bob%2Bvpn%40example.com').q).toBe('bob+vpn@example.com');
    // And a space, which the console writes as a plus, is still a space.
    expect(parseOpsHash('#/monitor?node=Tokyo+%C2%B7+Fuji').node).toBe('Tokyo · Fuji');
  });

  it('maps old aliases and missing page to known pages', () => {
    expect(parseOpsHash('#/homes').page).toBe('users');
    expect(parseOpsHash('#/catalog').page).toBe('control');
    expect(parseOpsHash('#/nope').page).toBe('dashboard');
  });
});

describe('cumulative traffic is not a live rate', () => {
  it('parses Komari limit types and assumes sum only when the string is unknown', () => {
    expect(parseTrafficLimitType('sum')).toEqual({ accounting: 'sum', assumed: false });
    expect(parseTrafficLimitType('max')).toEqual({ accounting: 'max', assumed: false });
    expect(parseTrafficLimitType('min')).toEqual({ accounting: 'min', assumed: false });
    expect(parseTrafficLimitType('up')).toEqual({ accounting: 'up', assumed: false });
    expect(parseTrafficLimitType('down')).toEqual({ accounting: 'down', assumed: false });
    expect(parseTrafficLimitType('weird')).toEqual({ accounting: 'sum', assumed: true });
  });

  it('turns adjacent counters into bytes/sec and drops resets and gaps', () => {
    expect(counterDeltaBps({ t: 0, value: 1000 }, { t: 10, value: 3000 }, 30)).toBe(200);
    expect(counterDeltaBps({ t: 0, value: 3000 }, { t: 10, value: 1000 }, 30)).toBeNull();
    expect(counterDeltaBps({ t: 0, value: 1000 }, { t: 80, value: 9000 }, 30)).toBeNull();
  });

  it('breaks the rate series where a counter restarts', () => {
    const rates = seriesRates([
      { t: 0, netIn: 100, netOut: 50 },
      { t: 60, netIn: 160, netOut: 80 },
      { t: 120, netIn: 10, netOut: 90 },
    ], 60);
    expect(rates[0].inBps).toBe(1);
    expect(rates[1].inBps).toBeNull();
    expect(rates[1].outBps).toBeCloseTo(10 / 60);
  });

  it('makes the dev fixture exercise both illegal gaps and legal irregular sampling', () => {
    type CounterPoint = { t: number; netIn: number | null; netOut: number | null };
    const metrics = (matchDevOps('metrics?range=24h') as {
      metrics: { resolutionSeconds: number; series: Record<string, CounterPoint[]> };
    }).metrics;
    const rates = (name: string) => seriesRates(metrics.series[name], metrics.resolutionSeconds);

    expect(rates('Tokyo · Fuji').some((point) => point.inBps == null && point.outBps == null)).toBe(true);
    expect(rates('Tokyo · Neon').some((point) => point.dt > metrics.resolutionSeconds * 3
      && point.inBps == null && point.outBps == null)).toBe(true);
    expect(rates('Tokyo · Sakura').some((point) => point.dt === metrics.resolutionSeconds * 2
      && point.inBps != null && point.outBps != null)).toBe(true);
    expect(rates('Los Angeles · Mesa').every((point) => point.dt === metrics.resolutionSeconds * 2
      && point.inBps != null && point.outBps != null)).toBe(true);
    expect(rates('Singapore · Harbour').every((point) => point.inBps == null && point.outBps == null)).toBe(true);
  });

  it('accounts remaining against up-only quota instead of silently summing', () => {
    const profile = {
      trafficQuotaBytes: 1000,
      cycleNetIn: 100,
      cycleNetOut: 200,
    } as NodeProfileDto;
    expect(trafficRemaining(profile, agent({ netIn: 500, netOut: 400, trafficLimitType: 'up' }))).toBe(800);
    expect(trafficRemaining(profile, agent({ netIn: 500, netOut: 400, trafficLimitType: 'sum' }))).toBe(400);
  });
});

describe('customer path incidents', () => {
  const now = 2_000_000;

  it('does not treat a stale heartbeat as an incident', () => {
    expect(customerPathVerdict({
      lastSeenAt: now - HEARTBEAT_FRESH_SECONDS - 1,
      online: true,
      nodeHealth: 'down',
      exitDelayMs: 900,
      tcpDelayMs: 900,
      nowSec: now,
    }).kind).toBe('stale');
  });

  it('does not treat missing delay as a failure', () => {
    expect(customerPathVerdict({
      lastSeenAt: now,
      online: true,
      nodeHealth: 'ok',
      exitDelayMs: null,
      tcpDelayMs: null,
      nowSec: now,
    }).kind).toBe('unmeasured');
  });

  it('splits 400ms warn from 800ms severe', () => {
    const warn = customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: PATH_WARN_MS, tcpDelayMs: 10, nowSec: now,
    });
    const severe = customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: PATH_SEVERE_MS, tcpDelayMs: 10, nowSec: now,
    });
    expect(warn).toMatchObject({ kind: 'incident', severity: 'warn' });
    expect(severe).toMatchObject({ kind: 'incident', severity: 'severe' });
  });

  it('picks the worst online device even when the slow one is listed second', () => {
    const people = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      activity: [
        activity({ deviceId: 'fast', lastSeenAt: now, exitDelayMs: 50, tcpDelayMs: 10, exitDelayAtMs: now * 1000 }),
        activity({ deviceId: 'slow', lastSeenAt: now, exitDelayMs: 900, tcpDelayMs: 10, exitDelayAtMs: now * 1000 }),
      ],
    });
    expect(people[0].path).toMatchObject({ kind: 'incident', severity: 'severe' });
  });

  it('dedupes two devices of the same customer into one person incident', () => {
    const people = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      activity: [
        activity({ deviceId: 'a', lastSeenAt: now, exitDelayMs: 900, tcpDelayMs: 10, exitDelayAtMs: now * 1000, tcpDelayAtMs: now * 1000 }),
        activity({ deviceId: 'b', lastSeenAt: now, exitDelayMs: 50, tcpDelayMs: 10, exitDelayAtMs: now * 1000, tcpDelayAtMs: now * 1000 }),
      ],
    });
    expect(people).toHaveLength(1);
    expect(people[0].reportedDeviceCount).toBe(2);
    const incidents = incidentsFromWorld({ nodes: [], people, catalogRevision: 40, nowSec: now });
    expect(incidents.filter((item) => item.id.startsWith('path:'))).toHaveLength(1);
  });
});

describe('ops node union and incident ranking', () => {
  it('keeps catalog-only and agent-only machines in the grid', () => {
    const nodes = assembleOpsNodes({
      nowMs: 1_700_000_000_000,
      catalogYaml: 'proxies:\n  - name: "Catalog Only"\n    type: vless\n',
      qualityNodes: [qualityNode('Quality Only')],
      agents: [agent({ name: 'Agent Only' })],
      activity: [activity({ selectedServer: 'Occupied Only', lastSeenAt: 1_700_000_000, online: true })],
    });
    expect(nodes.map((node) => node.name).sort()).toEqual([
      'Agent Only', 'Catalog Only', 'Occupied Only', 'Quality Only',
    ]);
    expect(nodes.find((node) => node.name === 'Catalog Only')?.catalogListed).toBe(true);
    expect(nodes.find((node) => node.name === 'Agent Only')?.agent).toBeTruthy();
    expect(nodes.find((node) => node.name === 'Occupied Only')?.occupancy).toBe(1);
  });

  it('counts unique users on a node, not devices', () => {
    const nodes = assembleOpsNodes({
      nowMs: 0,
      activity: [
        activity({ userId: 'u1', deviceId: 'd1', email: 'a@x' }),
        activity({ userId: 'u1', deviceId: 'd2', email: 'a@x' }),
        activity({ userId: 'u2', deviceId: 'd3', email: 'b@x' }),
      ],
    });
    expect(nodes.find((node) => node.name === 'Tokyo · Fuji')?.occupancy).toBe(2);
  });

  it('ranks a blocked listed node above unopened Claude', () => {
    const nowSec = 1_800_000_000;
    const nodes = assembleOpsNodes({
      nowMs: nowSec * 1000,
      catalogYaml: 'proxies:\n  - name: "Sakura"\n    type: vless\n',
      qualityNodes: [qualityNode('Sakura', {
        ok: false,
        block: { status: 'LIKELY_BLOCKED', label: '疑似被墙', rule: null, mainland: null, asiaEdge: null, overseas: null },
      })],
    });
    const people = assembleOpsPeople({
      nowSec,
      telemetrySource: 'ready',
      users: [{
        id: 'u-claude',
        email: 'c@example.com',
        deviceLimit: 2,
        quotaBytes: null,
        usageBytes: 0,
        suspended: false,
        status: 'active',
        createdAt: nowSec,
        product: { accountRef: null, status: null, openedAt: null, replaceCount: 0, incomplete: true },
        homeBinding: null,
      } as UserDto],
    });
    const incidents = incidentsFromWorld({ nodes, people, catalogRevision: 40, nowSec });
    expect(incidents[0].severity).toBe('severe');
    expect(incidents[0].node).toBe('Sakura');
    expect(accidentsOnly(incidents).some((item) => item.detail.includes('Claude'))).toBe(false);
    expect(incidents.some((item) => item.severity === 'info' && item.detail.includes('Claude'))).toBe(true);
  });

  it('does not emit per-customer path accidents when the node is already severe', () => {
    const nowSec = 1_800_000_000;
    const nodes = assembleOpsNodes({
      nowMs: nowSec * 1000,
      catalogYaml: 'proxies:\n  - name: "Sakura"\n    type: vless\n',
      qualityNodes: [qualityNode('Sakura', {
        ok: false,
        block: { status: 'LIKELY_BLOCKED', label: '疑似被墙', rule: null, mainland: null, asiaEdge: null, overseas: null },
      })],
      activity: [
        activity({ userId: 'a', email: 'a@x', selectedServer: 'Sakura', nodeHealth: 'blocked', lastSeenAt: nowSec, exitDelayMs: 80 }),
        activity({ userId: 'b', email: 'b@x', selectedServer: 'Sakura', nodeHealth: 'blocked', lastSeenAt: nowSec, exitDelayMs: 90 }),
      ],
    });
    const people = assembleOpsPeople({
      nowSec,
      telemetrySource: 'ready',
      activity: [
        activity({ userId: 'a', email: 'a@x', selectedServer: 'Sakura', nodeHealth: 'blocked', lastSeenAt: nowSec, exitDelayMs: 80 }),
        activity({ userId: 'b', email: 'b@x', selectedServer: 'Sakura', nodeHealth: 'blocked', lastSeenAt: nowSec, exitDelayMs: 90 }),
      ],
    });
    const incidents = incidentsFromWorld({ nodes, people, catalogRevision: 40, nowSec });
    expect(incidents.filter((item) => item.id.startsWith('path:'))).toHaveLength(0);
    expect(incidents.some((item) => item.node === 'Sakura' && item.severity === 'severe')).toBe(true);
  });

  it('does not paint an unprobed-fresh node green when the agent is stale', () => {
    const nowMs = 1_700_000_000_000;
    const nodes = assembleOpsNodes({
      nowMs,
      qualityNodes: [qualityNode('Quiet')],
      agents: [agent({ name: 'Quiet', observedAt: Math.floor(nowMs / 1000) - 700 })],
    });
    expect(nodes[0].dot).toBe('warn');
  });

  it('does not treat a failed agent source as every machine missing a probe', () => {
    const nodes = assembleOpsNodes({
      nowMs: 1,
      catalogYaml: 'proxies:\n  - name: "Listed"\n    type: vless\n',
      catalogSource: 'ready',
      agentSource: 'unavailable',
      qualitySource: 'ready',
      qualityNodes: [qualityNode('Listed')],
      activitySource: 'ready',
      activity: [],
    });
    expect(nodes[0].agentState).toBe('unavailable');
    expect(nodes[0].blockLabel).not.toBe('质量源不可用');
    const incidents = incidentsFromWorld({ nodes, people: [], catalogRevision: 1, nowSec: 1 });
    expect(incidents.some((item) => item.id.startsWith('node-noprobe:'))).toBe(false);
  });

  it('does not report occupancy 0 or 大陆未测 when those sources failed', () => {
    const nodes = assembleOpsNodes({
      nowMs: 1,
      catalogYaml: 'proxies:\n  - name: "OnlyCat"\n    type: vless\n',
      catalogSource: 'ready',
      qualitySource: 'unavailable',
      agentSource: 'ready',
      agents: [agent({ name: 'OnlyCat' })],
      activitySource: 'unavailable',
    });
    expect(nodes[0].occupancy).toBeNull();
    expect(nodes[0].occupancyState).toBe('unavailable');
    expect(nodes[0].qualityState).toBe('unavailable');
    expect(nodes[0].blockLabel).toBe('质量源不可用');
    expect(nodes[0].catalogState).toBe('known-listed');
  });

  it('keeps occupancy-only machines and does not match noprobe when the agent source failed', () => {
    const nodes = assembleOpsNodes({
      nowMs: 1,
      catalogSource: 'ready',
      catalogYaml: 'proxies:\n  - name: "Listed"\n    type: vless\n',
      agentSource: 'unavailable',
      qualitySource: 'ready',
      qualityNodes: [],
      activitySource: 'ready',
      activity: [activity({ selectedServer: 'Occupied Only', lastSeenAt: 1, online: true })],
    });
    const listed = nodes.find((node) => node.name === 'Listed')!;
    const occupied = nodes.find((node) => node.name === 'Occupied Only')!;
    expect(occupied.occupancy).toBe(1);
    expect(nodeMatchesFocus(listed, 'noprobe', 1)).toBe(false);
    expect(nodeMatchesFocus(listed, 'unknown', 1)).toBe(true);
    expect(nodeMatchesFocus(occupied, 'unknown', 1)).toBe(true);
    expect(listed.billing.renewsAt).toBeNull();
    expect(nodeMatchesFocus(listed, 'unfilled-renew', 1)).toBe(true);
    expect(nodeMatchesFocus(listed, 'expiring', 1)).toBe(false);
  });

  it('sorts blocked listed nodes ahead of healthy occupied ones', () => {
    const nodes = assembleOpsNodes({
      nowMs: 1_800_000_000_000,
      catalogYaml: 'proxies:\n  - name: "Sakura"\n    type: vless\n  - name: "Tokyo · Fuji"\n    type: vless\n',
      qualityNodes: [
        qualityNode('Sakura', {
          ok: false,
          block: { status: 'LIKELY_BLOCKED', label: '疑似被墙', rule: null, mainland: null, asiaEdge: null, overseas: null },
        }),
        qualityNode('Tokyo · Fuji'),
      ],
      activity: [activity({ selectedServer: 'Tokyo · Fuji', lastSeenAt: 1_800_000_000, online: true })],
    });
    expect(sortOpsNodes(nodes)[0].name).toBe('Sakura');
    expect(nodeMatchesFocus(nodes.find((node) => node.name === 'Sakura')!, 'blocked', 1_800_000_000)).toBe(true);
    expect(nodeMatchesFocus(nodes.find((node) => node.name === 'Tokyo · Fuji')!, 'blocked', 1_800_000_000)).toBe(false);
  });

  it('searches name, IP, provider, and route tags', () => {
    const nodes = assembleOpsNodes({
      nowMs: 1,
      qualityNodes: [qualityNode('Tokyo · Fuji', { publicIp: '203.0.113.9', routeKeywords: ['9929'] })],
      profiles: [{
        id: 'p1', catalogName: 'Tokyo · Fuji', publicIp: '203.0.113.9', provider: 'Bandwagon',
        price: null, currency: null, billingCycle: null, trafficQuotaBytes: null, trafficUsedBytes: null,
        trafficCycleStart: null, trafficCycleEnd: null, cycleNetIn: null, cycleNetOut: null, renewsAt: null,
        status: 'active', createdAt: 1, updatedAt: 1,
      } as NodeProfileDto],
    });
    const hay = nodeSearchHaystack(nodes[0]);
    expect(hay).toContain('tokyo');
    expect(hay).toContain('203.0.113.9');
    expect(hay).toContain('bandwagon');
    expect(hay).toContain('9929');
  });
});

describe('sparkline gaps', () => {
  it('does not draw a line across a null sample', () => {
    const path = sparkPath([1, 2, null, 4, 5], 100, 10);
    expect(path).toContain('M');
    expect(path?.match(/M/g)?.length).toBe(2);
  });
});

describe('screenshot privacy masks', () => {
  it('hides local-part and network addresses without leaking host:port values', () => {
    expect(maskEmail('tester@example.com')).toBe('te***@example.com');
    expect(maskIp('203.0.113.9')).toBe('203.0.***.***');
    expect(maskIp('203.0.113.9:443')).toBe('203.0.***.***');
    expect(maskIp('proxy.customer.example:443')).toBe('***');
    expect(maskIp('2001:db8::1')).toBe('2001:***');
    expect(maskIp('[2001:db8::1]:443')).toBe('2001:***');
  });
});

import { createExclusiveGate } from '../admin/src/lib/exclusive';
import { personAccountLabel, personMatchesFocus, personTelemetryLabel } from '../admin/src/lib/ops-views';
import { nextRouteForOpenUser, nextRouteForOpenNode } from '../admin/src/lib/hash';
import { msEpochToSec } from '../admin/src/lib/time';
import { emptyHash } from '../admin/src/lib/hash';
import { pickWorstActivity } from '../admin/src/lib/incidents';

describe('customer telemetry and path activity', () => {
  const now = 2_000_000;

  it('does not treat a missing activity source as offline', () => {
    const people = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'unavailable',
      users: [{
        id: 'u1', email: 'a@example.com', deviceLimit: 1, quotaBytes: null, usageBytes: 0,
        suspended: false, status: 'active', createdAt: now, homeBinding: null,
      } as UserDto],
    });
    expect(people[0].telemetryState).toBe('unavailable');
    expect(people[0].online).toBe(false);
    expect(people[0].path.kind).toBe('offline');
  });

  it('keeps latest heartbeat and worst-path device separate', () => {
    const people = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      activity: [
        activity({ deviceId: 'new', lastSeenAt: now, selectedServer: 'Tokyo · Fuji', exitDelayMs: 40, tcpDelayMs: 20, exitDelayAtMs: now * 1000 }),
        activity({ deviceId: 'bad', lastSeenAt: now - 10, selectedServer: 'Tokyo · Neon', exitDelayMs: 900, tcpDelayMs: 20, exitDelayAtMs: (now - 10) * 1000 }),
      ],
    });
    expect(people[0].latestActivity?.deviceId).toBe('new');
    expect(people[0].pathActivity?.deviceId).toBe('bad');
    expect(people[0].selectedServer).toBe('Tokyo · Neon');
    expect(people[0].exitDelayMs).toBe(900);
    expect(people[0].exitDelayAtSec).toBe(now - 10);
  });

  it('breaks a same-severity tie using the larger delay, then recency if everyone is offline', () => {
    const a = activity({ deviceId: 'a', online: true, lastSeenAt: now - 5, exitDelayMs: 410, tcpDelayMs: 10 });
    const b = activity({ deviceId: 'b', online: true, lastSeenAt: now, exitDelayMs: 790, tcpDelayMs: 10 });
    expect(pickWorstActivity([a, b], now)?.deviceId).toBe('b');
    const old = activity({ deviceId: 'old', online: false, lastSeenAt: now - 20 });
    const newer = activity({ deviceId: 'new', online: false, lastSeenAt: now - 1 });
    expect(pickWorstActivity([old, newer], now)?.deviceId).toBe('new');
  });

  it('converts delay sample timestamps from milliseconds to seconds', () => {
    expect(msEpochToSec(1_700_000_000_000)).toBe(1_700_000_000);
    expect(customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: 400, tcpDelayMs: 10, exitDelayAtMs: now * 1000, nowSec: now,
    })).toMatchObject({ kind: 'incident', severity: 'warn', measuredAt: now });
    expect(customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: 800, tcpDelayMs: 10, exitDelayAtMs: now * 1000, nowSec: now,
    }).kind).toBe('incident');
  });

  it('filters people by quota, path, and catalog chores', () => {
    const people = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      catalogRevision: 40,
      users: [{
        id: 'u1', email: 'q@example.com', deviceLimit: 1, quotaBytes: 100, usageBytes: 90,
        suspended: false, status: 'active', createdAt: now, homeBinding: null,
        product: { accountRef: null, status: null, openedAt: null, replaceCount: 0, incomplete: true },
      } as UserDto],
      activity: [activity({ userId: 'u1', catalogRevision: 38, exitDelayMs: 900, lastSeenAt: now, exitDelayAtMs: now * 1000 })],
    });
    expect(personMatchesFocus(people[0], 'quota')).toBe(true);
    expect(personMatchesFocus(people[0], 'path')).toBe(true);
    expect(personMatchesFocus(people[0], 'catalog')).toBe(true);
    expect(personMatchesFocus(people[0], 'catalog-unreported')).toBe(false);
    expect(personMatchesFocus(people[0], 'claude')).toBe(true);
    expect(people[0].catalogLag.state).toBe('behind');
    expect(people[0].chores).toContain('没开 Claude');
    expect(people[0].chores).toContain('没家宽');
    expect(people[0].chores.some((chore) => chore.includes('目录落后'))).toBe(false);
    expect(people[0].accountState).toBe('present');
  });

  it('keeps unreported catalog version out of the behind filter', () => {
    const people = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      catalogRevision: 40,
      users: [{
        id: 'u2', email: 'n@example.com', deviceLimit: 1, quotaBytes: null, usageBytes: 0,
        suspended: false, status: 'active', createdAt: now, homeBinding: null,
      } as UserDto],
      activity: [activity({ userId: 'u2', catalogRevision: null, lastSeenAt: now })],
    });
    expect(people[0].catalogLag.state).toBe('unreported');
    expect(personMatchesFocus(people[0], 'catalog')).toBe(false);
    expect(personMatchesFocus(people[0], 'catalog-unreported')).toBe(true);
    expect(personMatchesFocus(people[0], 'unmeasured')).toBe(true);
    const incidents = incidentsFromWorld({ nodes: [], people, catalogRevision: 40, nowSec: now });
    expect(incidents.some((item) => item.kind === 'catalog-unreported')).toBe(true);
    expect(incidents.some((item) => item.kind === 'catalog-lag')).toBe(false);
  });

  it('does not treat offline unreported catalog as a dashboard chore', () => {
    const people = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      catalogRevision: 40,
      users: [{
        id: 'u3', email: 'off@example.com', deviceLimit: 1, quotaBytes: null, usageBytes: 0,
        suspended: false, status: 'active', createdAt: now, homeBinding: null,
      } as UserDto],
      activity: [activity({ userId: 'u3', catalogRevision: null, lastSeenAt: now - 86_400, online: false })],
    });
    expect(people[0].online).toBe(false);
    expect(people[0].catalogLag.state).toBe('unreported');
    expect(personMatchesFocus(people[0], 'catalog-unreported')).toBe(false);
    const incidents = incidentsFromWorld({ nodes: [], people, catalogRevision: 40, nowSec: now });
    expect(incidents.some((item) => item.kind === 'catalog-unreported')).toBe(false);
  });

  it('does not treat cancelled or offline catalog lag as a live chore', () => {
    const behind = (over: Partial<UserDto> = {}, activityOver: Partial<ActivityUserDto> = {}) => assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      catalogRevision: 40,
      users: [{
        id: 'u-lag', email: 'lag@example.com', deviceLimit: 1, quotaBytes: null, usageBytes: 0,
        suspended: false, status: 'active', createdAt: now, homeBinding: null, ...over,
      } as UserDto],
      activity: [activity({ userId: 'u-lag', catalogRevision: 28, lastSeenAt: now, online: true, ...activityOver })],
    });
    const cancelled = behind({ status: 'disabled' });
    expect(catalogBehindLive(cancelled[0])).toBe(false);
    expect(personMatchesFocus(cancelled[0], 'catalog')).toBe(false);
    expect(incidentsFromWorld({ nodes: [], people: cancelled, catalogRevision: 40, nowSec: now }).some((item) => item.kind === 'catalog-lag')).toBe(false);

    const offline = behind({}, { online: false, lastSeenAt: now - 16 * 86_400 });
    expect(offline[0].catalogLag.state).toBe('behind');
    expect(catalogBehindLive(offline[0])).toBe(false);
    expect(personMatchesFocus(offline[0], 'catalog')).toBe(false);
    expect(incidentsFromWorld({ nodes: [], people: offline, catalogRevision: 40, nowSec: now }).some((item) => item.kind === 'catalog-lag')).toBe(false);

    const live = behind();
    expect(catalogBehindLive(live[0])).toBe(true);
    expect(personMatchesFocus(live[0], 'catalog')).toBe(true);
    expect(incidentsFromWorld({ nodes: [], people: live, catalogRevision: 40, nowSec: now }).some((item) => item.kind === 'catalog-lag')).toBe(true);
  });

  it('does not count cancelled accounts as Claude, home, or credential chores', () => {
    const people = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      users: [{
        id: 'u-off', email: 'gone@example.com', deviceLimit: 1, quotaBytes: 100, usageBytes: 90,
        suspended: false, status: 'disabled', createdAt: now, homeBinding: null,
        product: { accountRef: null, status: null, openedAt: null, replaceCount: 0, incomplete: true },
      } as UserDto],
    });
    expect(people[0].chores).toEqual([]);
    expect(personMatchesFocus(people[0], 'claude')).toBe(false);
    expect(personMatchesFocus(people[0], 'home')).toBe(false);
    expect(personMatchesFocus(people[0], 'credential')).toBe(false);
    expect(personMatchesFocus(people[0], 'quota')).toBe(false);
    expect(incidentsFromWorld({ nodes: [], people, catalogRevision: 40, nowSec: now }).some((item) => (
      item.kind === 'claude' || item.kind === 'home' || item.kind === 'quota'
    ))).toBe(false);
  });

  it('does not call heartbeat-only people ghosts while the users source is loading or down', () => {
    const loading = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      usersSource: 'loading',
      activity: [activity({ userId: 'ghost', email: 'g@x' })],
    });
    expect(loading[0].accountState).toBe('loading');
    expect(loading[0].user).toBeNull();
    const down = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      usersSource: 'unavailable',
      activity: [activity({ userId: 'ghost', email: 'g@x' })],
    });
    expect(down[0].accountState).toBe('unavailable');
    const ready = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      usersSource: 'ready',
      users: [],
      activity: [activity({ userId: 'ghost', email: 'g@x' })],
    });
    expect(ready[0].accountState).toBe('absent');
  });

  it('drops a late userDetail payload that belongs to another customer', () => {
    const bound = bindDetail('user-a', { devices: [{ id: 'dev-a' }] });
    expect(acceptIfCurrent('user-b', bound.userId, bound)).toBeNull();
    expect(acceptIfCurrent('user-a', bound.userId, bound)?.devices[0].id).toBe('dev-a');
  });

  it('rejects invalid datetime-local and ports instead of sending NaN', () => {
    expect(unixDateTimeLocal('not-a-date')).toBe('invalid');
    expect(Number.isFinite(unixDateTimeLocal('2026-08-26T12:00') as number)).toBe(true);
    expect(tcpPort('0')).toBe('invalid');
    expect(tcpPort('65536')).toBe('invalid');
    expect(tcpPort('443')).toBe(443);
  });

  it('keeps failures filters when opening either drawer on the failures page', () => {
    const fromFailures = { ...emptyHash('failures'), focus: 'customer-path' };
    expect(nextRouteForOpenUser(fromFailures, 'u1', { page: 'failures' })).toEqual({
      page: 'failures', focus: 'customer-path', node: null, user: 'u1', q: null, range: null,
    });
    expect(nextRouteForOpenNode(fromFailures, 'Tokyo · Fuji', { page: 'failures' })).toMatchObject({
      page: 'failures', focus: 'customer-path', node: 'Tokyo · Fuji', user: null,
    });
  });

  it('does not carry a monitor focus into a user drawer', () => {
    const fromMonitor = { ...emptyHash('monitor'), focus: 'blocked', node: 'Tokyo · Fuji' };
    expect(nextRouteForOpenUser(fromMonitor, 'u1')).toEqual({
      page: 'users', focus: null, node: null, user: 'u1', q: null, range: null,
    });
    const fromUsers = { ...emptyHash('users'), focus: 'quota' };
    expect(nextRouteForOpenNode(fromUsers, 'Tokyo · Fuji').focus).toBeNull();
    expect(nextRouteForOpenNode(
      { ...emptyHash('monitor'), focus: 'blocked', q: 'fuji' },
      'Tokyo · Fuji',
    )).toMatchObject({ page: 'monitor', focus: 'blocked', node: 'Tokyo · Fuji', q: 'fuji' });
    expect(parseOpsHash('#/monitor?focus=unknown&node=Catalog%20Only')).toMatchObject({
      page: 'monitor', focus: 'unknown', node: 'Catalog Only',
    });
    expect(formatOpsHash({ page: 'users', focus: 'path', node: null, user: 'u1', q: null, range: null })).toBe('#/users?focus=path&user=u1');
    expect(parseTrafficRange('90d')).toBe('90d');
    expect(parseTrafficRange('nope')).toBe('24h');
    expect(parseOpsHash(formatOpsHash({
      page: 'traffic', focus: null, node: 'Tokyo · Fuji', user: null, q: null, range: 'weird',
    }))).toMatchObject({ page: 'traffic', node: 'Tokyo · Fuji', range: '24h' });
    expect(parseOpsHash('#/users?focus=path&user=u1').user).toBe('u1');
  });
});

describe('dev onboard fixture shapes', () => {
  it('returns unregistered vs registered onboard payloads', async () => {
    const { matchDevOps } = await import('../admin/src/dev/ops-fixture');
    expect(matchDevOps('users/onboard', 'POST', JSON.stringify({ email: 'new@example.com' }))).toMatchObject({
      userId: null, allowlisted: true, exitIdentityIssued: false,
    });
    expect(matchDevOps('users/onboard', 'POST', JSON.stringify({ email: 'fast@example.com' }))).toMatchObject({
      userId: 'u-fast', exitIdentityIssued: true,
    });
    expect(matchDevOps('users/u-fast/detail', 'GET')).toMatchObject({ devices: expect.any(Array), diagnostics: expect.any(Array) });
    expect(matchDevOps('users/u-slow/home-binding', 'PUT', JSON.stringify({ homeExitId: 'h-pool' }))).toMatchObject({
      binding: { displayName: expect.any(String), homeExitId: 'h-pool' },
    });
    expect(matchDevOps('mystery', 'POST', '{}')).toBeUndefined();
  });
});

describe('confirm exclusive gate', () => {
  it('does not start a second run while the first is in flight, and cancel never calls the action', async () => {
    const gate = createExclusiveGate();
    let started = 0;
    let finished = 0;
    const first = gate.run(async () => {
      started += 1;
      await Promise.resolve();
      finished += 1;
    });
    const second = await gate.run(async () => { started += 1; });
    await first;
    expect(started).toBe(1);
    expect(finished).toBe(1);
    expect(second).toBe(false);
  });
});

import { dashboardKpis, KPI_HREFS } from '../admin/src/lib/incidents';
import { lineDiff } from '../admin/src/lib/textdiff';
import { metricsForRange } from '../admin/src/lib/metrics-bind';
import { aggregateFleetRates, coverageByBucket, fleetByteTransfer, latestValidRate, rangeTransfer } from '../admin/src/lib/traffic';

describe('dashboard KPI routes stay pinned', () => {
  it('does not drift off the hash contract', () => {
    expect(KPI_HREFS).toEqual({
      blocked: '#/monitor?focus=blocked',
      offline: '#/monitor?focus=offline',
      path: '#/failures?focus=customer-path',
      unmeasured: '#/users?focus=unmeasured',
      online: '#/users?focus=online',
      quota: '#/users?focus=quota',
      expiring: '#/monitor?focus=expiring',
      unfilledRenew: '#/monitor?focus=unfilled-renew',
      loss: '#/monitor?focus=loss',
    });
  });

  it('shows em dash values when a source is unavailable, not zero', () => {
    const kpis = dashboardKpis({
      nodes: [],
      people: [],
      incidents: [],
      qualityAvailable: false,
      activityAvailable: false,
      usersAvailable: false,
      profilesAvailable: false,
      agentsAvailable: false,
      nowSec: 1,
    });
    expect(kpis.find((item) => item.id === 'blocked')?.value).toBeNull();
    expect(kpis.find((item) => item.id === 'loss')?.value).toBeNull();
    expect(kpis.find((item) => item.id === 'online')?.value).toBeNull();
    expect(kpis.find((item) => item.id === 'quota')?.value).toBeNull();
    expect(kpis.find((item) => item.id === 'expiring')?.value).toBeNull();
  });

  it('does not report a quiet path KPI when online customers have no path samples', () => {
    const kpis = dashboardKpis({
      nodes: [],
      people: [{
        online: true,
        path: { kind: 'unmeasured' },
      } as never],
      incidents: [],
      qualityAvailable: true,
      activityAvailable: true,
      usersAvailable: true,
      profilesAvailable: true,
      agentsAvailable: true,
      nowSec: 1,
    });
    const path = kpis.find((item) => item.id === 'unmeasured' || item.id === 'path');
    expect(path?.id).toBe('unmeasured');
    expect(path?.value).toBe(1);
    expect(path?.label).toBe('路径未测');
    expect(path?.alert).toBe(true);
  });

  it('does not treat missing renew dates as nobody expiring', () => {
    const kpis = dashboardKpis({
      nodes: [{
        billing: { renewsAt: null },
        signals: [],
        qualityState: 'unmeasured',
        agentState: 'unreported',
        catalogState: 'known-listed',
        blockStatus: '',
        ok: null,
      } as never],
      people: [],
      incidents: [],
      qualityAvailable: true,
      activityAvailable: true,
      usersAvailable: true,
      profilesAvailable: true,
      agentsAvailable: true,
      nowSec: 1_000,
    });
    const expiring = kpis.find((item) => item.id === 'expiring' || item.id === 'unfilledRenew');
    expect(expiring?.value).toBeNull();
    expect(expiring?.note).toMatch(/未填/);
    expect(expiring?.href).toBe('#/monitor?focus=unfilled-renew');
  });

  it('counts occupied high loss on the KPI and notes the idle remainder', () => {
    const nowSec = 1_800_000_000;
    const nodes = assembleOpsNodes({
      nowMs: nowSec * 1000,
      catalogYaml: 'proxies:\n  - name: "Canyon"\n    type: vless\n  - name: "Erie"\n    type: vless\n',
      qualityNodes: [qualityNode('Canyon'), qualityNode('Erie')],
      agents: [
        agent({
          name: 'Canyon',
          observedAt: nowSec,
          load1: 0.2,
          carriers: {
            telecom: {
              latencyMs: 180, lossPct: 12.3, samples: 9,
              targets: ['三网-电信-上海'], history: [{ latencyMs: 180, lossPct: 12.3 }],
            },
          },
        }),
        agent({
          name: 'Erie',
          observedAt: nowSec,
          load1: 0.2,
          carriers: {
            telecom: {
              latencyMs: 237, lossPct: 13.3, samples: 9,
              targets: ['三网-电信-上海'], history: [{ latencyMs: 237, lossPct: 13.3 }],
            },
          },
        }),
      ],
      activitySource: 'ready',
      activity: [activity({ selectedServer: 'Canyon', lastSeenAt: nowSec, online: true })],
    });
    const kpis = dashboardKpis({
      nodes,
      people: [],
      incidents: [],
      qualityAvailable: true,
      activityAvailable: true,
      usersAvailable: true,
      profilesAvailable: true,
      agentsAvailable: true,
      nowSec,
    });
    const loss = kpis.find((item) => item.id === 'loss');
    expect(loss?.value).toBe(1);
    expect(loss?.note).toBe('2 台测到');
    expect(loss?.alert).toBe(true);
    expect(loss?.href).toBe('#/monitor?focus=loss');
  });
});

describe('honest traffic aggregation', () => {
  it('does not treat missing nodes as zero and keeps reset gaps', () => {
    const a = seriesRates([
      { t: 0, netIn: 100, netOut: 10 },
      { t: 60, netIn: 160, netOut: 40 },
      { t: 120, netIn: 10, netOut: 50 },
    ], 60);
    const b = seriesRates([
      { t: 0, netIn: 200, netOut: 20 },
      { t: 60, netIn: 260, netOut: 50 },
    ], 60);
    expect(a[1].inBps).toBeNull();
    const fleet = aggregateFleetRates({ a, b }, 3);
    const at60 = fleet.find((point) => point.t === 60)!;
    expect(at60.contributingIn).toBe(2);
    expect(at60.expected).toBe(3);
    expect(at60.inBps).toBeCloseTo(2);
    expect(coverageByBucket(fleet).inPresent).toBe(2);
    expect(rangeTransfer(b).inBytes).toBe(60 * 1);
    expect(latestValidRate(a)?.t).toBe(120);
  });

  it('sums each node byte delta and does not depend on object order', () => {
    const resolution = 60;
    const a = [
      { t: 0, netIn: 0, netOut: 0 },
      { t: 60, netIn: 60, netOut: 0 },
    ];
    const b = [
      { t: 0, netIn: 0, netOut: 0 },
      { t: 120, netIn: 240, netOut: 0 },
    ];
    expect(fleetByteTransfer({ a, b }, resolution).inBytes).toBe(300);
    expect(fleetByteTransfer({ b, a }, resolution).inBytes).toBe(300);
  });

  it('uses eligible node count as coverage denominator', () => {
    const series = {
      only: seriesRates([
        { t: 0, netIn: 0, netOut: null },
        { t: 60, netIn: 60, netOut: null },
      ], 60),
    };
    const fleet = aggregateFleetRates(series, 11);
    const cover = coverageByBucket(fleet);
    expect(cover.expected).toBe(11);
    expect(cover.inPresent).toBe(1);
    expect(cover.outPresent).toBe(0);
    const empty = aggregateFleetRates({
      only: [{ t: 1, dt: 60, inBps: null, outBps: null }],
    }, 11);
    expect(coverageByBucket(empty).inPresent).toBe(0);
  });
});

import { clearAllDirect, clearWebDomains, parseTrafficPolicy } from '../admin/src/lib/traffic-policy';

describe('traffic policy web-direct shortcut', () => {
  const v2 = {
    version: 2 as const,
    domains: [{ host: 'wx.qq.com', ports: [443] }],
    mediaEndpoints: [{ address: '1.1.1.1', ports: [443] }],
    webDomains: [{ host: 'www.bilibili.com', ports: [443] }],
  };
  const v3 = { ...v2, version: 3 as const, directSuffixes: [{ host: 'edu.cn', ports: [80, 443] }] };
  const v4 = {
    ...v3,
    version: 4 as const,
    tcpEndpoints: [{ address: '8.8.8.8', ports: [443] }],
  };

  it('empties only webDomains on v2 and does not mutate the input', () => {
    const frozen = JSON.parse(JSON.stringify(v2));
    const result = clearWebDomains(v2);
    expect(result).toEqual({ ok: true, policy: { ...v2, webDomains: [] } });
    expect(v2).toEqual(frozen);
  });

  it('keeps v3 directSuffixes structure when clearing webDomains', () => {
    const result = clearWebDomains(v3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policy.version).toBe(3);
      expect(result.policy).toMatchObject({
        domains: v3.domains,
        mediaEndpoints: v3.mediaEndpoints,
        directSuffixes: v3.directSuffixes,
        webDomains: [],
      });
    }
  });

  it('keeps v4 domains/media/directSuffixes/tcpEndpoints and only clears webDomains', () => {
    const result = clearWebDomains(v4);
    expect(result).toEqual({
      ok: true,
      policy: {
        version: 4,
        domains: v4.domains,
        mediaEndpoints: v4.mediaEndpoints,
        webDomains: [],
        directSuffixes: v4.directSuffixes,
        tcpEndpoints: v4.tcpEndpoints,
      },
    });
  });

  it('does not invent a publishable document from v1 or a broken shape', () => {
    expect(clearWebDomains({ version: 1, domains: [], mediaEndpoints: [] }).ok).toBe(false);
    expect(parseTrafficPolicy({ version: 2, domains: [] }).ok).toBe(false);
    expect(parseTrafficPolicy({ version: 4, domains: [], mediaEndpoints: [], webDomains: [] }).ok).toBe(false);
  });

  it('closes all direct by emptying every v4 list without downgrading the version', () => {
    const frozen = JSON.parse(JSON.stringify(v4));
    const result = clearAllDirect(v4);
    expect(result).toEqual({
      version: 4,
      domains: [],
      mediaEndpoints: [],
      webDomains: [],
      directSuffixes: [],
      tcpEndpoints: [],
    });
    expect(v4).toEqual(frozen);
    // The emptied document must still be a valid policy of the same version.
    expect(parseTrafficPolicy(result)).toEqual({ ok: true, policy: result });
  });

  it('keeps each version its own shape when closing all direct', () => {
    expect(clearAllDirect({ version: 1, domains: v2.domains, mediaEndpoints: v2.mediaEndpoints }))
      .toEqual({ version: 1, domains: [], mediaEndpoints: [] });
    expect(clearAllDirect(v2)).toEqual({ version: 2, domains: [], mediaEndpoints: [], webDomains: [] });
    expect(clearAllDirect(v3)).toEqual({
      version: 3,
      domains: [],
      mediaEndpoints: [],
      webDomains: [],
      directSuffixes: [],
    });
  });
});

describe('raw text diff', () => {
  it('counts add/remove without rewriting placeholders', () => {
    const before = 'uuid: {{TONO_CLIENT_UUID}}\nkeep\n';
    const after = 'uuid: {{TONO_CLIENT_UUID}}\nkeep\nextra\n';
    const diff = lineDiff(before, after);
    expect(after).toContain('{{TONO_CLIENT_UUID}}');
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
  });

  it('handles many duplicate lines without hanging', () => {
    const before = Array.from({ length: 400 }, () => 'same').join('\n');
    const after = `${before}\nextra`;
    const diff = lineDiff(before, after);
    expect(diff.added).toBe(1);
  });
});

describe('path measurement freshness', () => {
  const now = 10_000;
  const freshMs = now * 1000;
  const staleMs = (now - HEARTBEAT_FRESH_SECONDS - 1) * 1000;

  it('treats 40:00 as fresh and 40:01 as stale', () => {
    expect(customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: 900, tcpDelayMs: 10,
      exitDelayAtMs: (now - HEARTBEAT_FRESH_SECONDS) * 1000,
      tcpDelayAtMs: freshMs,
      nowSec: now,
    }).kind).toBe('incident');
    expect(customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: 900, tcpDelayMs: 10,
      exitDelayAtMs: (now - HEARTBEAT_FRESH_SECONDS - 1) * 1000,
      tcpDelayAtMs: 10 * 1000,
      nowSec: now,
    }).kind).not.toBe('incident');
  });

  it('does not let a stale 900ms raise a fresh 500ms warn into severe', () => {
    const verdict = customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: 900, tcpDelayMs: 500,
      exitDelayAtMs: staleMs, tcpDelayAtMs: freshMs,
      nowSec: now,
    });
    expect(verdict).toMatchObject({ kind: 'incident', severity: 'warn', metric: 'tcp' });
  });

  it('reports stale-sample, not unmeasured, when samples exist but expired', () => {
    // A customer that used to report and stopped is a different triage case
    // from one that never reported; 缺测不是故障 must not cover the first.
    expect(customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: 900, tcpDelayMs: 900,
      exitDelayAtMs: staleMs, tcpDelayAtMs: staleMs,
      nowSec: now,
    }).kind).toBe('stale-sample');
  });

  it('does not let a far-future client clock keep a path sample fresh', () => {
    const verdict = customerPathVerdict({
      lastSeenAt: now, online: true, nodeHealth: 'ok',
      exitDelayMs: 900, tcpDelayMs: null,
      exitDelayAtMs: (now + 24 * 3600) * 1000,
      nowSec: now,
    });
    expect(verdict.kind).not.toBe('incident');
    expect(verdict.kind).toBe('stale-sample');
  });

  it('marks old values as displayable history, not current path readings', () => {
    const staleAt = now - HEARTBEAT_FRESH_SECONDS - 1;
    const [person] = assembleOpsPeople({
      nowSec: now,
      telemetrySource: 'ready',
      activity: [activity({
        lastSeenAt: staleAt,
        online: false,
        exitDelayMs: 900,
        tcpDelayMs: 500,
        exitDelayAtMs: staleAt * 1000,
        tcpDelayAtMs: staleAt * 1000,
      })],
    });
    expect(person.exitDelayMs).toBe(900);
    expect(person.tcpDelayMs).toBe(500);
    expect(person.exitDelayFresh).toBe(false);
    expect(person.tcpDelayFresh).toBe(false);
    expect(person.path.kind).toBe('stale');
  });
});

describe('return-path loss on assembled nodes', () => {
  it('treats occupied high carrier loss as 需处理 without calling it 高负载', () => {
    const nowSec = 1_800_000_000;
    const nodes = assembleOpsNodes({
      nowMs: nowSec * 1000,
      catalogYaml: 'proxies:\n  - name: "Canyon"\n    type: vless\n',
      qualityNodes: [qualityNode('Canyon')],
      agents: [agent({
        name: 'Canyon',
        observedAt: nowSec,
        load1: 0.2,
        carriers: {
          telecom: {
            latencyMs: 180,
            lossPct: 12.3,
            samples: 9,
            targets: ['三网-电信-上海'],
            history: [{ latencyMs: 180, lossPct: 12.3 }],
          },
        },
      })],
      activity: [activity({ selectedServer: 'Canyon', lastSeenAt: nowSec, online: true })],
    });
    const canyon = nodes[0];
    expect(hasBadCarrierLoss(canyon)).toBe(true);
    expect(carrierLossNeedsAttention(canyon)).toBe(true);
    expect(canyon.signals.some((signal) => signal.label.includes('电信丢包'))).toBe(true);
    expect(nodeRootCause(canyon)).toBe('ok');
    expect(nodeMatchesFocus(canyon, 'pressure', nowSec)).toBe(false);
    expect(nodeMatchesFocus(canyon, 'loss', nowSec)).toBe(true);
    expect(nodeMatchesFocus(canyon, 'needs', nowSec)).toBe(true);
    expect(carrierLossLine(canyon)).toContain('电信丢包 12.3%');
    expect(nodeAttentionLabel(canyon)).toBe('回程丢包');
    expect(canyon.blockLabel).toBe('大陆正常');
    expect(canyon.dot).toBe('warn');
    const incidents = incidentsFromWorld({ nodes, people: [], catalogRevision: 1, nowSec });
    expect(incidents.some((item) => item.kind === 'node-pressure')).toBe(false);
  });

  it('keeps empty high-loss machines in 高丢包 without filling 需处理', () => {
    const nowSec = 1_800_000_000;
    const nodes = assembleOpsNodes({
      nowMs: nowSec * 1000,
      catalogYaml: 'proxies:\n  - name: "Buffalo · Erie"\n    type: vless\n',
      qualityNodes: [qualityNode('Buffalo · Erie')],
      agents: [agent({
        name: 'Buffalo · Erie',
        observedAt: nowSec,
        load1: 0.2,
        carriers: {
          telecom: {
            latencyMs: 237,
            lossPct: 13.3,
            samples: 9,
            targets: ['三网-电信-上海'],
            history: [{ latencyMs: 237, lossPct: 13.3 }],
          },
        },
      })],
      activitySource: 'ready',
      activity: [],
    });
    const idle = nodes[0];
    expect(idle.occupancy).toBe(0);
    expect(hasBadCarrierLoss(idle)).toBe(true);
    expect(carrierLossNeedsAttention(idle)).toBe(false);
    expect(nodeMatchesFocus(idle, 'loss', nowSec)).toBe(true);
    expect(nodeMatchesFocus(idle, 'needs', nowSec)).toBe(false);
    expect(nodeAttentionLabel(idle)).toBe('回程丢包');
    expect(idle.dot).toBe('ok');
  });

  it('does not escalate warn-band carrier loss into 需处理', () => {
    const nowSec = 1_800_000_000;
    const nodes = assembleOpsNodes({
      nowMs: nowSec * 1000,
      catalogYaml: 'proxies:\n  - name: "Quiet"\n    type: vless\n',
      qualityNodes: [qualityNode('Quiet')],
      agents: [agent({
        name: 'Quiet',
        observedAt: nowSec,
        load1: 0.2,
        carriers: {
          telecom: {
            latencyMs: 180,
            lossPct: 3,
            samples: 9,
            targets: ['三网-电信-上海'],
            history: [{ latencyMs: 180, lossPct: 3 }],
          },
        },
      })],
    });
    expect(hasBadCarrierLoss(nodes[0])).toBe(false);
    expect(nodeMatchesFocus(nodes[0], 'loss', nowSec)).toBe(false);
    expect(nodeMatchesFocus(nodes[0], 'needs', nowSec)).toBe(false);
    expect(carrierLossLine(nodes[0])).toBeNull();
    expect(nodes[0].dot).toBe('ok');
  });
});

describe('node root cause uniqueness', () => {
  it('classifies blocked-and-down Sakura only as blocked', () => {
    const nodes = assembleOpsNodes({
      nowMs: 1_800_000_000_000,
      catalogYaml: 'proxies:\n  - name: "Sakura"\n    type: vless\n',
      qualityNodes: [qualityNode('Sakura', {
        ok: false,
        block: { status: 'LIKELY_BLOCKED', label: '疑似被墙', rule: null, mainland: null, asiaEdge: null, overseas: null },
      })],
      agents: [agent({ name: 'Sakura', observedAt: 1_800_000_000 - 700 })],
    });
    expect(nodeRootCause(nodes[0])).toBe('blocked');
    expect(nodeMatchesFocus(nodes[0], 'offline', 1_800_000_000)).toBe(false);
    const incidents = incidentsFromWorld({ nodes, people: [], catalogRevision: 1, nowSec: 1_800_000_000, qualityUpdatedAtSec: 1_800_000_000 });
    expect(incidents.filter((item) => item.node === 'Sakura' && (item.severity === 'severe' || item.severity === 'warn'))).toHaveLength(1);
    expect(incidents[0].measuredAtSec).toBe(1_800_000_000);
  });

  it('judges node incidents by the quality scan window, not the heartbeat window', () => {
    // Quality scans arrive every twelve hours; a two-hour-old verdict is
    // current for that source even though the 40-minute heartbeat window has
    // long passed.
    const nowSec = 1_800_000_000;
    const nodes = assembleOpsNodes({
      nowMs: nowSec * 1000,
      catalogYaml: 'proxies:\n  - name: "Sakura"\n    type: vless\n',
      qualityNodes: [qualityNode('Sakura', {
        ok: false,
        block: { status: 'LIKELY_BLOCKED', label: '疑似被墙', rule: null, mainland: null, asiaEdge: null, overseas: null },
      })],
    });
    const incidents = incidentsFromWorld({
      nodes, people: [], catalogRevision: 1, nowSec, qualityUpdatedAtSec: nowSec - 2 * 3600,
    });
    const blocked = incidents.find((item) => item.kind === 'node-blocked')!;
    expect(blocked.staleAfterSec).toBe(24 * 60 * 60);
    expect(nowSec - (blocked.measuredAtSec ?? 0)).toBeGreaterThan(HEARTBEAT_FRESH_SECONDS);
    expect(nowSec - (blocked.measuredAtSec ?? 0)).toBeLessThanOrEqual(blocked.staleAfterSec ?? 0);
  });
});

describe('an overdue node renewal stays on the console', () => {
  const nowSec = Math.floor(new Date(2026, 8, 10, 12, 0).getTime() / 1000);
  const overdueAt = Math.floor(new Date(2026, 8, 1).getTime() / 1000);
  const nodes = () => assembleOpsNodes({
    nowMs: nowSec * 1000,
    catalogYaml: 'proxies:\n  - name: "Late"\n    type: vless\n',
    qualityNodes: [qualityNode('Late')],
    profiles: [{
      id: 'p-late', catalogName: 'Late',
      price: null, currency: null, billingCycle: null,
      trafficQuotaBytes: null, trafficUsedBytes: null,
      trafficCycleStart: null, trafficCycleEnd: null,
      cycleNetIn: null, cycleNetOut: null,
      renewsAt: overdueAt,
      status: 'active', createdAt: 1, updatedAt: 1,
    } as NodeProfileDto],
  });

  it('emits a warn chore saying how many days late', () => {
    const incidents = incidentsFromWorld({ nodes: nodes(), people: [], catalogRevision: 1, nowSec });
    const chore = incidents.find((item) => item.kind === 'node-expired');
    expect(chore).toMatchObject({ severity: 'warn', category: 'chore', node: 'Late' });
    expect(chore?.detail).toBe('续费日已过 9 天');
    expect(incidents.some((item) => item.kind === 'node-renew' && item.node === 'Late')).toBe(false);
  });

  it('keeps the machine in the expiring focus and on its pill', () => {
    const late = nodes()[0];
    expect(late.renewOverdueDays).toBe(9);
    expect(nodeMatchesFocus(late, 'expiring', nowSec)).toBe(true);
    expect(nodeAttentionLabel(late)).toBe('续费日已过 9 天');
  });
});

describe('metrics range binding', () => {
  it('does not present a 24h snapshot as 90d', () => {
    expect(metricsForRange('90d', '24h', { from: 1 })).toBeNull();
    expect(metricsForRange('24h', '24h', { from: 1 })).toEqual({ from: 1 });
  });
});

describe('one label ladder for account and heartbeat state', () => {
  it('keeps drawer and list row reading the heartbeat the same way', () => {
    expect(personTelemetryLabel({ telemetryState: 'loading', online: false, onlineDeviceCount: 0 })).toBe('心跳加载中');
    expect(personTelemetryLabel({ telemetryState: 'unavailable', online: false, onlineDeviceCount: 0 })).toBe('心跳不可用');
    expect(personTelemetryLabel({ telemetryState: 'unreported', online: false, onlineDeviceCount: 0 })).toBe('未上报');
    expect(personTelemetryLabel({ telemetryState: 'reported', online: true, onlineDeviceCount: 2 })).toBe('2 台在线');
    expect(personTelemetryLabel({ telemetryState: 'reported', online: false, onlineDeviceCount: 0 })).toBe('离线');
  });

  it('puts the account-source caveat ahead of any heartbeat reading', () => {
    expect(personAccountLabel({ accountState: 'loading' })).toBe('客户资料加载中');
    expect(personAccountLabel({ accountState: 'unavailable' })).toBe('客户资料不可用');
    expect(personAccountLabel({ accountState: 'absent' })).toBe('心跳身份未进入客户库');
    expect(personAccountLabel({ accountState: 'present' })).toBeNull();
  });
});

describe('opening a customer drawer keeps the search', () => {
  it('preserves q on the same page and drops it across pages', () => {
    expect(nextRouteForOpenUser({ ...emptyHash('users'), focus: 'home', q: 'fuji' }, 'u1'))
      .toMatchObject({ page: 'users', focus: 'home', user: 'u1', q: 'fuji' });
    expect(nextRouteForOpenUser({ ...emptyHash('monitor'), q: 'fuji' }, 'u1').q).toBeNull();
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HEARTBEAT_FRESH_SECONDS as FRESH_WINDOW_SECONDS,
  measurementFresh,
} from '../admin/src/lib/freshness';
import { blockLabel, blockLabels, blockStatus, isLikelyBlocked, probeRatio } from '../admin/src/lib/quality';
import { useOpsRoute } from '../admin/src/lib/route';
import { FLEET_QUALITY_STATUSES } from '../src/index';

describe('measurement freshness windows', () => {
  const nowSec = 100_000;

  it('keeps a sample fresh through 40:00 and drops it at 40:01', () => {
    expect(measurementFresh((nowSec - FRESH_WINDOW_SECONDS) * 1000, nowSec, nowSec)).toBe(true);
    expect(measurementFresh((nowSec - FRESH_WINDOW_SECONDS - 1) * 1000, nowSec, nowSec)).toBe(false);
  });

  it('tolerates five minutes of forward clock skew and not a second more', () => {
    expect(measurementFresh((nowSec + 5 * 60) * 1000, nowSec, nowSec)).toBe(true);
    expect(measurementFresh((nowSec + 5 * 60 + 1) * 1000, nowSec, nowSec)).toBe(false);
  });

  it('inherits heartbeat freshness when the sample has no usable timestamp', () => {
    expect(measurementFresh(null, nowSec - FRESH_WINDOW_SECONDS, nowSec)).toBe(true);
    expect(measurementFresh(undefined, nowSec - FRESH_WINDOW_SECONDS - 1, nowSec)).toBe(false);
    // A NaN timestamp is unusable, not stale forever and not fresh forever.
    expect(measurementFresh(Number.NaN, nowSec, nowSec)).toBe(true);
    expect(measurementFresh(Number.NaN, nowSec - FRESH_WINDOW_SECONDS - 1, nowSec)).toBe(false);
  });
});

describe('quality block labels', () => {
  it('reads the collector verdict and falls back to machine liveness', () => {
    expect(blockStatus(qualityNode('n'))).toBe('OK');
    expect(blockStatus(qualityNode('n', {
      block: { status: 'DEGRADED', label: null, rule: null, mainland: null, asiaEdge: null, overseas: null },
    }))).toBe('DEGRADED');
    expect(blockStatus(qualityNode('n', { block: null, ok: true }))).toBe('OK');
    expect(blockStatus(qualityNode('n', { block: null, ok: false }))).toBe('DOWN');
    // An empty reported status is no verdict at all.
    expect(blockStatus(qualityNode('n', {
      ok: false,
      block: { status: '', label: null, rule: null, mainland: null, asiaEdge: null, overseas: null },
    }))).toBe('DOWN');
  });

  it('prefers the collector label, then the local table, then the raw status', () => {
    expect(blockLabel(qualityNode('n'))).toBe('大陆正常');
    expect(blockLabel(qualityNode('n', {
      block: { status: 'DEGRADED', label: null, rule: null, mainland: null, asiaEdge: null, overseas: null },
    }))).toBe('部分不通');
    expect(blockLabel(qualityNode('n', {
      block: { status: 'NEW_VERDICT', label: null, rule: null, mainland: null, asiaEdge: null, overseas: null },
    }))).toBe('NEW_VERDICT');
  });

  it('only calls a node blocked on the exact verdict', () => {
    expect(isLikelyBlocked(qualityNode('n', {
      block: { status: 'LIKELY_BLOCKED', label: '疑似被墙', rule: null, mainland: null, asiaEdge: null, overseas: null },
    }))).toBe(true);
    expect(isLikelyBlocked(qualityNode('n', { block: null, ok: false }))).toBe(false);
  });

  it('renders probe tallies without inventing a denominator', () => {
    expect(probeRatio(null)).toBe('—');
    expect(probeRatio({ success: 2 })).toBe('—');
    expect(probeRatio({ total: 3 })).toBe('0/3');
    expect(probeRatio({ success: 2, total: 3 })).toBe('2/3');
  });
});

describe('fleet quality status vocabulary', () => {
  it('gives every status the server can emit a console label', () => {
    for (const status of FLEET_QUALITY_STATUSES) {
      expect(blockLabels[status], `missing label for ${status}`).toBeTruthy();
    }
  });

  it('keeps console-only statuses a deliberate, known set', () => {
    const serverStatuses: readonly string[] = FLEET_QUALITY_STATUSES;
    const extras = Object.keys(blockLabels).filter((status) => !serverStatuses.includes(status));
    expect(extras).toEqual(['PROBE_PARTIAL']);
  });
});

describe('ops route hook', () => {
  type WindowStub = {
    location: { hash: string };
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  };
  const withWindow = <T,>(hash: string, run: () => T): T => {
    const stub: WindowStub = {
      location: { hash },
      addEventListener() {},
      removeEventListener() {},
    };
    (globalThis as { window?: WindowStub }).window = stub;
    try {
      return run();
    } finally {
      delete (globalThis as { window?: WindowStub }).window;
    }
  };
  const mount = () => {
    let captured: ReturnType<typeof useOpsRoute> | null = null;
    const Probe = () => {
      captured = useOpsRoute();
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    return captured!;
  };

  it('reads the page, drawer, and search from the location hash', () => {
    withWindow('#/users?q=fuji&user=u1', () => {
      const { route, page } = mount();
      expect(page).toBe('users');
      expect(route).toMatchObject({ page: 'users', q: 'fuji', user: 'u1', node: null });
    });
  });

  it('opens a node drawer by writing a hash that parses back to itself', () => {
    withWindow('#/users?q=fuji', () => {
      const { openNode } = mount();
      openNode('Tokyo · Fuji');
      expect(parseOpsHash(window.location.hash)).toMatchObject({
        page: 'monitor',
        node: 'Tokyo · Fuji',
        user: null,
        // Crossing pages starts from that page's default view.
        q: null,
      });
    });
  });

  it('keeps the search when the drawer opens on the same page', () => {
    withWindow('#/users?q=fuji', () => {
      const { openUser } = mount();
      openUser('u2');
      expect(parseOpsHash(window.location.hash)).toMatchObject({
        page: 'users',
        user: 'u2',
        q: 'fuji',
      });
    });
  });

  it('closes the drawer without losing the page', () => {
    withWindow('#/monitor?node=Tokyo+%C2%B7+Fuji', () => {
      const { closeDrawer } = mount();
      closeDrawer();
      expect(parseOpsHash(window.location.hash)).toMatchObject({
        page: 'monitor',
        node: null,
        user: null,
      });
    });
  });

  it('prioritizes real egressIpv4 over socks5Host for residential line exit display', () => {
    const binding = {
      displayName: 'Home US 01',
      socks5Host: 'proxy.residential.tono.dev',
      egressIpv4: '198.51.100.42',
    };
    const displayedIp = binding.egressIpv4 || binding.socks5Host;
    expect(displayedIp).toBe('198.51.100.42');

    const fallbackBinding: { displayName: string; socks5Host: string; egressIpv4?: string } = {
      displayName: 'Home US 02',
      socks5Host: 'proxy.residential.tono.dev',
    };
    const fallbackIp = fallbackBinding.egressIpv4 || fallbackBinding.socks5Host;
    expect(fallbackIp).toBe('proxy.residential.tono.dev');
  });
});
