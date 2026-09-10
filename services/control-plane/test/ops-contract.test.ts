// The contract checkers are the only thing standing between a handler that
// quietly drops a field and a console page full of numbers with no freshness.
// So the cases here are the three ways a response drifts — a key goes missing,
// a key appears, a type changes — plus the vocabulary tables that decide what
// colour an operator sees.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  assertActivityHour,
  assertAdoptionMatrix,
  assertAlertDelivery,
  assertAlertRule,
  assertAuditEntry,
  assertConnectionEvent,
  assertCustomerDetail,
  assertCustomerSummary,
  assertDestinationRow,
  assertDirectCandidate,
  assertHomeLine,
  assertHomeLineUsageDay,
  assertAuditList,
  assertIncident,
  assertIncidentDetail,
  assertIncidentEvent,
  assertJob,
  assertList,
  assertNodeDetail,
  assertNodeHistoryEntry,
  assertNodeSummary,
  assertProviderAccount,
  assertRelease,
  assertServiceUsage,
  assertSystemHealth,
  CONTRACT_VERSION,
  customerHealthWord,
  healthWordForVerdict,
  NODE_VERDICTS,
  toneFor,
  type CustomerHealthWord,
  type CustomerVerdict,
  type Measured,
  type NodeHealthWord,
  type NodeVerdict,
  type Tone,
} from '../src/ops/contract';

const measured = <T>(value: T, asOfSec: number | null = 1_757_000_000): Measured<T> =>
  ({ value, asOfSec, source: 'collector' });

const quota = () => ({
  quota: 500 * 1024 ** 3,
  used: 120 * 1024 ** 3,
  pct: 24,
  projectedExhaustAt: 1_759_000_000,
  level: 'ok' as const,
  cycleKind: 'calendar_day' as const,
  cycleStart: 1_756_684_800,
  cycleEnd: 1_759_276_800,
  counts: 'in_out' as const,
});

const forward = () => ({
  carrier: 'mobile' as const,
  successRate: 0.62,
  medianTcpMs: 380,
  topFailure: 'handshake_timeout',
  attempts: 34,
  users: 3,
});

const returnPath = () => ({ carrier: 'telecom' as const, latencyMs: 180, lossPct: 0.4, samples: 12 });

const nodeSummary = () => ({
  name: '洛杉矶 CN2 GIA',
  verdict: 'blocked' as const,
  health: '被墙' as const,
  tone: 'sev' as const,
  reason: '大陆三网连续两轮探测失败，海外正常',
  lifecycle: 'listed' as const,
  catalogListed: true,
  region: 'us-west',
  provider: 'RackNerd',
  occupancy: measured(3),
  quota: measured(quota()),
  forwardWorst: measured(forward()),
  returnWorst: measured(returnPath()),
  renewsAt: 1_759_276_800,
  expiresAt: null,
  choreCount: 1,
  incidentCount: 1,
  updatedAt: 1_757_000_100,
});

const job = () => ({
  id: 'job-1',
  type: 'xray_dial_errors' as const,
  executor: 'hub' as const,
  status: 'succeeded' as const,
  subjectType: 'node' as const,
  subjectId: '洛杉矶 CN2 GIA',
  params: { tail: 200, since: '2026-09-09', verbose: false, note: null, carriers: ['ct', 'cu'] },
  attempts: 1,
  maxAttempts: 3,
  idempotencyKey: 'xray_dial_errors:洛杉矶 CN2 GIA:1757000000',
  requestedBy: 'rw@drrki.com',
  incidentId: 'inc-1',
  notBefore: null,
  expiresAt: 1_757_000_900,
  leasedUntil: null,
  resultSummary: '拨号超时 41 次，握手失败 6 次',
  createdAt: 1_757_000_000,
  updatedAt: 1_757_000_120,
  finishedAt: 1_757_000_120,
});

