/**
 * Synthetic ops payload for `vite` admin:dev (no Worker).
 * Imported only behind `import.meta.env.DEV`. Production builds must drop this.
 */

const now = () => Math.floor(Date.now() / 1000);

const names = [
  'Tokyo · Fuji', 'Tokyo · Neon', 'Tokyo · Sakura',
  'Los Angeles · Mesa', 'Los Angeles · Pacific', 'Singapore · Harbour',
  'Hong Kong · Victoria', 'Seoul · Han', 'London · Thames',
  'Frankfurt · Main', 'Buffalo · Erie', 'Catalog Only',
];

function agent(name: string, i: number, observedAt: number) {
  const stale = name.includes('Sakura');
  return {
    name,
    os: 'linux',
    arch: 'x64',
    cpuName: 'AMD',
    cpu: stale ? 1 : 8 + (i % 20),
    memTotal: 2 * 1024 ** 3,
    memUsed: (0.3 + (i % 5) * 0.1) * 2 * 1024 ** 3,
    diskTotal: 40 * 1024 ** 3,
    diskUsed: 8 * 1024 ** 3,
    netIn: 50_000_000_000 + i * 1_000_000,
    netOut: 8_000_000_000 + i * 200_000,
    uptime: 86400,
    cpuCores: 2,
    load1: stale ? 0.1 : 0.4 + i * 0.05,
    load5: 0.4,
    load15: 0.3,
    swapTotal: 0,
    swapUsed: 0,
    tcpConnections: 40 + i,
    processes: 120,
    observedAt: stale ? observedAt - 900 : observedAt - 20,
    price: 5.5,
    currency: '$',
    billingCycle: 30,
    expiredAt: observedAt + 20 * 86400,
    trafficLimit: 1024 ** 4,
    trafficLimitType: i % 4 === 0 ? 'min' : 'sum',
    carriers: name === 'Catalog Only' ? null : {
      unicom: { latencyMs: 40 + i * 8, lossPct: i === 2 ? 12 : 0, samples: 6, targets: ['三网-联通-北京'], history: [{ latencyMs: 42, lossPct: 0 }] },
      telecom: { latencyMs: 48 + i * 6, lossPct: 0, samples: 6, targets: ['三网-电信-上海'], history: [{ latencyMs: 50, lossPct: 0 }] },
      mobile: { latencyMs: 55 + i * 5, lossPct: 0, samples: 6, targets: ['三网-移动-广州'], history: [{ latencyMs: 52, lossPct: 0 }] },
    },
  };
}

function quality(name: string, i: number) {
  const blocked = name.includes('Sakura');
  const down = name.includes('Buffalo');
  return {
    name,
    host: `node-${i}.example`,
    publicIp: `203.0.113.${10 + i}`,
    ok: !blocked && !down,
    quality: blocked || down ? 'poor' : 'ok',
    riskKeywords: [],
    riskSignals: [],
    exposure: null,
    routeKeywords: i % 2 ? ['9929', 'CMIN2'] : ['CN2'],
    block: {
      status: blocked ? 'LIKELY_BLOCKED' : down ? 'DOWN' : 'OK',
      label: blocked ? '疑似被墙' : down ? '不通' : '大陆正常',
      rule: null,
      mainland: null,
      asiaEdge: null,
      overseas: null,
    },
    securityCheck: null,
    backtrace: null,
  };
}

