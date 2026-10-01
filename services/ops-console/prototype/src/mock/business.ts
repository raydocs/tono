import { DAY, HOUR, NOW } from '@proto/format';
import { CUSTOMERS } from './customers';
import { rng } from './rng';

/* ---------- 家宽出口: inventory, probe health and billing in one row ---------- */

export type HomeExit = {
  id: string;
  label: string;
  vendor: string;
  city: string;
  isp: string;
  ipPrefix: string;
  health: 'alive' | 'dead' | 'flaky';
  probes: ('alive' | 'dead' | null)[];
  boundTo: string | null;
  claudeAccount: string | null;
  costMinor: number;
  renewAt: number;
  addedAt: number;
};

function homes(): HomeExit[] {
  const r = rng(99);
  const vendors = [['IPRoyal', '东京', 'SoftBank'], ['ProxyEmpire', '大阪', 'NTT'], ['Soax', '洛杉矶', 'Comcast'], ['IPRoyal', '横滨', 'KDDI']] as const;
  return Array.from({ length: 16 }, (_, i) => {
    const [vendor, city, isp] = vendors[i % vendors.length];
    const health = i === 5 ? 'dead' : i === 11 ? 'flaky' : 'alive';
    const probes = Array.from({ length: 48 }, (_, k) => {
      if (health === 'dead' && k > 40) return 'dead' as const;
      if (health === 'flaky' && r.chance(0.18)) return 'dead' as const;
      if (r.chance(0.02)) return null;
      return 'alive' as const;
    });
    const id = `JP-Home-${String(i + 1).padStart(2, '0')}`;
    const owner = CUSTOMERS.find((c) => c.residential === id) ?? null;
    return {
      id,
      label: `${city} · ${isp}`,
      vendor,
      city,
      isp,
      ipPrefix: `198.51.${100 + i}.0/24`,
      health,
      probes,
      boundTo: owner?.id ?? null,
      claudeAccount: owner?.claude ? `claude-${owner.id.slice(2)}` : null,
      costMinor: r.pick([4500, 6000, 7500]),
      renewAt: NOW + (i === 7 ? 2 : r.int(5, 40)) * DAY,
      addedAt: NOW - r.int(10, 200) * DAY,
    };
  });
}

export const HOME_EXITS = homes();
const claudeBound = CUSTOMERS.filter((c) => c.claude).length;
export const CLAUDE_ACCOUNTS = { total: claudeBound + 5, bound: claudeBound, idle: 4, banned: 1 };

/* ---------- 客户端 ---------- */

export const RELEASES = [
  { platform: 'macOS', version: '1.5.0', build: '150', channel: '正式', publishedAt: NOW - 6 * DAY, adoption: 0.71, users: 22, signed: true, verified: true, floor: false },
  { platform: 'macOS', version: '1.4.2', build: '142', channel: '正式', publishedAt: NOW - 24 * DAY, adoption: 0.19, users: 6, signed: true, verified: true, floor: false },
  { platform: 'macOS', version: '1.3.9', build: '139', channel: '正式', publishedAt: NOW - 51 * DAY, adoption: 0.1, users: 3, signed: true, verified: true, floor: true },
  { platform: 'Windows', version: '1.5.0', build: '150', channel: '正式', publishedAt: NOW - 5 * DAY, adoption: 0.52, users: 12, signed: true, verified: true, floor: false },
  { platform: 'Windows', version: '1.4.2', build: '142', channel: '正式', publishedAt: NOW - 24 * DAY, adoption: 0.35, users: 8, signed: true, verified: true, floor: false },
  { platform: 'Windows', version: '1.5.1', build: '151', channel: '内测', publishedAt: NOW - 1 * DAY, adoption: 0.0, users: 0, signed: true, verified: false, floor: false },
] as const;

/* ---------- 财务 ---------- */

export const REVENUE_MONTHS = ['10月', '11月', '12月', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月'].map((label, i) => ({
  label,
  revenue: Math.round((1200 + i * 210 + (i % 3) * 90) * 100),
  nodes: Math.round((520 + i * 22) * 100),
  residential: Math.round((i < 5 ? 0 : 220 + (i - 5) * 60) * 100),
  claude: Math.round((i < 7 ? 0 : 180 + (i - 7) * 40) * 100),
}));

export type LedgerRow = {
  id: string;
  at: number;
  kind: '收入' | '支出' | '冲正';
  subject: string;
  note: string;
  amountMinor: number;
  currency: 'CNY' | 'USD';
  source: '手工' | '账单源';
};

function ledger(): LedgerRow[] {
  const r = rng(5);
  const rows: LedgerRow[] = [];
  const vendors = [['DMIT · Los Angeles · Mesa', '月租', 1800], ['Vultr · Tokyo · Neon', '月租', 1200], ['IPRoyal · JP-Home-03', '月租', 750], ['Anthropic · Claude Team', '月租', 3000], ['Bandwagon · Tokyo · Fuji', '流量加购', 500]] as const;
  let at = NOW - r.int(20, 90) * 60_000;
  for (let i = 0; i < 26; i += 1) {
    const income = r.chance(0.6);
    const c = r.pick(CUSTOMERS);
    const months = r.pick([1, 1, 3, 12]);
    const [vendor, vendorNote, vendorMinor] = r.pick(vendors);
    const reversal = i === 9;
    rows.push({
      id: `L-${2450 - i}`,
      at,
      kind: reversal ? '冲正' : income ? '收入' : '支出',
      subject: reversal ? 'L-2437 重复记账' : income ? c.email : vendor,
      note: reversal ? '冲正 ¥150' : income ? (months === 1 ? '续费 1 个月' : `续费 ${months} 个月`) : vendorNote,
      amountMinor: reversal ? -15000 : income ? c.planMinor * months : -vendorMinor,
      currency: reversal || income ? 'CNY' : 'USD',
      source: income || reversal ? '手工' : '账单源',
    });
    at -= r.int(3, 26) * HOUR;
  }
  return rows;
}

export const LEDGER = ledger();

/* ---------- 审计 ---------- */

export const AUDIT = (() => {
  const r = rng(11);
  const actions = [
    ['catalog.publish', '发布目录 r40', 'owner'],
    ['policy.publish', '发布分流规则 r4（关闭网页直连）', 'owner'],
    ['user.onboard', '开通 chen.jie@gmail.com', 'operator'],
    ['incident.ack', '认领事故 inc-2030', 'owner'],
    ['node.job', 'Los Angeles · Mesa 重启 Xray', 'owner'],
    ['home.assign', 'JP-Home-03 绑定 wang.tao@qq.com', 'operator'],
    ['release.publish', '发布 Windows 1.5.0', 'owner'],
    ['ledger.write', '记账 L-2412 ¥150', 'owner'],
    ['diagnostics.open', '打开原始日志窗口 · li.na@outlook.com · 30 分钟', 'owner'],
    ['user.patch', '续期 zhang.wei@163.com 到 2026-12-30', 'operator'],
  ] as const;
  let at = NOW - 18 * 60_000;
  return Array.from({ length: 40 }, (_, i) => {
    const [action, summary, role] = actions[i % actions.length];
    at -= i === 0 ? 0 : r.int(20, 180) * 60_000;
    return {
      id: `a-${9000 - i}`,
      at,
      actor: role === 'owner' ? 'ray@tono.dev' : 'ops@tono.dev',
      role,
      action,
      summary,
      requestId: `req_${(9000 - i).toString(36)}${r.int(100, 999)}`,
    };
  });
})();