const nodeDetail = () => ({
  name: '洛杉矶 CN2 GIA',
  verdict: 'ok' as const,
  health: '正常' as const,
  tone: 'ok' as const,
  reason: null,
  lifecycle: 'listed' as const,
  catalogListed: true,
  facts: {
    publicIp: '203.0.113.10',
    os: 'Debian 12',
    region: 'us-west',
    provider: 'RackNerd',
    providerAccountId: 'acct-1',
    lineTags: ['CN2GIA'],
    port: 443,
    price: 10.88,
    currency: 'USD',
    billingCycle: 12,
    renewsAt: 1_759_276_800,
    expiresAt: null,
    notes: null,
    createdAt: 1_700_000_000,
    updatedAt: 1_757_000_000,
  },
  bindings: {
    catalog: true,
    exitToken: true,
    komari: true,
    identitySync: false,
    metering: true,
    asOfSec: 1_757_000_000,
  },
  forwardPath: measured([forward()]),
  returnPath: measured([returnPath()]),
  occupancy: measured([{
    userId: 'u-1',
    email: 'a@example.com',
    deviceId: 'd-1',
    platform: 'macos' as const,
    appVersion: '0.0.72',
    online: true,
    lastSeenAt: 1_757_000_000,
  }]),
  quota: measured(quota()),
  recentErrors: measured([{ dayAt: 1_756_944_000, category: 'dial_timeout', count: 41, sample: 'i/o timeout' }]),
  jobs: [job()],
  history: [{
    at: 1_756_900_000,
    verdict: 'blocked' as const,
    health: '被墙' as const,
    tone: 'sev' as const,
    reason: '大陆三网探测失败',
    source: 'engine' as const,
    rulesVersion: 3,
  }],
  updatedAt: 1_757_000_100,
});

const customerSummary = () => ({
  userId: 'u-1',
  email: 'a@example.com',
  verdict: 'unreachable' as const,
  health: '连不上' as const,
  tone: 'sev' as const,
  reason: '30 分钟内 3 次失败，之后没有成功',
  lifecycle: 'active' as const,
  deviceCount: 2,
  platforms: ['macos' as const, 'windows' as const],
  selectedServer: '洛杉矶 CN2 GIA',
  connected: measured(false),
  lastFailure: { at: 1_757_000_000, node: '洛杉矶 CN2 GIA', stage: 'handshake', code: 'ETIMEDOUT' },
  usageBytes: measured(42 * 1024 ** 3),
  quotaBytes: null,
  services: ['claude' as const, 'meta' as const],
  minAppVersion: '0.0.70',
  expiresAt: 1_759_276_800,
  lastSeenAt: 1_757_000_000,
  updatedAt: 1_757_000_100,
});

const customerDetail = () => ({
  userId: 'u-1',
  email: 'a@example.com',
  verdict: 'ok' as const,
  health: '正常' as const,
  tone: 'ok' as const,
  reason: null,
  lifecycle: 'active' as const,
  now: {
    connected: measured(true),
    node: '东京',
    connectedSince: 1_756_999_000,
    deviceId: 'd-1',
    platform: 'macos' as const,
    appVersion: '0.0.72',
    osVersion: '26.1',
    carrier: 'China Mobile',
    asn: 9808,
    region: 'JS',
  },
  devices: [{
    id: 'd-1',
    name: 'MacBook Pro',
    platform: 'macos' as const,
    appVersion: '0.0.72',
    osVersion: '26.1',
    status: 'active',
    selectedServer: '东京',
    lastSeenAt: 1_757_000_000,
    createdAt: 1_700_000_000,
  }],
  chores: [{ id: 'c-1', kind: 'expiry_soon', summary: '7 天后到期', dueAt: 1_757_600_000, createdAt: 1_757_000_000 }],
  billing: {
    plan: 'standard',
    deviceLimit: 3,
    quotaBytes: null,
    usageBytes: measured(42 * 1024 ** 3),
    expiresAt: 1_759_276_800,
    firstEntitledAt: 1_700_000_000,
    createdAt: 1_700_000_000,
  },
  updatedAt: 1_757_000_100,
});

