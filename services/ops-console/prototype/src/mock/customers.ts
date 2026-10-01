import { DAY, HOUR, NOW } from '@proto/format';
import { FLEET } from './fleet';
import { beijingHour, diurnal, rng } from './rng';
import { hash, type Range, series, type Point } from './series';

export type CustomerState = 'online' | 'offline' | 'failing' | 'never' | 'expired' | 'disabled';
export type Platform = 'macOS' | 'Windows';

export type Customer = {
  id: string;
  email: string;
  wechat: string | null;
  state: CustomerState;
  stateReason: string | null;
  platform: Platform;
  version: string;
  devices: number;
  node: string | null;
  lastSeen: number | null;
  success24h: number | null;
  usageBytes: number;
  quotaBytes: number | null;
  expiresAt: number;
  planMinor: number;
  residential: string | null;
  claude: boolean;
  joinedAt: number;
  catalogBehind: boolean;
};

const NAMES = [
  'chen.jie', 'wang.tao', 'li.na', 'zhang.wei', 'liu.yang', 'huang.min', 'zhao.lei', 'wu.fang', 'zhou.jun', 'xu.jing',
  'sun.hao', 'ma.li', 'zhu.ning', 'hu.bin', 'guo.xin', 'he.yu', 'lin.feng', 'luo.qian', 'gao.peng', 'zheng.yi',
  'liang.chen', 'xie.rui', 'song.jia', 'tang.kai', 'han.mei', 'feng.bo', 'deng.xue', 'cao.yang', 'peng.lu', 'zeng.hui',
  'xiao.yun', 'tian.ye', 'dong.lin', 'pan.xiao', 'yuan.jie', 'cai.ming', 'jiang.hong', 'yu.ting', 'du.wen', 'ye.qing',
  'cheng.long', 'wei.xin', 'su.yan', 'lu.hai', 'ding.ke', 'ren.zhi', 'shen.ao', 'yao.fei', 'lu.xiang', 'jiang.shan',
  'studio.north', 'ops.lab', 'mingyue.design', 'blue.harbor',
];
const DOMAINS = ['gmail.com', 'qq.com', 'outlook.com', '163.com', 'icloud.com', 'foxmail.com'];

function build(): Customer[] {
  const r = rng(7);
  const nodes = FLEET.filter((n) => n.status === 'ok' || n.status === 'warn').map((n) => n.name);
  return NAMES.map((name, i) => {
    const roll = r.next();
    let state: CustomerState = roll < 0.38 ? 'online' : roll < 0.78 ? 'offline' : roll < 0.84 ? 'never' : roll < 0.92 ? 'expired' : 'disabled';
    let stateReason: string | null = null;
    let node: string | null = state === 'online' || state === 'offline' ? r.pick(nodes) : null;
    if (i === 1) { state = 'failing'; node = 'Los Angeles · Mesa'; stateReason = '卡在 Los Angeles · Mesa，连续 6 次握手超时'; }
    if (i === 4 || i === 9 || i === 17 || i === 23) { state = 'failing'; node = 'Los Angeles · Mesa'; stateReason = '节点被墙，客户端未自动切换'; }
    if (state === 'never') stateReason = '开通 3 天，还没连上过';
    if (state === 'expired') stateReason = '套餐已到期';
    if (state === 'disabled') stateReason = '已停用';
    const quota = r.chance(0.3) ? null : r.pick([50, 100, 200, 300]) * 1024 ** 3;
    const usage = state === 'never' ? 0 : Math.round((quota ?? 200 * 1024 ** 3) * r.between(0.02, i % 11 === 3 ? 1.02 : 0.93));
    const expiresAt = state === 'expired' ? NOW - r.int(1, 12) * DAY : NOW + (i % 7 === 2 ? r.int(1, 6) : r.int(8, 200)) * DAY;
    const onOldWindows = i === 1 || i === 9 || i === 23;
    return {
      id: `u-${String(i + 1).padStart(3, '0')}`,
      email: `${name}@${DOMAINS[i % DOMAINS.length]}`,
      wechat: r.chance(0.6) ? `wx_${name.replace('.', '_')}` : null,
      state,
      stateReason,
      platform: onOldWindows || r.chance(0.42) ? 'Windows' : 'macOS',
      version: onOldWindows ? '1.4.2' : r.pick(['1.5.0', '1.5.0', '1.5.0', '1.4.2', '1.4.2', '1.3.9']),
      devices: r.int(1, 3),
      node,
      lastSeen: state === 'never' ? null : state === 'online' || state === 'failing' ? NOW - r.int(5, 300) * 1000 : NOW - r.int(2, 300) * HOUR,
      success24h: state === 'never' || state === 'disabled' ? null : state === 'failing' ? r.between(0.1, 0.45) : r.between(0.95, 1),
      usageBytes: usage,
      quotaBytes: quota,
      expiresAt,
      planMinor: r.pick([3000, 5000, 5000, 8000, 12000]),
      residential: r.chance(0.3) ? 'pending' : null,
      claude: r.chance(0.25),
      joinedAt: NOW - r.int(3, 240) * DAY,
      catalogBehind: r.chance(0.12),
    };
  });
}

