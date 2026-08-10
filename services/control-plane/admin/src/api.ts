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
  memTotal: number | null;
  diskTotal: number | null;
}

export interface LiveQualityNodeDto {
  name: string;
  host: string | null;
  ok: boolean;
  quality: string | null;
  riskKeywords: string[];
  routeKeywords: string[];
  block: { status: string | null; label: string | null } | null;
}

export interface LiveDto {
  fetchedAt: number;
  agents: LiveAgentDto[] | null;
  agentsError: string | null;
  quality: {
    updatedAt: number | null;
    updatedAtIso: string | null;
    nodes: LiveQualityNodeDto[] | null;
  } | null;
  qualityError: string | null;
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

export const operationsApi = {
  dashboard: async () => (await get<{ dashboard: DashboardDto }>('dashboard')).dashboard,
  live: async () => (await get<{ live: LiveDto }>('live')).live,
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
  setUserExpiry: async (userId: string, expiresAt: number | null) => (
    await patch<{ ok: boolean }>(`users/${userId}`, { expiresAt })
  ),
};