const incident = () => ({
  id: 'inc-1',
  dedupeKey: 'node_blocked:洛杉矶 CN2 GIA',
  kind: 'node_blocked',
  subjectType: 'node' as const,
  subjectId: '洛杉矶 CN2 GIA',
  severity: 'severe' as const,
  status: 'open' as const,
  tone: 'sev' as const,
  title: '洛杉矶 CN2 GIA 被墙，影响 5 位客户',
  summary: '大陆三网连续两轮探测失败，海外探测正常',
  parentIncidentId: null,
  rulesVersion: 3,
  impactCount: 5,
  evidence: [{ label: '大陆三网探测', value: '0/9 成功', asOfSec: 1_757_000_000, source: 'collector' as const }],
  openedAt: 1_756_900_000,
  lastSeenAt: 1_757_000_000,
  ackedAt: null,
  snoozedUntil: null,
  resolvedAt: null,
});

const connectionEvent = () => ({
  id: 'w-1:3',
  atMs: 1_757_000_000_000,
  receivedAt: 1_757_000_010,
  source: 'failure' as const,
  userId: 'u-1',
  deviceId: 'd-1',
  platform: 'windows' as const,
  appVersion: '0.0.72',
  osVersion: '10.0.26100',
  kind: 'connectFail' as const,
  node: '洛杉矶 CN2 GIA',
  stage: 'handshake',
  outcome: 'fail',
  code: 'ETIMEDOUT',
  error: 'dial tcp: i/o timeout',
  elapsedMs: 8_000,
  delayMs: null,
  tcpDelayMs: null,
  exitDelayMs: null,
  catalogRevision: 214,
  edgeAsn: 9808,
  edgeAsOrg: 'China Mobile',
  edgeCountry: 'CN',
  edgeRegion: 'JS',
  edgeViaExit: false,
});

const homeLine = () => ({
  id: 'h-1',
  proxyName: 'home-js',
  displayName: '江苏家宽',
  status: 'active',
  isp: 'China Telecom',
  region: 'JS',
  providerAccountId: null,
  price: 39.9,
  currency: 'CNY',
  billingKind: 'per_gb' as const,
  bundleBytes: 200 * 1024 ** 3,
  cycleStart: 1_756_684_800,
  cycleEnd: 1_759_276_800,
  expiresAt: 1_759_276_800,
  meterSource: 'client_route' as const,
  usage: measured({ bytesUp: 10, bytesDown: 20, users: 2, source: 'client_route' as const }),
  probe: measured({ alive: 11, total: 12, uptimeRatio: 0.91, status: 'ok' }),
  boundUsers: measured(2),
  notes: null,
  createdAt: 1_700_000_000,
  updatedAt: 1_757_000_000,
});