export function matchDevOps(path: string, method = 'GET'): unknown {
  const clock = now();
  const base = path.split('?')[0];
  const listed = names.filter((name) => name !== 'Catalog Only' || true);
  const yaml = `proxies:\n${listed.filter((n) => n !== 'Catalog Only' || n === 'Catalog Only').filter((n) => n !== 'Buffalo · Erie').map((n) => `  - name: "${n}"\n    type: vless\n`).join('')}`;

  if (method !== 'GET') {
    return { ok: true, revision: 41 };
  }

  if (base === 'dashboard') {
    return {
      dashboard: {
        users: { total: 6, active: 5 },
        devices: { total: 8, active: 4 },
        servers: { total: names.length, active: names.length - 1 },
        logicalNodes: { total: names.length, active: names.length - 1 },
        deployments: { total: 1, active: 1 },
        catalog: { revision: 40, updatedAt: clock - 3600 },
        inventory: {
          unusedHomes: 2, unusedAccounts: 1, bannedUnreplaced: 0,
          incompleteUsers: 1, renewingSoon: 1, usersWithoutHome: 1,
        },
      },
    };
  }
  if (base === 'live') {
    const liveNames = names.filter((n) => n !== 'Catalog Only');
    return {
      live: {
        fetchedAt: clock,
        agents: liveNames.map((name, i) => agent(name, i, clock)),
        agentsError: null,
        quality: {
          updatedAt: clock,
          updatedAtIso: new Date(clock * 1000).toISOString(),
          cnAgentsConfigured: 3,
          nodes: liveNames.map((name, i) => quality(name, i)),
        },
        qualityError: null,
      },
    };
  }
  if (base === 'node-profiles') {
    return {
      profiles: names.map((name, i) => ({
        id: `p${i}`,
        catalogName: name,
        publicIp: `203.0.113.${10 + i}`,
        provider: 'demo',
        billingUrl: null,
        price: 5.5,
        currency: '$',
        billingCycle: 30,
        trafficQuotaBytes: 1024 ** 4,
        trafficUsedBytes: i === 0 ? null : 20 * 1024 ** 3,
        trafficCycleStart: null,
        trafficCycleEnd: null,
        cycleNetIn: i === 0 ? null : 1_000,
        cycleNetOut: i === 0 ? null : 200,
        renewsAt: clock + (8 + i) * 86400,
        notes: '',
        status: 'active',
        createdAt: clock,
        updatedAt: clock,
      })),
    };
  }
  if (base === 'activity') {
    return {
      activity: {
        onlineWindowSeconds: 20 * 60,
        onlineUsers: 3,
        onlineDevices: 4,
        users: [
          {
            userId: 'u-fast', deviceId: 'd1', email: 'fast@example.com', lastSeenAt: clock - 30,
            online: true, clientVersion: '0.0.34', osVersion: 'macOS', selectedServer: 'Tokyo · Fuji',
            uiState: 'connected', catalogRevision: 40, exitDelayMs: 90, tcpDelayMs: 40,
            exitDelayAtMs: clock - 30, tcpDelayAtMs: clock - 30, nodeHealth: 'ok', nodeHealthLabel: '大陆正常',
          },
          {
            userId: 'u-slow', deviceId: 'd-slow-good', email: 'slow@example.com', lastSeenAt: clock - 20,
            online: true, clientVersion: '0.0.34', osVersion: 'Windows', selectedServer: 'Tokyo · Neon',
            uiState: 'connected', catalogRevision: 39, exitDelayMs: 80, tcpDelayMs: 30,
            exitDelayAtMs: clock - 20, tcpDelayAtMs: clock - 20, nodeHealth: 'ok', nodeHealthLabel: '大陆正常',
          },
          {
            userId: 'u-slow', deviceId: 'd-slow-bad', email: 'slow@example.com', lastSeenAt: clock - 15,
            online: true, clientVersion: '0.0.34', osVersion: 'Windows', selectedServer: 'Tokyo · Neon',
            uiState: 'connected', catalogRevision: 39, exitDelayMs: 920, tcpDelayMs: 40,
            exitDelayAtMs: clock - 15, tcpDelayAtMs: clock - 15, nodeHealth: 'ok', nodeHealthLabel: '大陆正常',
          },
          {
            userId: 'u-blocked', deviceId: 'd3', email: 'blocked@example.com', lastSeenAt: clock - 40,
            online: true, clientVersion: '0.0.34', osVersion: 'macOS', selectedServer: 'Tokyo · Sakura',
            uiState: 'connected', catalogRevision: 40, exitDelayMs: 110, tcpDelayMs: 50,
            exitDelayAtMs: clock - 40, tcpDelayAtMs: clock - 40, nodeHealth: 'blocked', nodeHealthLabel: '疑似被墙',
          },
        ],
      },
    };
  }
  if (base === 'exit-catalog') {
    return { revision: 40, yaml, sha256: 'dev', updatedAt: clock };
  }
  if (base === 'fleet-nodes') {
    return { nodes: [], sources: { catalog: { state: 'ready', updatedAt: clock } } };
  }
  if (base === 'users') {
    return {
      users: [
        { id: 'u-fast', email: 'fast@example.com', deviceLimit: 3, quotaBytes: 200 * 1024 ** 3, usageBytes: 20 * 1024 ** 3, suspended: false, status: 'active', createdAt: clock, product: { accountRef: 'c1', status: 'assigned', openedAt: clock, replaceCount: 0, incomplete: false }, homeBinding: { homeExitId: 'h1', proxyName: 'home-1', displayName: '家宽 1', status: 'assigned' } },
        { id: 'u-slow', email: 'slow@example.com', deviceLimit: 3, quotaBytes: 200 * 1024 ** 3, usageBytes: 180 * 1024 ** 3, suspended: false, status: 'active', createdAt: clock, product: { accountRef: null, status: null, openedAt: null, replaceCount: 0, incomplete: true }, homeBinding: null },
        { id: 'u-blocked', email: 'blocked@example.com', deviceLimit: 3, quotaBytes: null, usageBytes: 0, suspended: false, status: 'active', createdAt: clock, product: { accountRef: 'c2', status: 'assigned', openedAt: clock, replaceCount: 0, incomplete: false }, homeBinding: { homeExitId: 'h2', proxyName: 'home-2', displayName: '家宽 2', status: 'assigned' } },
      ],
    };
  }
  if (base === 'metrics') {
    const points = Array.from({ length: 12 }, (_, i) => ({
      t: clock - (12 - i) * 300,
      cpu: 10 + i,
      memUsed: 1_000_000_000,
      memTotal: 2_000_000_000,
      diskUsed: 8_000_000_000,
      diskTotal: 40_000_000_000,
      load1: 0.4,
      netIn: 50_000_000_000 + i * 10_000_000,
      netOut: 8_000_000_000 + i * 1_000_000,
      swapUsed: 0,
      tcpConnections: 40,
    }));
    return { metrics: { from: clock - 3600, to: clock, resolutionSeconds: 300, series: { 'Tokyo · Fuji': points } } };
  }
  if (base === 'signup-allowlist') return { entries: [{ email: 'new@example.com', createdAt: clock }] };
  if (base === 'home-exits') {
    return {
      homeExits: [
        { id: 'h1', proxyName: 'home-1', displayName: '家宽 1', egressIpv4: '198.51.100.10', kind: 'socks5', status: 'assigned', createdAt: clock, updatedAt: clock },
        { id: 'h-pool', proxyName: 'home-pool', displayName: '闲置家宽', egressIpv4: '198.51.100.11', kind: 'socks5', status: 'pooled', createdAt: clock, updatedAt: clock },
      ],
    };
  }
  if (base === 'traffic-policy') {
    return { revision: 3, json: '{"direct":[]}', sha256: 'dev', updatedAt: clock };
  }
  if (base === 'audit') return { entries: [] };
  if (base.startsWith('product-accounts')) return { accounts: [] };
  return undefined;
}
