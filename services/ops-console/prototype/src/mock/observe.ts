import { HOUR, NOW } from '@proto/format';
import { series, type Point, type Range } from './series';

/** `ops_connection_daily` + `connection_events`: attempts, successes, p50. */
export function successSeries(key: string, range: Range, base = 0.985, incident = true): Point[] {
  return series(`ok:${key}`, range, {
    base, noise: 0.012, min: 0.5, max: 1,
    dip: incident ? { from: 3 * HOUR, to: 0, by: -0.06 } : undefined,
  });
}

export function attemptsSeries(range: Range): Point[] {
  return series('attempts', range, { base: 180, swing: 1.4, noise: 0.25, min: 0 });
}

export function latencySeries(range: Range, quantile: 'p50' | 'p95'): Point[] {
  return quantile === 'p50'
    ? series('p50', range, { base: 310, swing: 0.25, noise: 0.08, min: 80, dip: { from: 3 * HOUR, to: 0, by: 60 } })
    : series('p95', range, { base: 1150, swing: 0.3, noise: 0.15, min: 300, dip: { from: 3 * HOUR, to: 0, by: 900 } });
}

export const SEGMENTS = {
  platform: [
    { key: 'macOS', label: 'macOS', base: 0.991, incident: true },
    { key: 'Windows', label: 'Windows', base: 0.972, incident: true },
  ],
  carrier: [
    { key: 'ct', label: '电信', base: 0.989, incident: true },
    { key: 'cu', label: '联通', base: 0.968, incident: true },
    { key: 'cm', label: '移动', base: 0.981, incident: false },
  ],
} as const;

export const CODE_TEXT: Record<string, string> = {
  TLS_HANDSHAKE_TIMEOUT: '加密握手超时',
  ETIMEDOUT: '连接超时，没等到回应',
  NETWORK_ENVIRONMENT_OFFLINE: '客户本地网络不可用',
  DNS_FAIL: '域名解析失败',
  REALITY_AUTH_FAIL: '身份校验没通过',
  TUN_ROUTE_UNAVAILABLE: '流量没能进入隧道',
  CATALOG_STALE: '客户端手里的节点单子太旧',
  UNKNOWN: '客户端没说原因',
};

export type FailureCode = {
  code: string;
  stage: string;
  count: number;
  users: number;
  share: number;
  trend: Point[];
  topNode: string;
  topVersion: string;
};

export const FAILURE_CODES: FailureCode[] = [
  { code: 'TLS_HANDSHAKE_TIMEOUT', stage: '握手', count: 412, users: 6, share: 0.46, topNode: 'Los Angeles · Mesa', topVersion: 'Windows 1.4.2' },
  { code: 'ETIMEDOUT', stage: '拨号', count: 198, users: 9, share: 0.22, topNode: 'Los Angeles · Mesa', topVersion: 'macOS 1.5.0' },
  { code: 'NETWORK_ENVIRONMENT_OFFLINE', stage: '探测', count: 121, users: 14, share: 0.14, topNode: '—', topVersion: 'macOS 1.5.0' },
  { code: 'DNS_FAIL', stage: '解析', count: 64, users: 4, share: 0.07, topNode: 'Singapore · Harbour', topVersion: 'Windows 1.5.0' },
  { code: 'REALITY_AUTH_FAIL', stage: '加密', count: 38, users: 1, share: 0.04, topNode: 'Tokyo · Sakura', topVersion: 'macOS 1.3.9' },
  { code: 'TUN_ROUTE_UNAVAILABLE', stage: '隧道', count: 29, users: 2, share: 0.03, topNode: '—', topVersion: 'Windows 1.4.2' },
  { code: 'CATALOG_STALE', stage: '取节点', count: 22, users: 3, share: 0.02, topNode: '—', topVersion: 'Windows 1.3.9' },
  { code: 'UNKNOWN', stage: '—', count: 12, users: 2, share: 0.01, topNode: '—', topVersion: '—' },
].map((f) => ({
  ...f,
  trend: series(`code:${f.code}`, '24h', {
    base: f.count / 96, noise: 0.8, min: 0,
    dip: f.code === 'TLS_HANDSHAKE_TIMEOUT' || f.code === 'ETIMEDOUT' ? { from: 3 * HOUR, to: 0, by: f.count / 20 } : undefined,
  }),
}));