/** Every checker with a fixture it must accept unchanged. */
const CASES: Array<[string, (value: unknown, path?: string) => unknown, () => Record<string, unknown>]> = [
  ['nodeSummary', assertNodeSummary, nodeSummary],
  ['nodeDetail', assertNodeDetail, nodeDetail],
  ['nodeHistoryEntry', assertNodeHistoryEntry, () => nodeDetail().history[0]],
  ['customerSummary', assertCustomerSummary, customerSummary],
  ['customerDetail', assertCustomerDetail, customerDetail],
  ['connectionEvent', assertConnectionEvent, connectionEvent],
  ['activityHour', assertActivityHour, () => ({
    hourAt: 1_757_000_000,
    onlineMinutes: 60,
    connectedMinutes: 41,
    bytesUp: 1_024,
    bytesDown: 8_192,
    node: '东京',
    platform: 'macos' as const,
    appVersion: '0.0.72',
  })],
  ['destination', assertDestinationRow, () => ({
    dayAt: 1_756_944_000,
    etld1: 'anthropic.com',
    route: 'cloud' as const,
    node: '东京',
    connections: 42,
    bytesUp: 1_024,
    bytesDown: 99_000,
    topProcesses: ['Claude', 'Safari'],
  })],
  ['serviceUsage', assertServiceUsage, () => ({
    dayAt: 1_756_944_000,
    family: 'claude' as const,
    route: 'cloud' as const,
    bytes: 99_000,
    sessions: 12,
    lastSeenAt: 1_757_000_000,
  })],
  ['incident', assertIncident, incident],
  ['incidentDetail', assertIncidentDetail, () => ({
    incident: incident(),
    events: {
      items: [{
        id: 'ev-1', incidentId: 'inc-1', at: 1_756_900_000,
        type: 'opened' as const, actor: null, note: null,
      }],
      nextCursor: null,
      updatedAt: 1_757_000_000,
      total: 1,
    },
    jobs: { items: [job()], nextCursor: null, updatedAt: 1_757_000_000, total: 1 },
    deliveries: {
      items: [{
        id: 'ad-1', ruleId: 'ar-1', incidentId: 'inc-1',
        dedupeKey: 'ar-1:node_blocked:open:1756900000',
        transition: 'open' as const, status: 'suppressed' as const,
        channel: 'webhook' as const, target: '123456789',
        attempts: 0, error: null, at: 1_756_900_100, deliveredAt: null,
      }],
      nextCursor: null,
      updatedAt: 1_757_000_000,
      total: 1,
    },
  })],
  ['incidentEvent', assertIncidentEvent, () => ({
    id: 'ev-1',
    incidentId: 'inc-1',
    at: 1_756_900_000,
    type: 'opened' as const,
    actor: null,
    note: null,
  })],
  ['job', assertJob, job],
  ['release', assertRelease, () => ({
    id: 'r-1',
    platform: 'macos' as const,
    channel: 'stable' as const,
    version: '0.0.72',
    build: '720',
    r2Key: 'releases/macos/0.0.72.dmg',
    sha256: 'a'.repeat(64),
    notes: '稳定性修复',
    minSupportedVersion: '0.0.68',
    publishedAt: 1_756_900_000,
    withdrawnAt: null,
    createdAt: 1_756_800_000,
    updatedAt: 1_756_900_000,
  })],
  ['adoption', assertAdoptionMatrix, () => ({
    range: '30d' as const,
    released: ['macos' as const, 'windows' as const],
    cells: [{ platform: 'macos' as const, bucket: 'current' as const, users: 4, devices: 5 }],
    updatedAt: 1_757_000_000,
  })],
  ['alertRule', assertAlertRule, () => ({
    id: 'ar-1',
    name: '严重事故推 Telegram',
    enabled: true,
    matchKind: 'node_blocked',
    matchSubjectType: 'node',
    matchSubjectId: null,
    minSeverity: 'severe' as const,
    minImpact: 1,
    fireOn: 'open_resolve' as const,
    delaySeconds: 900,
    cooldownSeconds: 3_600,
    channel: 'webhook' as const,
    target: '123456789',
    template: 'telegram' as const,
    secretRef: 'ALERT_TELEGRAM_BOT_TOKEN',
    lastFiredAt: null,
    createdAt: 1_756_800_000,
    updatedAt: 1_756_800_000,
  })],
  ['alertDelivery', assertAlertDelivery, () => ({
    id: 'ad-1',
    ruleId: 'ar-1',
    incidentId: 'inc-1',
    dedupeKey: 'ar-1:node_blocked:opened:1756900000',
    transition: 'open' as const,
    status: 'suppressed' as const,
    channel: 'webhook' as const,
    target: '123456789',
    attempts: 0,
    error: null,
    at: 1_756_900_100,
    deliveredAt: null,
  })],
  ['auditList', assertAuditList, () => ({
    entries: [{
      id: 'au-1',
      at: 1_757_000_000,
      actorEmail: 'rw@drrki.com',
      actorType: 'access_admin' as const,
      actorRole: 'owner',
      action: 'node.retire',
      targetType: 'fleet_node',
      targetId: '洛杉矶 CN2 GIA',
      summary: 'retired 洛杉矶 CN2 GIA: 被墙',
      requestId: 'req-1',
    }],
    hasMore: false,
    nextBefore: null,
    nextBeforeId: null,
  })],
  ['auditEntry', assertAuditEntry, () => ({
    id: 'au-1',
    at: 1_757_000_000,
    actorEmail: 'rw@drrki.com',
    actorType: 'access_admin' as const,
    actorRole: 'owner',
    action: 'node.retire',
    targetType: 'fleet_node',
    targetId: '洛杉矶 CN2 GIA',
    summary: 'retired 洛杉矶 CN2 GIA: 被墙',
    requestId: 'req-1',
  })],
  ['systemHealth', assertSystemHealth, () => ({
    ok: false,
    buildSha: 'deadbeef',
    contractVersion: CONTRACT_VERSION,
    sources: [{ source: 'collector' as const, state: 'stale' as const, asOfSec: 1_756_000_000, message: '收集器 22 分钟未上报' }],
    cronLastRunAt: 1_757_000_000,
    cronLastDurationMs: 812,
    cronLastError: null,
    cronSteps: null,
    updatedAt: 1_757_000_000,
  })],
  ['directCandidate', assertDirectCandidate, () => ({
    etld1: 'bilibili.com',
    status: 'new' as const,
    firstSeen: 1_756_000_000,
    users: 3,
    bytes30d: 9_000_000,
    countryHint: 'CN',
    decidedBy: null,
    decidedAt: null,
  })],
  ['providerAccount', assertProviderAccount, () => ({
    id: 'acct-1',
    provider: 'RackNerd',
    label: '主账号',
    cloudKind: 'vps' as const,
    loginEmailMasked: 'r••@drrki.com',
    billingUrl: 'https://my.racknerd.com/clientarea.php',
    balanceHint: null,
    renewNotes: null,
    secretRef: 'racknerd-main',
    nodeCount: 4,
    createdAt: 1_700_000_000,
    updatedAt: 1_757_000_000,
  })],
  ['homeLine', assertHomeLine, homeLine],
  ['homeLineUsageDay', assertHomeLineUsageDay, () => ({
    dayAt: 1_756_944_000,
    bytesUp: 1_024,
    bytesDown: 900_000,
    users: 2,
    source: 'node_stats' as const,
  })],
];

