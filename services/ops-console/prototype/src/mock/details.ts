import { HOUR, NOW } from '@proto/format';
import { CUSTOMERS, type Customer, type TimelineEvent } from './customers';
import { FAILURE_CODES, type Incident } from './observe';
import { rng } from './rng';
import { hash } from './series';

/* ---------- Failure-code samples (connection_events rows with that code) ---------- */

export const CODE_ERROR: Record<string, string> = {
  TLS_HANDSHAKE_TIMEOUT: 'reality handshake: context deadline exceeded after 10s',
  ETIMEDOUT: 'dial tcp 203.0.113.14:443: i/o timeout',
  NETWORK_ENVIRONMENT_OFFLINE: 'probe: no default route (system offline)',
  DNS_FAIL: 'lookup api.afk.ccwu.cc on 192.168.1.1:53: no such host',
  REALITY_AUTH_FAIL: 'reality: server rejected short id',
  TUN_ROUTE_UNAVAILABLE: 'route add 0.0.0.0/1 via utun6: file exists',
  CATALOG_STALE: 'catalog r38 is older than server r40',
  UNKNOWN: 'core exited with status 1',
};

export const CODE_ADVICE: Record<string, string> = {
  TLS_HANDSHAKE_TIMEOUT: '集中在一台节点时，多半是这台被墙或 Reality 目标站失效：先看节点三网探测，再考虑下架切走。集中在一个版本时，催升级。',
  ETIMEDOUT: 'TCP 都没连上。三网都超时是节点问题；只有一个运营商超时是线路问题，客户端会自动换节点。',
  NETWORK_ENVIRONMENT_OFFLINE: '客户自己没网，不是我们的故障，不计入成功率目标。',
  DNS_FAIL: '客户的本地 DNS 解析不了控制面域名。通常是路由器劫持，让客户换 DNS 或开启内置 DoH。',
  REALITY_AUTH_FAIL: '客户端的密钥与节点不一致，多半是目录太旧。刷新目录即可。',
  TUN_ROUTE_UNAVAILABLE: '系统里有别的 VPN 占着路由。让客户退出其它代理软件后重试。',
  CATALOG_STALE: '客户端没拉到最新目录。检查这些设备的最后同步时间。',
  UNKNOWN: '客户端没带原因码。按设备打开诊断快照看核心日志。',
};

export type FailureSample = {
  at: number; customer: Customer; node: string; carrier: string; elapsed: number; error: string; eventId: string;
};

export function failureSamples(code: string): FailureSample[] {
  const r = rng(hash(code));
  const f = FAILURE_CODES.find((x) => x.code === code);
  const failing = CUSTOMERS.filter((c) => c.state === 'failing');
  const pool = code === 'TLS_HANDSHAKE_TIMEOUT' || code === 'ETIMEDOUT' ? failing : CUSTOMERS.filter((c) => c.state !== 'never');
  let at = NOW - r.int(1, 6) * 60_000;
  return Array.from({ length: 12 }, (_, i) => {
    const customer = pool[i % pool.length];
    at -= r.int(2, 18) * 60_000;
    return {
      at,
      customer,
      node: f && f.topNode !== '—' && r.chance(0.7) ? f.topNode : customer.node ?? 'Tokyo · Fuji',
      carrier: r.pick(['电信', '联通', '联通', '移动']),
      elapsed: code === 'NETWORK_ENVIRONMENT_OFFLINE' ? r.int(20, 90) : r.int(4000, 15000),
      error: CODE_ERROR[code] ?? 'error',
      eventId: `ce_${(0x5f3a91 + i * 977 + hash(code) % 1000).toString(36)}`,
    };
  });
}

export function breakdown<T>(items: T[], key: (t: T) => string): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/* ---------- A timeline event as the Worker stores it ---------- */

export function rawEvent(c: Customer, e: TimelineEvent, index: number) {
  const base = {
    id: `ce_${(0x71a2c0 + index * 331 + hash(c.id) % 997).toString(36)}`,
    occurred_at: new Date(e.at).toISOString(),
    received_at: new Date(e.at + 2400).toISOString(),
    user_id: c.id,
    device_id: `dev_${(hash(c.id) % 0xffffff).toString(16)}`,
    platform: c.platform.toLowerCase(),
    app_version: c.version,
    kind: e.kind,
  };
  if (e.kind === 'connectOk' || e.kind === 'connectFail') {
    return {
      ...base,
      node: e.node,
      outcome: e.kind === 'connectOk' ? 'ok' : 'fail',
      stage: e.stage,
      code: e.code,
      elapsed_ms: e.elapsed,
      edge_colo: 'LAX',
      edge_asn: 4134,
      edge_country: 'CN',
      catalog_revision: 40,
    };
  }
  return { ...base, detail: e.detail };
}

