#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLOCK = 1_725_000_000;
const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

function carrierHistory(latencyMs, lossPct) {
  return Array.from({ length: 12 }, (_, index) => {
    if (index === 4) return { latencyMs: null, lossPct: null };
    return {
      latencyMs: latencyMs + ((index % 5) - 2) * 4,
      lossPct: index === 8 ? Math.max(lossPct, 12) : index === 11 ? lossPct : 0,
    };
  });
}

function carriersFor(i, lossy) {
  return {
    unicom: {
      latencyMs: 40 + i * 8,
      lossPct: lossy ? 12 : 0,
      samples: 6,
      targets: ['三网-联通-北京'],
      history: carrierHistory(42 + i * 8, lossy ? 12 : 0),
    },
    telecom: {
      latencyMs: 48 + i * 6,
      lossPct: 0,
      samples: 6,
      targets: ['三网-电信-上海'],
      history: carrierHistory(50 + i * 6, 0),
    },
    mobile: {
      latencyMs: 55 + i * 5,
      lossPct: 0,
      samples: 6,
      targets: ['三网-移动-广州'],
      history: carrierHistory(52 + i * 5, 0),
    },
  };
}

function agent(name, i, { stale = false, carriers = true, lossy = false } = {}) {
  return {
    name,
    os: 'linux',
    arch: 'x64',
    cpuName: 'AMD',
    cpu: stale ? 1 : 8 + (i % 20),
    memTotal: 2 * GiB,
    memUsed: (0.3 + (i % 5) * 0.1) * 2 * GiB,
    diskTotal: 40 * GiB,
    diskUsed: 8 * GiB,
    netIn: 50_000_000_000 + i * 1_000_000,
    netOut: 8_000_000_000 + i * 200_000,
    uptime: 86400,
    cpuCores: 2,
    load1: stale ? 0.1 : 0.4 + (i % 10) * 0.05,
    load5: 0.4,
    load15: 0.3,
    swapTotal: 0,
    swapUsed: 0,
    tcpConnections: 40 + i,
    processes: 120,
    observedAt: stale ? CLOCK - 20 * 60 : CLOCK - 20 - (i % 7),
    price: 5.5,
    currency: '$',
    billingCycle: 30,
    expiredAt: CLOCK + 20 * 86400,
    trafficLimit: TiB,
    trafficLimitType: i % 4 === 0 ? 'min' : 'sum',
    carriers: carriers ? carriersFor(i, lossy) : null,
  };
}

function quality(name, i, { blocked = false, down = false, degraded = false, missing = false } = {}) {
  if (missing) return null;
  const status = blocked ? 'LIKELY_BLOCKED' : down ? 'DOWN' : degraded ? 'DEGRADED' : 'OK';
  const label = blocked ? '疑似被墙' : down ? '不通' : degraded ? '部分不通' : '大陆正常';
  return {
    name,
    host: `node-${i}.example`,
    publicIp: `203.0.113.${(10 + i) % 250}`,
    ok: !blocked && !down,
    quality: blocked || down || degraded ? 'poor' : 'ok',
    riskKeywords: [],
    riskSignals: [],
    exposure: {
      clean: !down,
      sshPorts: [22],
      unexpected: down ? [{ port: 8080, address: '0.0.0.0', process: 'xray' }] : [],
      acknowledged: [],
      expected: [{ port: 443, address: '0.0.0.0', process: 'xray' }],
    },
    routeKeywords: i % 2 ? ['9929', 'CMIN2'] : ['CN2'],
    block: {
      status,
      label,
      rule: null,
      mainland: null,
      asiaEdge: null,
      overseas: null,
    },
  };
}

// Seven days of daily bytes that add up to roughly the cycle total, with a
// deterministic wobble so the sparklines differ between nodes. Every seventh
// node loses a day to a missed measurement, which must render as a gap.
function dailyBytes(i, total) {
  const weights = [0.9, 1.15, 1.0, 0.75, 1.35, 1.05, 0.8];
  return weights.map((w, day) => {
    if (i % 7 === 3 && day === 2) return null;
    const wobble = 1 + (((i * 7 + day * 13) % 9) - 4) / 25;
    return Math.round((total / 7) * w * wobble);
  });
}

function profile(name, i, { used = true, quota = true } = {}) {
  const usedBytes = used ? (20 + (i % 9) * 8) * GiB : null;
  return {
    id: `p${i}`,
    catalogName: name,
    publicIp: `203.0.113.${(10 + i) % 250}`,
    provider: i % 3 === 0 ? 'Bandwagon' : i % 3 === 1 ? 'BuyVM' : 'demo',
    billingUrl: null,
    price: 5.5,
    currency: '$',
    billingCycle: 30,
    trafficQuotaBytes: quota ? TiB : null,
    trafficUsedBytes: usedBytes,
    trafficDailyBytes: usedBytes === null ? null : dailyBytes(i, usedBytes),
    trafficCycleStart: CLOCK - 12 * 86400,
    trafficCycleEnd: CLOCK + 18 * 86400,
    cycleNetIn: used ? 1_000 : null,
    cycleNetOut: used ? 200 : null,
    renewsAt: CLOCK + (8 + (i % 20)) * 86400,
    notes: '',
    status: 'active',
    createdAt: CLOCK - 90 * 86400,
    updatedAt: CLOCK - 3600,
  };
}

