import { describe, expect, it } from 'vitest';
import { catalogProxyNames } from '../admin/src/lib/catalog';
import { formatBytes } from '../admin/src/lib/format';
import { machineSignals, mergedBilling, trafficRemaining } from '../admin/src/lib/machine';
import { gibibytes, unixDate } from '../admin/src/lib/fields';
import { dataHealthLines } from '../admin/src/lib/health';
import { publishGate, catalogLag } from '../admin/src/lib/revision';
import { carrierRows, worstCarrier, latencyTone, lossTone } from '../admin/src/lib/carrier';
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
