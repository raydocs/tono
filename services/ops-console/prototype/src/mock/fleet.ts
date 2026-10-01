import { DAY, HOUR, NOW } from '@proto/format';
import { rng } from './rng';
import { series, type Point, type Range } from './series';

export type Status = 'ok' | 'warn' | 'sev' | 'idle';

export type Carrier = { name: '电信' | '联通' | '移动'; latency: number | null; loss: number | null };

export type FleetNode = {
  name: string;
  city: string;
  country: string;
  provider: string;
  ipMasked: string;
  status: Status;
  reason: string | null;
  listed: boolean;
  hy2: boolean;
  users: number;
  capacity: number;
  cores: number;
  cpu: number;
  mem: number;
  disk: number;
  load: number;
  netIn: number;
  netOut: number;
  monthBytes: number;
  quotaBytes: number;
  success: number | null;
  p50: number | null;
  carriers: Carrier[];
  costMinor: number;
  renewAt: number;
  xray: string;
  lastSeen: number;
};

const ROSTER: [string, string, string, string][] = [
  ['Tokyo · Fuji', '东京', 'JP', 'Bandwagon'],
  ['Tokyo · Neon', '东京', 'JP', 'Vultr'],
  ['Tokyo · Sakura', '东京', 'JP', 'DMIT'],
  ['Osaka · Kansai', '大阪', 'JP', 'Vultr'],
  ['Los Angeles · Mesa', '洛杉矶', 'US', 'DMIT'],
  ['Los Angeles · Pacific', '洛杉矶', 'US', 'Bandwagon'],
  ['San Jose · Bay', '圣何塞', 'US', 'Vultr'],
  ['Singapore · Harbour', '新加坡', 'SG', 'DMIT'],
  ['Singapore · Marina', '新加坡', 'SG', 'Linode'],
  ['Hong Kong · Victoria', '香港', 'HK', 'DMIT'],
  ['Hong Kong · Kowloon', '香港', 'HK', 'Akile'],
  ['Seoul · Han', '首尔', 'KR', 'Vultr'],
  ['Taipei · Xinyi', '台北', 'TW', 'Hinet'],
  ['London · Thames', '伦敦', 'GB', 'Linode'],
  ['Frankfurt · Main', '法兰克福', 'DE', 'Hetzner'],
  ['Buffalo · Erie', '布法罗', 'US', 'RackNerd'],
  ['Sydney · Harbour', '悉尼', 'AU', 'Vultr'],
  ['Catalog Only', '—', '—', '—'],
];

const PLAN: Partial<Record<string, { status: Status; reason: string }>> = {
  'Los Angeles · Mesa': { status: 'sev', reason: '三网都连不上，疑似被墙' },
  'Singapore · Harbour': { status: 'warn', reason: '联通丢包 12%' },
  'Buffalo · Erie': { status: 'warn', reason: '到期 3 天，未续费' },
  'Catalog Only': { status: 'idle', reason: '在目录里，但没有探针' },
  'Sydney · Harbour': { status: 'idle', reason: '已上架，没人在用' },
};