function qualityFields(q) {
  if (!q) return { qualityStatus: 'UNKNOWN', qualityLabel: '未测' };
  const reported = q.block?.status ?? null;
  if (reported === 'LIKELY_BLOCKED') return { qualityStatus: reported, qualityLabel: '疑似被墙' };
  if (q.ok !== true) return { qualityStatus: 'DOWN', qualityLabel: '整机失联' };
  if (reported) return { qualityStatus: reported, qualityLabel: q.block?.label ?? reported };
  return { qualityStatus: 'OK', qualityLabel: '大陆正常' };
}

function agentStatusOf(a) {
  if (!a || a.observedAt == null) return 'missing';
  return CLOCK - a.observedAt > 15 * 60 ? 'stale' : 'online';
}

const core = [
  { name: 'Tokyo · Fuji', listed: true, occupancy: 2 },
  { name: 'Tokyo · Neon', listed: true, occupancy: 1 },
  { name: 'Tokyo · Sakura', listed: true, occupancy: 1, blocked: true, stale: true, lossy: true },
  { name: 'Los Angeles · Mesa', listed: true, occupancy: 0 },
  { name: 'Los Angeles · Pacific-Coast-Highway-Backhaul-01', listed: true, occupancy: 0 },
  { name: 'Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2）', listed: true, occupancy: 0 },
  { name: 'Hong Kong · Victoria', listed: true, occupancy: 0 },
  { name: 'Seoul · Han', listed: true, occupancy: 0 },
  { name: 'London · Thames', listed: true, occupancy: 0 },
  { name: 'Frankfurt · Main · eu-central-1a-secondary · 法兰克福备用出口', listed: true, occupancy: 0, degraded: true },
  { name: 'Buffalo · Erie', listed: false, occupancy: 0, down: true },
  { name: 'Catalog Only', listed: true, occupancy: 0, noAgent: true, noQuality: true, noProfileUsed: true },
];

const extraNames = [
  '大阪 · 梅田',
  '大阪 · 難波备用出口 03',
  '台北 · 信义',
  '台北 · 南港 · 大陆优化线路',
  '深圳 · 南山备用出口 01',
  '香港 · 中环',
  '香港 · 荃湾 · 家宽回源',
  '首尔 · 江南',
  '釜山 · 海云台',
  '东京 · 渋谷',
  '东京 · 池袋 · 备用观测点',
  '名古屋 · 荣',
  '福冈 · 博多',
  '京都 · 四条',
  '札幌 · 大通',
  '仙台 · 青叶',
  '横滨 · みなとみらい',
  '神户 · 三宫',
  '广岛 · 纸屋町',
  '那霸 · 国际通',
  '高雄 · 盐埕',
  '台中 · 七期',
  '新北 · 板桥',
  '澳门 · 氹仔',
  '新加坡 · 滨海湾',
  '吉隆坡 · 武吉免登',
  '曼谷 · 素坤逸',
  '河内 · 还剑',
  '马尼拉 · 马卡蒂',
  '雅加达 · 南区',
];

const specs = core.map((row, i) => ({ ...row, i }));
extraNames.forEach((name, offset) => {
  const i = core.length + offset;
  specs.push({
    name,
    i,
    listed: offset % 9 !== 0,
    occupancy: offset % 6 === 0 ? 1 : 0,
    blocked: offset % 13 === 0,
    down: offset % 11 === 0,
    degraded: offset % 5 === 0 && offset % 11 !== 0 && offset % 13 !== 0,
    noQuality: offset % 8 === 0,
    noAgent: offset % 10 === 0,
    stale: offset % 7 === 0,
    lossy: offset % 5 === 0,
    carriersOnLiveOnly: offset % 6 === 1,
  });
});

function fleetNode(spec) {
  const {
    name, i, listed, occupancy = 0, blocked, down, degraded,
    noAgent, noQuality, stale, lossy, noProfileUsed, carriersOnLiveOnly,
  } = spec;
  const a = noAgent ? null : agent(name, i, {
    stale,
    carriers: !carriersOnLiveOnly,
    lossy,
  });
  const q = quality(name, i, { blocked, down, degraded, missing: noQuality });
  const p = profile(name, i, { used: !noProfileUsed, quota: !noProfileUsed });
  const qf = qualityFields(q);
  const aStatus = agentStatusOf(a);
  const reasons = [];
  if (listed === true && qf.qualityStatus === 'DOWN') reasons.push('catalog_health_down');
  if (listed === true && qf.qualityStatus === 'LIKELY_BLOCKED') reasons.push('catalog_likely_blocked');
  if (listed === true && aStatus === 'missing') reasons.push('agent_missing');
  if (listed === true && aStatus === 'stale') reasons.push('agent_stale');
  return {
    name,
    catalogListed: listed,
    qualityStatus: qf.qualityStatus,
    qualityLabel: qf.qualityLabel,
    agentStatus: aStatus,
    agentObservedAt: a?.observedAt ?? null,
    profile: p,
    agent: a,
    quality: q,
    occupancy,
    affectedUsers: occupancy > 0
      ? [{
          userId: `u-${i}`,
          deviceId: `d-${i}`,
          email: `user-${i}@example.com`,
          lastSeenAt: CLOCK - 30,
          online: true,
          clientVersion: '0.0.72',
          osVersion: 'macOS',
          selectedServer: name,
          uiState: 'connected',
          catalogRevision: 40,
          exitDelayMs: 90,
          tcpDelayMs: 40,
          exitDelayAtMs: (CLOCK - 30) * 1000,
          tcpDelayAtMs: (CLOCK - 30) * 1000,
          nodeHealth: blocked ? 'blocked' : 'ok',
          nodeHealthLabel: blocked ? '疑似被墙' : '大陆正常',
        }]
      : [],
    needsAttention: reasons.length > 0,
    reasons,
  };
}