/** 16 residential exits; every fourth one stays idle so inventory has spare lines. */
function assignResidential(list: Customer[]): Customer[] {
  let slot = 0;
  for (const c of list) {
    if (c.residential !== 'pending') continue;
    while (slot % 4 === 3) slot += 1;
    c.residential = slot < 16 ? `JP-Home-${String(slot + 1).padStart(2, '0')}` : null;
    slot += 1;
  }
  return list;
}

export const CUSTOMERS: Customer[] = assignResidential(build());

export function customerById(id: string): Customer | undefined {
  return CUSTOMERS.find((c) => c.id === id);
}

export type TimelineEvent = {
  at: number;
  kind: 'connectOk' | 'connectFail' | 'nodeSwitch' | 'catalogSync' | 'appUpdate' | 'quota' | 'support';
  node: string | null;
  code: string | null;
  stage: string | null;
  elapsed: number | null;
  detail: string;
};

export function customerTimeline(c: Customer): TimelineEvent[] {
  const r = rng(hash(c.id));
  const out: TimelineEvent[] = [];
  let at = NOW - r.int(1, 20) * 60_000;
  for (let i = 0; i < 34; i += 1) {
    const failing = c.state === 'failing' && at > NOW - 3 * HOUR;
    const roll = r.next();
    if (failing && roll < 0.75) {
      out.push({ at, kind: 'connectFail', node: c.node, code: r.pick(['TLS_HANDSHAKE_TIMEOUT', 'ETIMEDOUT', 'TLS_HANDSHAKE_TIMEOUT']), stage: '握手', elapsed: r.int(8000, 15000), detail: '握手没完成' });
    } else if (roll < 0.62) {
      out.push({ at, kind: 'connectOk', node: c.node ?? 'Tokyo · Fuji', code: null, stage: null, elapsed: r.int(180, 900), detail: '已连接' });
    } else if (roll < 0.74) {
      out.push({ at, kind: 'nodeSwitch', node: 'Tokyo · Neon', code: null, stage: null, elapsed: null, detail: `从 ${c.node ?? 'Tokyo · Fuji'} 切到 Tokyo · Neon` });
    } else if (roll < 0.86) {
      out.push({ at, kind: 'connectFail', node: c.node, code: r.pick(['ETIMEDOUT', 'DNS_FAIL', 'NETWORK_ENVIRONMENT_OFFLINE']), stage: r.pick(['拨号', '解析']), elapsed: r.int(3000, 10000), detail: '一次失败，随后自动重试' });
    } else if (roll < 0.93) {
      out.push({ at, kind: 'catalogSync', node: null, code: null, stage: null, elapsed: null, detail: `目录更新到 r${r.int(38, 40)}` });
    } else {
      out.push({ at, kind: 'appUpdate', node: null, code: null, stage: null, elapsed: null, detail: `客户端更新到 ${c.version}` });
    }
    at -= r.int(20, 240) * 60_000;
  }
  return out;
}

/** Hourly bytes for one customer: `operations_user_usage_hours`. */
export function customerUsage(c: Customer, range: Range): Point[] {
  if (c.state === 'never') return series(`${c.id}:use`, range, { base: 0, min: 0 });
  return series(`${c.id}:use`, range, { base: 1.2e8, swing: 1.6, noise: 0.8, min: 0 });
}

/** 7×24 connected minutes, for the "when do they use it" heat strip. */
export function customerWeek(c: Customer): number[][] {
  const r = rng(hash(`${c.id}:week`));
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, (_, h) => (c.state === 'never' ? 0 : Math.round(60 * Math.min(1, Math.max(0, diurnal(h) - 0.35 + r.between(-0.3, 0.3)))))),
  );
}

export function fleetUsage(range: Range): Point[] {
  return series('fleet:usage', range, { base: 2.8e10, swing: 1.3, noise: 0.2, min: 0 });
}

export function onlineSeries(range: Range): Point[] {
  return series('fleet:online', range, { base: 22, swing: 1.3, noise: 0.15, min: 0 }).map((p) => ({ at: p.at, v: p.v == null ? null : Math.round(p.v) }));
}

export { beijingHour };
