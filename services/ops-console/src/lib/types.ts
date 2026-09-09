export type CarrierKey = 'unicom' | 'telecom' | 'mobile';

export interface CarrierPingDto {
  latencyMs: number | null;
  lossPct: number | null;
  samples: number;
  targets: string[];
  history: Array<{ latencyMs: number | null; lossPct: number | null }>;
}

export type CarrierPingMapDto = Partial<Record<CarrierKey, CarrierPingDto>> | null;

export interface LiveListenerDto {
  port: number;
  address: string | null;
  process: string | null;
}

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

export interface LiveQualityNodeDto {
  name: string;
  host: string | null;
  publicIp: string | null;
  ok: boolean;
  quality: string | null;
  riskKeywords: string[];
  riskSignals: { tag: string; yes: number; no: number }[];
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
  observedAt: number | null;
  price: number | null;
  currency: string | null;
  billingCycle: number | null;
  expiredAt: number | null;
  trafficLimit: number | null;
  trafficLimitType: string | null;
  carriers: CarrierPingMapDto;
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
  reasons: string[];
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

export interface LiveDto {
  fetchedAt: number;
  agents: LiveAgentDto[] | null;
  agentsError: string | null;
  agentsReceivedAt: number | null;
  quality: {
    updatedAt: number | null;
    updatedAtIso: string | null;
    cnAgentsConfigured: number | null;
    nodes: LiveQualityNodeDto[] | null;
  } | null;
  qualityError: string | null;
  qualityReceivedAt: number | null;
}

export interface FleetFixtureFile {
  clock: number;
  nodes: FleetNodeDto[];
  sources: FleetDto['sources'];
}

export interface LiveFixtureFile {
  clock: number;
  live: LiveDto;
}
