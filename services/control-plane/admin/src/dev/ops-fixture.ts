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

const registered = new Set(['fast@example.com', 'slow@example.com', 'blocked@example.com', 'quiet@example.com', 'old@example.com']);
const closed = new Set<string>();
const extraBindings = new Map<string, { homeExitId: string; displayName: string; proxyName: string }>();
const extraExpiry = new Map<string, number | null>();
const extraActions: Array<{ id: string; userId: string; deviceId: string; action: string; status: string; createdAt: number }> = [];
const extraHomes: Array<Record<string, unknown>> = [];


export function matchDevOps(path: string, method = 'GET', body?: string): unknown {
  const clock = now();
  const base = path.split('?')[0];
  const listed = names.filter((name) => name !== 'Catalog Only' || true);
  const yaml = `proxies:\n${listed.filter((n) => n !== 'Catalog Only' || n === 'Catalog Only').filter((n) => n !== 'Buffalo · Erie').map((n) => `  - name: "${n}"\n    type: vless\n`).join('')}`;

  if (method !== 'GET') {
    const payload = (() => {
      try { return JSON.parse(body || '{}') as Record<string, unknown>; } catch { return {}; }
    })();
    if (base === 'users/onboard') {
      const email = String(payload.email || '').trim();
      if (registered.has(email.toLowerCase())) {
        return {
          email,
          userId: `u-${email.split('@')[0]}`,
          allowlisted: true,
          exitIdentityIssued: true,
          binding: payload.homeExitId || payload.line ? {
            userId: `u-${email.split('@')[0]}`,
            homeExitId: String(payload.homeExitId || 'h-new'),
            proxyName: 'home-bound',
            displayName: '已绑家宽',
            status: 'assigned',
            createdAt: clock,
            updatedAt: clock,
          } : null,
          account: payload.accountRef || payload.productAccountId ? {
            id: 'pa-onboard', userId: `u-${email.split('@')[0]}`, product: 'claude',
            accountRef: String(payload.accountRef || 'pooled'), status: 'assigned',
            openedAt: clock, closedAt: null, closeReason: null, createdAt: clock, updatedAt: clock,
          } : null,
          incomplete: [],
        };
      }
      return { email, userId: null, allowlisted: true, exitIdentityIssued: false, binding: null, account: null, incomplete: [] };
    }
    if (base.endsWith('/close')) {
      const userId = base.split('/')[1];
      closed.add(userId);
      return { ok: true, email: 'dev@example.com', status: 'disabled' };
    }
    if (base.endsWith('/home-binding') && (method === 'PUT' || method === 'POST')) {
      const userId = base.split('/')[1];
      const binding = {
        userId,
        homeExitId: String(payload.homeExitId || 'h-pool'),
        proxyName: 'home-pool',
        displayName: '闲置家宽',
        kind: 'socks5',
        socks5Host: '198.51.100.11',
        socks5Port: 11080,
        defaultProxyName: payload.defaultProxyName == null ? null : String(payload.defaultProxyName),
        status: 'assigned',
        homeStatus: 'assigned',
        createdAt: clock,
        updatedAt: clock,
      };
      extraBindings.set(userId, { homeExitId: binding.homeExitId, displayName: binding.displayName, proxyName: binding.proxyName });
      return { binding };
    }
    if (base.endsWith('/home-binding') && method === 'DELETE') {
      extraBindings.delete(base.split('/')[1]);
      return { ok: true };
    }
    if (base.startsWith('users/') && method === 'PATCH') {
      const userId = base.split('/')[1];
      if ('expiresAt' in payload) extraExpiry.set(userId, payload.expiresAt == null ? null : Number(payload.expiresAt));
      return { ok: true };
    }
    if (base === 'home-exits/import' || (base === 'home-exits' && method === 'POST' && Array.isArray((payload as { lines?: unknown }).lines))) {
      const lines = (payload.lines as string[] | undefined) ?? [];
      return {
        created: lines.slice(0, 1).map((_, i) => ({
          id: `h-imp-${clock}-${i}`, proxyName: `imp-${i}`, displayName: `导入 ${i + 1}`,
          kind: 'socks5', status: 'active', createdAt: clock, updatedAt: clock, bindCount: 0,
        })),
        skipped: [],
        failed: lines.length > 1 ? [{ message: '第二行格式不对' }] : [],
      };
    }
    if (base === 'home-exits' && method === 'POST') {
      const created = {
        id: `h-new-${clock}`,
        proxyName: String(payload.proxyName || 'new'),
        displayName: String(payload.displayName || '新线路'),
        kind: String(payload.kind || 'socks5'),
        egressIpv4: payload.egressIpv4 ? String(payload.egressIpv4) : undefined,
        notes: payload.notes ? String(payload.notes) : undefined,
        socks5Host: payload.socks5Host ? String(payload.socks5Host) : undefined,
        socks5Port: payload.socks5Port == null ? undefined : Number(payload.socks5Port),
        status: 'active',
        bindCount: 0,
        createdAt: clock,
        updatedAt: clock,
      };
      extraHomes.push(created);
      return { homeExit: created };
    }
    if (base.startsWith('home-exits/') && method === 'PATCH') {
      return { homeExit: { id: base.split('/')[1], proxyName: 'home-pool', displayName: '闲置家宽', kind: 'socks5', status: String(payload.status || 'active'), createdAt: clock, updatedAt: clock, bindCount: 0 } };
    }
    if (base.includes('product-accounts')) {
      return {
        account: {
          id: 'pa1', userId: String(payload.userId || 'u-slow'), product: 'claude',
          accountRef: String(payload.accountRef || 'new-ref'), status: 'assigned',
          openedAt: clock - 10 * 86400, closedAt: null, closeReason: null, createdAt: clock, updatedAt: clock,
        },
        previous: undefined,
      };
    }
    if (base === 'device-actions' && method === 'POST') {
      const action = {
        id: `a-${clock}`,
        userId: 'u-fast',
        deviceId: String(payload.deviceId || 'd1'),
        action: String(payload.action || 'diagnostic_snapshot'),
        status: 'queued',
        createdAt: clock,
        expiresAt: clock + 60,
        deliveredAt: null,
        completedAt: null,
        result: null,
      };
      extraActions.unshift(action);
      return { action };
    }
    if (base.startsWith('home-exits/assign') || base === 'home-exits/assign') {
      return {
        homeExit: { id: 'h-new', proxyName: 'new', displayName: '新线路', kind: 'socks5', status: 'active', createdAt: clock, updatedAt: clock, bindCount: 1 },
        binding: { userId: String(payload.userId || 'u-slow'), homeExitId: 'h-new', proxyName: 'new', displayName: '新线路', status: 'assigned', createdAt: clock, updatedAt: clock },
        created: true,
        replaced: Boolean(payload.replace),
        refreshQueued: 1,
      };
    }
    return undefined;
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
            exitDelayAtMs: (clock - 30) * 1000, tcpDelayAtMs: (clock - 30) * 1000, nodeHealth: 'ok', nodeHealthLabel: '大陆正常',
          },
          {
            userId: 'u-slow', deviceId: 'd-slow-good', email: 'slow@example.com', lastSeenAt: clock - 20,
            online: true, clientVersion: '0.0.34', osVersion: 'Windows', selectedServer: 'Tokyo · Neon',
            uiState: 'connected', catalogRevision: 39, exitDelayMs: 80, tcpDelayMs: 30,
            exitDelayAtMs: (clock - 20) * 1000, tcpDelayAtMs: (clock - 20) * 1000, nodeHealth: 'ok', nodeHealthLabel: '大陆正常',
          },
          {
            userId: 'u-slow', deviceId: 'd-slow-bad', email: 'slow@example.com', lastSeenAt: clock - 15,
            online: true, clientVersion: '0.0.34', osVersion: 'Windows', selectedServer: 'Tokyo · Neon',
            uiState: 'connected', catalogRevision: 39, exitDelayMs: 920, tcpDelayMs: 40,
            exitDelayAtMs: (clock - 15) * 1000, tcpDelayAtMs: (clock - 15) * 1000, nodeHealth: 'ok', nodeHealthLabel: '大陆正常',
          },
          {
            userId: 'u-blocked', deviceId: 'd3', email: 'blocked@example.com', lastSeenAt: clock - 40,
            online: true, clientVersion: '0.0.34', osVersion: 'macOS', selectedServer: 'Tokyo · Sakura',
            uiState: 'connected', catalogRevision: 40, exitDelayMs: 110, tcpDelayMs: 50,
            exitDelayAtMs: (clock - 40) * 1000, tcpDelayAtMs: (clock - 40) * 1000, nodeHealth: 'blocked', nodeHealthLabel: '疑似被墙',
          },
          {
            userId: 'u-ghost', deviceId: 'd-ghost', email: 'ghost@example.com', lastSeenAt: clock - 12,
            online: true, clientVersion: '0.0.34', osVersion: 'macOS', selectedServer: 'Tokyo · Fuji',
            uiState: 'connected', catalogRevision: 40, exitDelayMs: 70, tcpDelayMs: 28,
            exitDelayAtMs: (clock - 12) * 1000, tcpDelayAtMs: (clock - 12) * 1000, nodeHealth: 'ok', nodeHealthLabel: '大陆正常',
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
  if (base === 'device-actions') {
    return { actions: extraActions };
  }
  if (base === 'users') {
    const withExtras = (user: Record<string, unknown>) => {
      const id = String(user.id);
      const bound = extraBindings.get(id);
      const expiry = extraExpiry.get(id);
      return {
        ...user,
        status: closed.has(id) ? 'disabled' : user.status,
        expiresAt: extraExpiry.has(id) ? expiry : user.expiresAt,
        homeBinding: bound
          ? { homeExitId: bound.homeExitId, proxyName: bound.proxyName, displayName: bound.displayName, status: 'assigned' }
          : user.homeBinding,
      };
    };
    return {
      users: [
        { id: 'u-fast', email: 'fast@example.com', deviceLimit: 3, quotaBytes: 200 * 1024 ** 3, usageBytes: 20 * 1024 ** 3, suspended: false, status: 'active', createdAt: clock, hasExitIdentity: true, product: { accountRef: 'c1', status: 'assigned', openedAt: clock, replaceCount: 0, incomplete: false }, homeBinding: { homeExitId: 'h1', proxyName: 'home-1', displayName: '家宽 1', status: 'assigned' } },
        { id: 'u-slow', email: 'slow@example.com', deviceLimit: 3, quotaBytes: 200 * 1024 ** 3, usageBytes: 180 * 1024 ** 3, suspended: false, status: 'active', createdAt: clock, hasExitIdentity: true, product: { accountRef: null, status: null, openedAt: null, replaceCount: 0, incomplete: true }, homeBinding: null },
        { id: 'u-blocked', email: 'blocked@example.com', deviceLimit: 3, quotaBytes: null, usageBytes: 0, suspended: false, status: 'active', createdAt: clock, hasExitIdentity: true, product: { accountRef: 'c2', status: 'assigned', openedAt: clock, replaceCount: 0, incomplete: false }, homeBinding: { homeExitId: 'h2', proxyName: 'home-2', displayName: '家宽 2', status: 'assigned' } },
        { id: 'u-quiet', email: 'quiet@example.com', deviceLimit: 3, quotaBytes: 100 * 1024 ** 3, usageBytes: 1, suspended: false, status: 'active', createdAt: clock, hasExitIdentity: true, product: { accountRef: null, status: null, openedAt: null, replaceCount: 0, incomplete: true }, homeBinding: null },
        { id: 'u-old', email: 'old@example.com', deviceLimit: 3, quotaBytes: 50 * 1024 ** 3, usageBytes: 10, suspended: false, status: 'active', createdAt: clock - 90 * 86400, expiresAt: clock - 86400, hasExitIdentity: true, product: { accountRef: 'c3', status: 'assigned', openedAt: clock, replaceCount: 0, incomplete: false }, homeBinding: null },
      ].map(withExtras),
    };
  }
  if (base.startsWith('users/') && base.endsWith('/detail')) {
    const id = base.split('/')[1];
    return {
      devices: [{ id: `dev-${id}`, name: 'Mac', status: 'active', createdAt: clock, updatedAt: clock }],
      diagnostics: [{ referenceCode: 'ABC123', receivedAt: clock - 100, clientVersion: '0.0.34', osVersion: 'macOS', reportJson: '{"ok":true,"email":"hidden"}' }],
      product: {
        accounts: id === 'u-fast' ? [{
          id: 'pa-fast', userId: id, product: 'claude', accountRef: 'c1', status: 'assigned',
          openedAt: clock - 12 * 86400, closedAt: null, closeReason: null, createdAt: clock, updatedAt: clock,
        }] : [],
        events: [{ id: 'ev1', accountId: 'pa-fast', userId: id, type: 'assigned', at: clock - 86400, detail: '从号池领出' }],
        replaceCount: 0,
      },
      heartbeat: null,
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
        { id: 'h1', proxyName: 'home-1', displayName: '家宽 1', egressIpv4: '198.51.100.10', socks5Host: '198.51.100.10', socks5Port: 1080, kind: 'socks5', status: 'assigned', bindCount: 1, createdAt: clock, updatedAt: clock },
        {
          id: 'h-pool', proxyName: 'home-pool', displayName: '闲置家宽', egressIpv4: '198.51.100.11',
          socks5Host: '198.51.100.11', socks5Port: 11080, kind: 'socks5', status: 'active', bindCount: 0,
          notes: '备用', probeStatus: 'ok', probeUptimeRatio: 0.98, lastProbedAt: clock - 600,
          createdAt: clock, updatedAt: clock,
        },
        ...extraHomes,
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