describe('ops contract checkers', () => {
  for (const [name, check, fixture] of CASES) {
    describe(name, () => {
      it('accepts the fixture unchanged', () => {
        expect(check(fixture())).toEqual(fixture());
      });

      it('rejects a missing key', () => {
        const drifted = fixture();
        const key = Object.keys(drifted)[0];
        delete drifted[key];
        expect(() => check(drifted)).toThrow(ApiError);
      });

      it('rejects an extra key', () => {
        expect(() => check({ ...fixture(), surpriseField: 1 })).toThrow(/surpriseField/);
      });

      // Every fixture's first field is a scalar, so one object is a wrong type
      // for all of them.
      it('rejects a wrong type', () => {
        const drifted = fixture();
        const key = Object.keys(drifted)[0];
        drifted[key] = { unexpected: true };
        expect(() => check(drifted)).toThrow(ApiError);
      });
    });
  }

  it('reports the offending field as a 500 CONTRACT_VIOLATION', () => {
    try {
      assertNodeSummary({ ...nodeSummary(), verdict: 'melted' });
      throw new Error('expected a contract violation');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const api = error as ApiError;
      expect(api.status).toBe(500);
      expect(api.code).toBe('CONTRACT_VIOLATION');
      expect(api.message).toBe('nodeSummary.verdict');
    }
  });

  it('names the nested field, not the row', () => {
    const drifted = nodeDetail();
    drifted.bindings.komari = 'yes' as unknown as boolean;
    expect(() => assertNodeDetail(drifted)).toThrow('nodeDetail.bindings.komari');
  });

  it('names the offending array index', () => {
    const drifted = nodeDetail();
    drifted.forwardPath.value[0].carrier = 'starlink' as never;
    expect(() => assertNodeDetail(drifted)).toThrow('nodeDetail.forwardPath.value[0].carrier');
  });
});

describe('Measured', () => {
  it('accepts a never-measured cell', () => {
    const never = { ...nodeSummary(), occupancy: { value: 0, asOfSec: null, source: 'telemetry' as const } };
    expect(assertNodeSummary(never).occupancy.asOfSec).toBeNull();
  });

  it('accepts a null value inside a measured cell', () => {
    const blank = { ...nodeSummary(), forwardWorst: { value: null, asOfSec: null, source: 'telemetry' as const } };
    expect(assertNodeSummary(blank).forwardWorst.value).toBeNull();
  });

  // Epoch zero would render as 1970 and read as "measured, long ago" — the one
  // meaning a missing measurement must never take on.
  it('rejects a zero freshness stamp', () => {
    const zero = { ...nodeSummary(), occupancy: { value: 0, asOfSec: 0, source: 'telemetry' as const } };
    expect(() => assertNodeSummary(zero)).toThrow('nodeSummary.occupancy.asOfSec');
  });

  it('rejects a cell with no source', () => {
    const orphan = { ...nodeSummary(), occupancy: { value: 3, asOfSec: 1 } };
    expect(() => assertNodeSummary(orphan)).toThrow('nodeSummary.occupancy.source');
  });

  it('rejects a bare number where a measurement belongs', () => {
    expect(() => assertNodeSummary({ ...nodeSummary(), occupancy: 3 })).toThrow('nodeSummary.occupancy');
  });
});