function build(): FleetNode[] {
  const r = rng(42);
  return ROSTER.map(([name, city, country, provider], i) => {
    const plan = PLAN[name];
    const status: Status = plan?.status ?? 'ok';
    const idle = status === 'idle';
    const down = status === 'sev';
    const users = idle ? 0 : down ? 0 : r.int(1, 9);
    const cores = r.pick([1, 2, 2, 4]);
    const carrier = (n: Carrier['name'], base: number): Carrier => ({
      name: n,
      latency: down || name === 'Catalog Only' ? null : Math.round(base + r.between(-12, 18)),
      loss: down || name === 'Catalog Only' ? null : name === 'Singapore · Harbour' && n === '联通' ? 0.12 : r.chance(0.2) ? r.between(0.002, 0.02) : 0,
    });
    const baseLatency = { JP: 60, KR: 55, HK: 35, TW: 45, SG: 80, US: 150, GB: 210, DE: 200, AU: 170, '—': 0 }[country] ?? 100;
    return {
      name,
      city,
      country,
      provider,
      ipMasked: name === 'Catalog Only' ? '—' : `203.0.113.${10 + i}`,
      status,
      reason: plan?.reason ?? null,
      listed: name !== 'Buffalo · Erie',
      hy2: i % 3 === 0,
      users,
      capacity: 10,
      cores,
      cpu: down ? 0.03 : idle ? 0.02 : r.between(0.06, 0.48),
      mem: r.between(0.22, 0.72),
      disk: r.between(0.12, 0.6),
      load: down ? 0.02 : r.between(0.05, 1.6),
      netIn: users * r.between(2e6, 9e6),
      netOut: users * r.between(8e6, 3.6e7),
      monthBytes: Math.round(r.between(30, 900) * 1024 ** 3),
      quotaBytes: 1024 ** 4,
      success: down ? 0.0 : idle ? null : status === 'warn' ? r.between(0.955, 0.985) : r.between(0.991, 0.999),
      p50: down || idle ? null : Math.round(baseLatency * 2.4 + r.between(-20, 40)),
      carriers: [carrier('电信', baseLatency), carrier('联通', baseLatency + 8), carrier('移动', baseLatency + 14)],
      costMinor: r.pick([3500, 4200, 5500, 7800, 12000]),
      renewAt: name === 'Buffalo · Erie' ? NOW + 3 * DAY : NOW + r.int(6, 80) * DAY,
      xray: r.pick(['25.9.11', '25.9.11', '25.8.31']),
      lastSeen: name === 'Catalog Only' ? NOW - 9 * DAY : NOW - r.int(10, 80) * 1000,
    };
  });
}

export const FLEET: FleetNode[] = build();

export function nodeByName(name: string): FleetNode | undefined {
  return FLEET.find((n) => n.name === name);
}

export type NodeMetric = 'cpu' | 'mem' | 'load' | 'netIn' | 'netOut' | 'users' | 'success' | 'p50';

export function nodeSeries(node: FleetNode, metric: NodeMetric, range: Range): Point[] {
  const down = node.status === 'sev';
  const dip = down ? { from: 3 * HOUR, to: 0, by: -10 } : undefined;
  switch (metric) {
    case 'cpu': return series(`${node.name}:cpu`, range, { base: Math.max(node.cpu, 0.05), swing: 0.9, noise: 0.25, min: 0, max: 1, dip: down ? { from: 3 * HOUR, to: 0, by: -0.3 } : undefined });
    case 'mem': return series(`${node.name}:mem`, range, { base: node.mem, swing: 0.1, noise: 0.03, min: 0, max: 1 });
    case 'load': return series(`${node.name}:load`, range, { base: Math.max(node.load, 0.05), swing: 0.9, noise: 0.3, min: 0 });
    case 'netIn': return series(`${node.name}:in`, range, { base: Math.max(node.netIn, 4e5), swing: 1.2, noise: 0.3, min: 0, dip: down ? { from: 3 * HOUR, to: 0, by: -1e9 } : undefined });
    case 'netOut': return series(`${node.name}:out`, range, { base: Math.max(node.netOut, 1e6), swing: 1.2, noise: 0.3, min: 0, dip: down ? { from: 3 * HOUR, to: 0, by: -1e10 } : undefined });
    case 'users': return series(`${node.name}:users`, range, { base: down ? 5 : Math.max(node.users, 0.3), swing: 1.1, noise: 0.2, min: 0, dip }).map((p) => ({ ...p, v: p.v == null ? null : Math.round(p.v) }));
    case 'success': return series(`${node.name}:ok`, range, { base: node.success ?? 0.99, noise: 0.01, min: 0, max: 1, dip: down ? { from: 3 * HOUR, to: 0, by: -1 } : undefined });
    case 'p50': return series(`${node.name}:p50`, range, { base: node.p50 ?? 200, swing: 0.3, noise: 0.1, min: 20 });
  }
}

export function statusCounts(): Record<Status, number> {
  const out: Record<Status, number> = { ok: 0, warn: 0, sev: 0, idle: 0 };
  for (const n of FLEET) out[n.status] += 1;
  return out;
}
