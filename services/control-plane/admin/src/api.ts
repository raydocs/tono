export interface CountSummary {
  total: number;
  active: number;
}

export interface DashboardDto {
  users: CountSummary;
  devices: CountSummary;
  servers: CountSummary;
  logicalNodes: CountSummary;
  deployments: CountSummary;
  catalog: { revision: number; updatedAt: number | null };
  inventory?: {
    unusedHomes: number;
    unusedAccounts: number;
    bannedUnreplaced: number;
    incompleteUsers: number;
    renewingSoon: number;
    usersWithoutHome: number;
  };
}

export interface ServerDto {
  id: string;
  displayName: string;
  regionCode: string;
  provider: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  latestDeployment: {
    releaseVersion: string;
    status: string;
    deployedAt: number | null;
  } | null;
}

export interface NodeDto {
  id: string;
  serverId: string;
  serverDisplayName: string;
  displayName: string;
  regionCode: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface CatalogRevisionDto {
  revision: number;
  sha256: string;
  publishedAt: number;
  serverCount: number;
  logicalNodeCount: number;
  deploymentCount: number;
  current: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  name?: string;
  plan?: string;
  deviceLimit: number;
  quotaBytes: number | null;
  usageBytes: number;
  expiresAt?: number;
  suspended: boolean;
  status: string;
  createdAt: number;
  notes?: string;
  contact?: string;
  firstEntitledAt?: number;
  hasExitIdentity?: boolean;
  product?: {
    accountRef: string | null;
    status: string | null;
    openedAt: number | null;
    replaceCount: number;
    incomplete: boolean;
  };
  homeBinding: {
    homeExitId: string;
    proxyName: string;
    displayName: string;
    egressIpv4?: string;
    kind?: string;
    socks5Host?: string;
    socks5Port?: number;
    defaultProxyName?: string;
    status: string;
  } | null;
}

export interface AllowlistEntry {
  email: string;
  createdAt: number;
}

export interface ProductAccountDto {
  id: string;
  userId: string | null;
  email?: string;
  product: string;
  accountRef: string;
  status: string;
  openedAt: number | null;
  closedAt: number | null;
  closeReason: string | null;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProductEventDto {
  id: string;
  accountId: string;
  userId: string | null;
  type: string;
  at: number;
  detail?: string;
  replacedByAccountId?: string;
}

export interface NodeProfileDto {
  id: string;
  catalogName: string;
  publicIp?: string;
  provider?: string;
  billingUrl?: string;
  price: number | null;
  currency: string | null;
  billingCycle: number | null;
  trafficQuotaBytes: number | null;
  trafficUsedBytes: number | null;
  trafficCycleStart: number | null;
  trafficCycleEnd: number | null;
  cycleNetIn: number | null;
  cycleNetOut: number | null;
  renewsAt: number | null;
  notes?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserDetailDto {
  devices: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: number;
    updatedAt: number;
  }>;
  diagnostics: Array<{
    referenceCode: string;
    receivedAt: number;
    clientVersion: string;
    osVersion: string;
    reportJson: string;
  }>;
  product?: {
    accounts: ProductAccountDto[];
    events: ProductEventDto[];
    replaceCount: number;
  };
  heartbeat?: {
    lastSeenAt: number;
    clientVersion: string;
    osVersion: string;
    selectedServer: string | null;
    uiState: string | null;
    exitDelayMs: number | null;
    tcpDelayMs: number | null;
    exitDelayAtMs: number | null;
    tcpDelayAtMs: number | null;
    nodeHealth: string | null;
    nodeHealthLabel: string | null;
  } | null;
}

export interface HomeExitDto {
  id: string;
  proxyName: string;
  displayName: string;
  egressIpv4?: string;
  kind: string;
  socks5Host?: string;
  socks5Port?: number;
  status: string;
  notes?: string;
  bindCount?: number;
  lastProbedAt?: number;
  probeStatus?: string;
  probeAlive?: number;
  probeTotal?: number;
  probeUptimeRatio?: number;
  createdAt: number;
  updatedAt: number;
}

export interface HomeBindingDto {
  userId: string;
  email?: string;
  homeExitId: string;
  proxyName: string;
  displayName: string;
  egressIpv4?: string;
  kind?: string;
  socks5Host?: string;
  socks5Port?: number;
  defaultProxyName?: string;
  homeStatus: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExitCatalogDto {
  revision: number;
  yaml: string;
  sha256: string;
  updatedAt?: number;
}

export interface LiveAgentDto {
  name: string;
  os: string | null;
  arch: string | null;
  cpuName: string | null;
  cpu: number | null;
  memTotal: number | null;
  memUsed: number | null;
  diskTotal: number | null;
  diskUsed: number | null;
  netIn: number | null;
  netOut: number | null;
  uptime: number | null;
  cpuCores: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  swapTotal: number | null;
  swapUsed: number | null;
  tcpConnections: number | null;
  processes: number | null;
  /** When the agent last reported. A stalled agent is indistinguishable from a
   *  healthy idle one without this. */
  observedAt: number | null;
  price: number | null;
  currency: string | null;
  billingCycle: number | null;
  expiredAt: number | null;
  trafficLimit: number | null;
  trafficLimitType: string | null;
  /** Mainland reachability *from* this node — see `CarrierPingDto`. `null` when
   *  no carrier has been probed yet. */
  carriers: CarrierPingMapDto;
}

export type CarrierKey = 'unicom' | 'telecom' | 'mobile';

/**
 * One carrier's path quality as measured from a node, over the last hour.
 *
 * A carrier that appears here was actually probed. One that was not is absent
 * from the map rather than present with zeros — Komari reports an unrun ping
 * task as `avg: 0, loss: 0`, which reads exactly like a flawless result, so
 * "no data" has to survive the trip as an absence.
 *
 * This measures the direction node → 中国. Whether China can reach the node is
 * the block verdict, which comes from the mainland agents and is not this.
 */
export interface CarrierPingDto {
  latencyMs: number | null;
  lossPct: number | null;
  samples: number;
  /** The ping tasks averaged into this row; several cities, so the number is
   *  about the carrier rather than about one city's distance. */
  targets: string[];
  history: Array<{ latencyMs: number | null; lossPct: number | null }>;
}

export type CarrierPingMapDto = Partial<Record<CarrierKey, CarrierPingDto>> | null;

export interface LiveProbeDto {
  ok?: boolean;
  success?: number;
  fail?: number;
  total?: number;
  rate?: number;
  status?: string;
  source?: string;
  note?: string;
  authoritative?: boolean;
}

export interface LiveListenerDto {
  port: number;
  address: string | null;
  process: string | null;
}

export interface LiveQualityNodeDto {
  name: string;
  host: string | null;
  publicIp: string | null;
  ok: boolean;
  quality: string | null;
  riskKeywords: string[];
  /** How many of securityCheck's databases took each side. A tag with more
   *  `no` than `yes` is a minority opinion, not a finding. */
  riskSignals: { tag: string; yes: number; no: number }[];
  /** What the node offers the internet. `null` means no collector run has
   *  looked yet — which must not be rendered as clean. */
  exposure: {
    clean: boolean;
    sshPorts: number[];
    unexpected: LiveListenerDto[];
    acknowledged: (LiveListenerDto & { reason: string | null })[];
    expected: LiveListenerDto[];
  } | null;
  routeKeywords: string[];
  block: {
    status: string | null;
    label: string | null;
    rule: string | null;
    mainland: LiveProbeDto | null;
    asiaEdge: LiveProbeDto | null;
    overseas: LiveProbeDto | null;
  } | null;
  securityCheck: string | null;
  backtrace: string | null;
}

export interface LiveDto {
  fetchedAt: number;
  agents: LiveAgentDto[] | null;
  agentsError: string | null;
  quality: {
    updatedAt: number | null;
    updatedAtIso: string | null;
    cnAgentsConfigured: number | null;
    nodes: LiveQualityNodeDto[] | null;
  } | null;
  qualityError: string | null;
}

export type FleetReason =
  | 'catalog_health_down'
  | 'catalog_likely_blocked'
  | 'agent_missing'
  | 'agent_stale'
  | 'profile_retired_but_listed'
  | string;

export interface FleetNodeDto {
  name: string;
  catalogListed: boolean | null;
  qualityStatus: string;
  qualityLabel: string;
  agentStatus: string;
  agentObservedAt: number | null;
  profile: NodeProfileDto | null;
  agent: LiveAgentDto | null;
  quality: LiveQualityNodeDto | null;
  occupancy: number;
  affectedUsers: ActivityUserDto[];
  needsAttention: boolean;
  reasons: FleetReason[];
}

export interface FleetRetireChangesDto {
  catalogEntryRemoved: boolean;
  proxyGroupReferencesRemoved: string[];
  profileMarkedRetired: boolean;
}

export interface FleetRetirePreviewDto {
  node: FleetNodeDto;
  expectedRevision: number;
  currentRevision: number;
  affectedUsers: ActivityUserDto[];
  changes: FleetRetireChangesDto;
  warnings: string[];
  canRetire: boolean;
}

export interface FleetRetireResultDto {
  node: FleetNodeDto;
  previousRevision: number;
  revision: number;
  sha256: string;
  affectedUsers: ActivityUserDto[];
  changes: FleetRetireChangesDto;
  warnings: string[];
}

export interface FleetSourceDto {
  state: string;
  message?: string | null;
  updatedAt?: number | null;
}

export interface FleetDto {
  nodes: FleetNodeDto[];
  sources: Record<string, FleetSourceDto> & { catalog?: FleetSourceDto };
}

export interface ActivityUserDto {
  userId: string;
  deviceId: string | null;
  email: string;
  lastSeenAt: number;
  online: boolean;
  clientVersion: string;
  osVersion: string;
  selectedServer: string | null;
  uiState: string | null;
  catalogRevision: number | null;
  exitDelayMs: number | null;
  tcpDelayMs: number | null;
  exitDelayAtMs: number | null;
  tcpDelayAtMs: number | null;
  nodeHealth: string | null;
  nodeHealthLabel: string | null;
}

export interface ActivityDto {
  onlineWindowSeconds: number;
  onlineUsers: number;
  onlineDevices: number;
  users: ActivityUserDto[];
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1/ops/${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const envelope = await response.json() as ErrorEnvelope;
      message = envelope.error?.message || message;
    } catch {
      // Keep status-only message for non-JSON Access or network responses.
    }
    throw new Error(message);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>(path, { method: 'GET' });
const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string, body?: unknown) => request<T>(path, {
  method: 'DELETE',
  body: body === undefined ? undefined : JSON.stringify(body),
});

/**
 * What a profile write may say, which is not the same shape as what a read
 * returns. Three states have to survive the trip and `Partial<NodeProfileDto>`
 * could only express two of them:
 *
 *   omitted  — leave whatever is stored alone
 *   null     — clear the stored value
 *   a number — set it
 *
 * The distinction is load-bearing because `JSON.stringify` drops `undefined`
 * members entirely. A form that sent `undefined` for an emptied box was asking
 * the server to keep the old value, so a wrong quota could be typed but never
 * removed.
 */
export interface NodeProfileInput {
  catalogName?: string;
  publicIp?: string | null;
  provider?: string | null;
  billingUrl?: string | null;
  trafficQuotaBytes?: number | null;
  trafficUsedBytes?: number | null;
  trafficCycleStart?: number | null;
  trafficCycleEnd?: number | null;
  cycleNetIn?: number | null;
  cycleNetOut?: number | null;
  renewsAt?: number | null;
  notes?: string | null;
  status?: string;
}

export interface TrafficPolicyDto {
  revision: number;
  json: string;
  sha256: string;
  updatedAt?: number;
  signature?: string;
}

export interface DeviceActionDto {
  id: string;
  userId: string;
  deviceId: string;
  action: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  deliveredAt: number | null;
  completedAt: number | null;
  result: unknown;
}

export interface MetricPointDto {
  t: number;
  cpu: number | null;
  memUsed: number | null;
  memTotal: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
  load1: number | null;
  netIn: number | null;
  netOut: number | null;
  swapUsed: number | null;
  tcpConnections: number | null;
}

export interface MetricsDto {
  from: number;
  to: number;
  resolutionSeconds: number;
  series: Record<string, MetricPointDto[]>;
}

export const operationsApi = {
  dashboard: async () => (await get<{ dashboard: DashboardDto }>('dashboard')).dashboard,
  live: async () => (await get<{ live: LiveDto }>('live')).live,
  fleetNodes: async () => get<FleetDto>('fleet-nodes'),
  fleetRetirePreview: async (name: string) => get<FleetRetirePreviewDto>(
    `fleet-nodes/${encodeURIComponent(name)}/retire-preview`,
  ),
  retireFleetNode: async (name: string, expectedRevision: number, confirmation: string, reason: string) => (
    post<FleetRetireResultDto>(`fleet-nodes/${encodeURIComponent(name)}/retire`, {
      expectedRevision,
      confirmation,
      reason,
    })
  ),
  metrics: async (range = '24h', node?: string) => {
    const query = new URLSearchParams({ range });
    if (node) query.set('node', node);
    return (await get<{ metrics: MetricsDto }>(`metrics?${query}`)).metrics;
  },
  activity: async () => (await get<{ activity: ActivityDto }>('activity')).activity,
  servers: async () => (await get<{ servers: ServerDto[] }>('servers')).servers,
  nodes: async () => (await get<{ nodes: NodeDto[] }>('nodes')).nodes,
  catalogRevisions: async () => (
    await get<{ revisions: CatalogRevisionDto[] }>('catalog-revisions')
  ).revisions,
  users: async () => (await get<{ users: UserDto[] }>('users')).users,
  userDetail: async (userId: string) => get<UserDetailDto>(`users/${userId}/detail`),
  signupAllowlist: async () => (await get<{ entries: AllowlistEntry[] }>('signup-allowlist')).entries,
  addSignupEmail: async (email: string) => post<{ email: string; createdAt: number; created: boolean }>(
    'signup-allowlist',
    { email },
  ),
  removeSignupEmail: async (email: string) => del<void>('signup-allowlist', { email }),
  homeExits: async () => (await get<{ homeExits: HomeExitDto[] }>('home-exits')).homeExits,
  assignHomeLine: async (input: {
    userId: string;
    line: string;
    displayName?: string;
    defaultProxyName?: string | null;
    replace?: boolean;
  }) => post<{
    homeExit: HomeExitDto;
    binding: HomeBindingDto;
    created: boolean;
    replaced: boolean;
    retiredHomeExitId?: string;
    refreshQueued: number;
  }>('home-exits/assign', input),
  importHomeLines: async (lines: string[]) => post<{
    created: HomeExitDto[];
    skipped: Array<{ host?: string; port?: number; username?: string; message: string }>;
    failed: Array<{ message: string }>;
  }>('home-exits/import', { lines }),
  createHomeExit: async (input: {
    proxyName: string;
    displayName: string;
    egressIpv4?: string;
    kind?: string;
    socks5Host?: string;
    socks5Port?: number;
    socks5Username?: string;
    socks5Password?: string;
    notes?: string;
    status?: string;
  }) => (await post<{ homeExit: HomeExitDto }>('home-exits', input)).homeExit,
  updateHomeExit: async (id: string, input: Partial<{
    proxyName: string;
    displayName: string;
    egressIpv4: string | null;
    kind: string;
    socks5Host: string | null;
    socks5Port: number | null;
    socks5Username: string | null;
    socks5Password: string | null;
    notes: string | null;
    status: string;
  }>) => (await patch<{ homeExit: HomeExitDto }>(`home-exits/${id}`, input)).homeExit,
  deleteHomeExit: async (id: string) => del<void>(`home-exits/${id}`),
  homeBindings: async () => (await get<{ bindings: HomeBindingDto[] }>('home-bindings')).bindings,
  exitCatalog: async () => get<ExitCatalogDto>('exit-catalog'),
  bindUserHome: async (userId: string, input: {
    homeExitId?: string;
    proxyName?: string;
    defaultProxyName?: string | null;
  }) => (
    await put<{ binding: HomeBindingDto }>(`users/${userId}/home-binding`, input)
  ).binding,
  unbindUserHome: async (userId: string) => del<void>(`users/${userId}/home-binding`),
  setUserStatus: async (userId: string, status: 'active' | 'disabled') => (
    await patch<{ ok: boolean }>(`users/${userId}`, { status })
  ),
  closeUser: async (userId: string) => post<{ ok: boolean; email: string; status: string }>(`users/${userId}/close`, {}),
  setUserExpiry: async (userId: string, expiresAt: number | null) => (
    await patch<{ ok: boolean }>(`users/${userId}`, { expiresAt })
  ),
  replaceCatalog: async (yaml: string, expectedRevision: number) =>
    put<{ revision: number; sha256: string; updatedAt: number }>('exit-catalog', { yaml, expectedRevision }),
  trafficPolicy: async () => get<TrafficPolicyDto>('traffic-policy'),
  replaceTrafficPolicy: async (policy: unknown, expectedRevision: number) =>
    put<TrafficPolicyDto>('traffic-policy', { policy, expectedRevision }),
  enqueueDeviceAction: async (deviceId: string, action: string) =>
    post<{ action: DeviceActionDto }>('device-actions', { deviceId, action }),
  deviceActions: async (deviceId?: string) => (
    await get<{ actions: DeviceActionDto[] }>(
      deviceId ? `device-actions?deviceId=${encodeURIComponent(deviceId)}` : 'device-actions',
    )
  ).actions,
  revokeDevice: async (deviceId: string) => del<void>(`devices/${deviceId}`),
  onboardUser: async (input: {
    email: string;
    line?: string;
    homeExitId?: string;
    accountRef?: string;
    productAccountId?: string;
    openedAt?: number;
    notes?: string;
    contact?: string;
  }) => post<{
    email: string;
    userId: string | null;
    allowlisted: boolean;
    exitIdentityIssued: boolean;
    binding: HomeBindingDto | null;
    account: ProductAccountDto | null;
    incomplete: string[];
  }>('users/onboard', input),
  patchUser: async (userId: string, input: {
    status?: 'active' | 'disabled';
    expiresAt?: number | null;
    notes?: string | null;
    contact?: string | null;
    plan?: string | null;
  }) => patch<{ ok: boolean }>(`users/${userId}`, input),
  // Only ever `true`. There is no un-reset, and the server rejects any other
  // value rather than treating it as "no".
  resetUserUsage: async (userId: string) => (
    await patch<{ ok: boolean }>(`users/${userId}`, { resetUsage: true })
  ),
  productAccounts: async (status?: string) => (
    await get<{ accounts: ProductAccountDto[] }>(
      status ? `product-accounts?status=${encodeURIComponent(status)}` : 'product-accounts',
    )
  ).accounts,
  createProductAccount: async (input: {
    accountRef: string;
    userId?: string;
    openedAt?: number;
    notes?: string;
  }) => (await post<{ account: ProductAccountDto }>('product-accounts', input)).account,
  banProductAccount: async (id: string, detail?: string) =>
    (await post<{ account: ProductAccountDto }>(`product-accounts/${id}/ban`, { detail })).account,
  replaceProductAccount: async (id: string, accountRef: string, notes?: string) =>
    (await post<{ previous: ProductAccountDto; account: ProductAccountDto }>(
      `product-accounts/${id}/replace`,
      { accountRef, notes },
    )),
  nodeProfiles: async () => (await get<{ profiles: NodeProfileDto[] }>('node-profiles')).profiles,
  createNodeProfile: async (input: NodeProfileInput & { catalogName: string }) =>
    (await post<{ profile: NodeProfileDto }>('node-profiles', input)).profile,
  updateNodeProfile: async (id: string, input: NodeProfileInput) =>
    (await put<{ profile: NodeProfileDto }>(`node-profiles/${id}`, input)).profile,
  nodeIncident: async (name: string) => get<{
    node: string;
    onlineWindowSeconds: number;
    affected: ActivityUserDto[];
  }>(`incidents/node/${encodeURIComponent(name)}`),
  audit: async () => (await get<{
    entries: Array<{
      id: string;
      at: number;
      actorEmail: string;
      action: string;
      targetType: string;
      targetId: string | null;
      summary: string;
    }>;
  }>('audit')).entries,
};