describe('assertList', () => {
  const envelope = (extra: Record<string, unknown> = {}) => ({
    items: [nodeSummary()],
    nextCursor: null,
    updatedAt: 1_757_000_100,
    ...extra,
  });

  it('accepts an envelope without a total', () => {
    const list = assertList(envelope(), assertNodeSummary);
    expect(list.items).toHaveLength(1);
    expect('total' in list).toBe(false);
  });

  it('accepts an envelope with a total', () => {
    expect(assertList(envelope({ total: 9 }), assertNodeSummary).total).toBe(9);
  });

  // Absent means "this endpoint does not count"; null would be drift wearing
  // the same clothes.
  it('rejects a null total', () => {
    expect(() => assertList(envelope({ total: null }), assertNodeSummary)).toThrow('list.total');
  });

  it('rejects a drifted row and says which one', () => {
    const bad = envelope({ items: [nodeSummary(), { ...nodeSummary(), tone: 'purple' }] });
    expect(() => assertList(bad, assertNodeSummary)).toThrow('list.items[1].tone');
  });

  it('rejects a non-array items', () => {
    expect(() => assertList(envelope({ items: {} }), assertNodeSummary)).toThrow('list.items');
  });
});

describe('vocabulary mapping', () => {
  const NODE_TABLE: Array<[NodeVerdict, NodeHealthWord, Tone]> = [
    ['down', '失联', 'sev'],
    ['blocked', '被墙', 'sev'],
    ['no_probe', '未测', 'unk'],
    ['degraded', '劣化', 'warn'],
    ['pressure', '劣化', 'warn'],
    ['unknown', '未测', 'unk'],
    ['ok', '正常', 'ok'],
  ];

  it.each(NODE_TABLE)('%s reads as %s (%s)', (verdict, word, tone) => {
    expect(healthWordForVerdict(verdict)).toEqual({ word, tone });
  });

  // A dead box fails the mainland probes too; promoting that to 被墙 is the
  // mislabelling this order exists to prevent.
  it('ranks down above blocked', () => {
    expect(NODE_VERDICTS.indexOf('down')).toBeLessThan(NODE_VERDICTS.indexOf('blocked'));
    expect(NODE_VERDICTS.indexOf('no_probe')).toBeLessThan(NODE_VERDICTS.indexOf('ok'));
  });

  const CUSTOMER_TABLE: Array<[CustomerVerdict, CustomerHealthWord, Tone]> = [
    ['unreachable', '连不上', 'sev'],
    ['unstable', '不稳', 'warn'],
    ['unreported', '未上报', 'unk'],
    ['offline', '离线', 'info'],
    ['ok', '正常', 'ok'],
  ];

  it.each(CUSTOMER_TABLE)('%s reads as %s (%s)', (verdict, word, tone) => {
    expect(customerHealthWord(verdict)).toEqual({ word, tone });
  });

  it('gives every word the same tone the verdict helpers do', () => {
    for (const [, word, tone] of [...NODE_TABLE, ...CUSTOMER_TABLE]) {
      expect(toneFor(word)).toBe(tone);
    }
  });

  // R1: missing data is never green. No unmeasured verdict may map to `ok`.
  it('never paints an unmeasured verdict green', () => {
    expect(healthWordForVerdict('no_probe').tone).not.toBe('ok');
    expect(healthWordForVerdict('unknown').tone).not.toBe('ok');
    expect(customerHealthWord('unreported').tone).not.toBe('ok');
  });
});