/* ---------- Incident timeline ---------- */

export function incidentLog(inc: Incident) {
  const opened = inc.since;
  const rows: { at: number; who: string; what: string }[] = [
    { at: opened, who: '判定引擎', what: `开启 · ${inc.signal}` },
    { at: opened + 15 * 60_000, who: '告警', what: 'Telegram 值班群已通知（延迟 15 分钟规则）' },
  ];
  if (inc.severity === 'sev') rows.push({ at: opened + 40 * 60_000, who: '判定引擎', what: '升级为严重：受影响客户 ≥ 3' });
  if (inc.owner) rows.push({ at: opened + 55 * 60_000, who: inc.owner, what: '认领' });
  rows.push({ at: NOW - 6 * 60_000, who: '判定引擎', what: '仍在持续 · 最近 5 分钟失败 38 次' });
  return rows.sort((a, b) => b.at - a.at);
}

/* ---------- Audit request detail ---------- */

export type AuditDetail = {
  method: string; path: string; status: number; ip: string; agent: string;
  diff: { field: string; before: string | null; after: string | null }[];
};

const DIFFS: Record<string, AuditDetail['diff']> = {
  'catalog.publish': [{ field: 'revision', before: 'r39', after: 'r40' }, { field: 'deployments', before: '16', after: '17' }, { field: 'proxies[+]', before: null, after: 'Osaka · Kansai' }],
  'policy.publish': [{ field: 'revision', before: 'r3', after: 'r4' }, { field: 'webDirect.enabled', before: 'true', after: 'false' }, { field: 'webDirect.domains', before: '14', after: '0' }],
  'user.onboard': [{ field: 'email', before: null, after: 'chen.jie@gmail.com' }, { field: 'plan', before: null, after: '¥50/月 · 200 GB' }, { field: 'expires_at', before: null, after: '2026-12-24' }],
  'incident.ack': [{ field: 'owner', before: null, after: 'ray' }, { field: 'state', before: 'open', after: 'acknowledged' }],
  'node.job': [{ field: 'job', before: null, after: 'restart-xray' }, { field: 'result', before: null, after: 'ok · 4 s' }],
  'home.assign': [{ field: 'JP-Home-03.bound_to', before: '（空）', after: 'wang.tao@qq.com' }],
  'release.publish': [{ field: 'windows.stable', before: '1.4.2 (142)', after: '1.5.0 (150)' }, { field: 'sha256', before: null, after: '9f3a…b2c1 一致' }],
  'ledger.write': [{ field: 'entry', before: null, after: 'L-2412 · 收入 · ¥150' }],
  'diagnostics.open': [{ field: 'window', before: '关闭', after: '开到 12:30（30 分钟）' }, { field: 'reason', before: null, after: '客户反馈 YouTube 走错出口' }],
  'user.patch': [{ field: 'expires_at', before: '2026-11-30', after: '2026-12-30' }],
};

const PATHS: Record<string, [string, string]> = {
  'catalog.publish': ['PUT', '/api/v1/ops/exit-catalog'],
  'policy.publish': ['PUT', '/api/v1/ops/traffic-policy'],
  'user.onboard': ['POST', '/api/v1/ops/customers'],
  'incident.ack': ['POST', '/api/v1/ops/incidents/inc-2030/ack'],
  'node.job': ['POST', '/api/v1/ops/nodes/Los%20Angeles%20%C2%B7%20Mesa/jobs'],
  'home.assign': ['PATCH', '/api/v1/ops/home-lines/JP-Home-03'],
  'release.publish': ['PATCH', '/api/v1/ops/releases/win-150'],
  'ledger.write': ['POST', '/api/v1/ops/ledger'],
  'diagnostics.open': ['POST', '/api/v1/ops/customers/u-011/diagnostics-logs/access'],
  'user.patch': ['PATCH', '/api/v1/ops/users/u-004'],
};

export function auditDetail(action: string, seed: string): AuditDetail {
  const r = rng(hash(seed));
  const [method, path] = PATHS[action] ?? ['POST', '/api/v1/ops/unknown'];
  return {
    method, path, status: 200,
    ip: `203.0.113.${r.int(2, 250)} · 上海`,
    agent: r.chance(0.7) ? 'Chrome 129 · macOS' : 'Safari 18 · iOS',
    diff: DIFFS[action] ?? [],
  };
}

export const RECENT_WINDOW = 3 * HOUR;