const nodes = specs.map(fleetNode);
const liveAgents = [];
const liveQuality = [];
for (const spec of specs) {
  const node = nodes.find((n) => n.name === spec.name);
  if (spec.carriersOnLiveOnly && !spec.noAgent) {
    liveAgents.push(agent(spec.name, spec.i, { stale: spec.stale, carriers: true, lossy: spec.lossy }));
  } else if (node.agent) {
    liveAgents.push(node.agent);
  }
  if (node.quality) liveQuality.push(node.quality);
}

const fleet = {
  clock: CLOCK,
  nodes,
  sources: {
    catalog: { state: 'ready', updatedAt: CLOCK - 120 },
    quality: { state: 'ready', updatedAt: CLOCK - 45 },
    agents: { state: 'ready', updatedAt: CLOCK - 20 },
    profiles: { state: 'ready', updatedAt: CLOCK - 3600 },
  },
};

const live = {
  clock: CLOCK,
  live: {
    fetchedAt: CLOCK,
    agents: liveAgents,
    agentsError: null,
    agentsReceivedAt: CLOCK - 20,
    quality: {
      updatedAt: CLOCK - 45,
      updatedAtIso: new Date((CLOCK - 45) * 1000).toISOString(),
      cnAgentsConfigured: 3,
      nodes: liveQuality,
    },
    qualityError: null,
    qualityReceivedAt: CLOCK - 45,
  },
};

// The dense variant is what the console has to survive rather than what it
// usually sees: long Chinese names that want to push every column open, and
// enough rows that the card grid has to scroll.
const LONG_SUFFIXES = [
  ' \u00b7 \u5927\u9646\u4f18\u5316\u5907\u7528\u51fa\u53e3 \u00b7 CN2 GIA \u00b7 \u7b2c\u4e8c\u6279',
  ' \u00b7 \u5bb6\u5bbd\u56de\u6e90 \u00b7 \u6bcf\u6708 1 TB \u9650\u989d \u00b7 \u591c\u95f4\u9650\u901f',
  ' \u00b7 \u9999\u6e2f\u4e2d\u8f6c \u00b7 \u79fb\u52a8\u4f18\u5148 \u00b7 \u5907\u7528\u89c2\u6d4b\u70b9 07',
];

const denseSpecs = specs.map((spec, index) => ({
  ...spec,
  name: `${spec.name}${LONG_SUFFIXES[index % LONG_SUFFIXES.length]}`,
}));
for (let extra = 0; extra < 8; extra += 1) {
  const base = specs[extra % specs.length];
  denseSpecs.push({
    ...base,
    i: specs.length + extra,
    name: `${base.name} \u00b7 \u526f\u672c ${extra + 1}${LONG_SUFFIXES[extra % LONG_SUFFIXES.length]}`,
  });
}

const denseNodes = denseSpecs.map(fleetNode);
const denseFleet = { clock: CLOCK, nodes: denseNodes, sources: fleet.sources };
const denseLive = {
  clock: CLOCK,
  live: {
    ...live.live,
    agents: denseNodes.map((node) => node.agent).filter(Boolean),
    quality: {
      ...live.live.quality,
      nodes: denseNodes.map((node) => node.quality).filter(Boolean),
    },
  },
};

const emptyFleet = { clock: CLOCK, nodes: [], sources: fleet.sources };

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
writeFileSync(join(dir, 'fleet-nodes.json'), `${JSON.stringify(fleet, null, 2)}\n`);
writeFileSync(join(dir, 'live.json'), `${JSON.stringify(live, null, 2)}\n`);
writeFileSync(join(dir, 'fleet-nodes.dense.json'), `${JSON.stringify(denseFleet, null, 2)}\n`);
writeFileSync(join(dir, 'live.dense.json'), `${JSON.stringify(denseLive, null, 2)}\n`);
writeFileSync(join(dir, 'fleet-nodes.empty.json'), `${JSON.stringify(emptyFleet, null, 2)}\n`);
console.log(`wrote ${nodes.length} fleet nodes, ${denseNodes.length} dense`);