export type Incident = {
  id: string;
  severity: 'sev' | 'warn';
  title: string;
  subject: { kind: 'node' | 'version' | 'customer'; id: string };
  since: number;
  affected: number;
  affectedIds: string[];
  signal: string;
  owner: string | null;
  next: string;
};

export const INCIDENTS: Incident[] = [
  {
    id: 'inc-2031', severity: 'sev', title: 'Los Angeles · Mesa 三网都连不上',
    subject: { kind: 'node', id: 'Los Angeles · Mesa' }, since: NOW - 2 * HOUR - 40 * 60_000,
    affected: 5, affectedIds: ['u-002', 'u-005', 'u-010', 'u-018', 'u-024'],
    signal: '大陆三网探测全部超时，握手失败 412 次', owner: null, next: '下架预览，把 5 位客户切到 Tokyo · Neon',
  },
  {
    id: 'inc-2030', severity: 'warn', title: 'Windows 1.4.2 握手超时比 1.5.0 高 6 倍',
    subject: { kind: 'version', id: 'Windows 1.4.2' }, since: NOW - 5 * HOUR,
    affected: 3, affectedIds: ['u-002', 'u-010', 'u-024'],
    signal: 'TLS_HANDSHAKE_TIMEOUT 集中在 1.4.2', owner: 'ray', next: '提醒这 3 位升级到 1.5.0',
  },
  {
    id: 'inc-2029', severity: 'warn', title: 'Singapore · Harbour 联通丢包 12%',
    subject: { kind: 'node', id: 'Singapore · Harbour' }, since: NOW - 7 * HOUR,
    affected: 0, affectedIds: [],
    signal: '联通线路 15 分钟均值丢包 12%，电信、移动正常', owner: null, next: '观察；当前没有联通客户在用',
  },
];

/** #707 (migration 0093) — shapes only; the page shows them when the tables exist. */
export const HOPS = [
  { role: '入口节点', p50: 142, p95: 410, fail: 0.018, samples: 5120 },
  { role: '家宽出口', p50: 388, p95: 1320, fail: 0.041, samples: 1406 },
];

export function hopSeries(range: Range, role: 'entry' | 'residential'): Point[] {
  return series(`hop:${role}`, range, role === 'entry'
    ? { base: 142, swing: 0.2, noise: 0.1, min: 40 }
    : { base: 388, swing: 0.3, noise: 0.15, min: 120 });
}

export const DNS = { checks: 2310, leakOutside: 3, ipv6Leak: 1, geoMismatch: 11, fakeIp: 0.94 };
export function dnsSeries(range: Range): Point[] {
  return series('dns:mismatch', range, { base: 0.6, noise: 1.2, min: 0 });
}

export const AI_ROUTES = [
  { service: 'Claude', buckets: 1840, residential: 0.962, datacenter: 0.031, direct: 0.004, unknown: 0.003, leaks: 7, switched: 12 },
  { service: 'OpenAI', buckets: 960, residential: 0.41, datacenter: 0.585, direct: 0.0, unknown: 0.005, leaks: 0, switched: 3 },
];

export const CLUSTERS = [
  { id: 'fc-88', code: 'TLS_HANDSHAKE_TIMEOUT', stage: '握手', version: 'Windows 1.4.2', node: 'Los Angeles · Mesa', events: 311, users: 3, first: NOW - 2 * HOUR - 35 * 60_000, last: NOW - 2 * 60_000, status: 'open' as const },
  { id: 'fc-87', code: 'ETIMEDOUT', stage: '拨号', version: 'macOS 1.5.0', node: 'Los Angeles · Mesa', events: 142, users: 4, first: NOW - 2 * HOUR - 30 * 60_000, last: NOW - 4 * 60_000, status: 'open' as const },
  { id: 'fc-85', code: 'DNS_FAIL', stage: '解析', version: 'Windows 1.5.0', node: 'Singapore · Harbour', events: 41, users: 2, first: NOW - 9 * HOUR, last: NOW - 6 * HOUR, status: 'quiet' as const },
];
