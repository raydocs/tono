import type {
  ActivityUserDto,
  LiveAgentDto,
  LiveQualityNodeDto,
  NodeProfileDto,
  UserDto,
} from '../api';
import { catalogProxyNames } from './catalog';
import { customerPathVerdict, pickWorstActivity, type CustomerPathVerdict } from './incidents';
import { carrierLossSignals } from './carrier';
import { machineSignals, mergedBilling, trafficRemaining, type BillingView } from './machine';
import { catalogLag, type CatalogLag } from './revision';
import { measurementFresh } from './freshness';
import { blockLabel, blockStatus } from './quality';
import { msEpochToSec } from './time';
import { parseTrafficLimitType, type TrafficAccounting } from './traffic';

export type NodeDot = 'ok' | 'warn' | 'bad' | 'unknown';
export type SourceKind = 'ready' | 'unavailable' | 'loading';
export type CatalogState = 'known-listed' | 'known-unlisted' | 'unavailable';
export type QualityState = 'reported' | 'unmeasured' | 'unavailable';
export type AgentState = 'reported' | 'stale' | 'unreported' | 'unavailable';
export type OccupancyState = 'known' | 'unavailable';

export type OpsSignal = {
  label: string;
  severity: number;
  kind?: 'carrier-loss';
};

export type OpsNodeView = {
  name: string;
  catalogListed: boolean | null;
  catalogState: CatalogState;
  quality: LiveQualityNodeDto | null;
  qualityState: QualityState;
  agent: LiveAgentDto | null;
  agentState: AgentState;
  profile: NodeProfileDto | null;
  occupancy: number | null;
  occupancyState: OccupancyState;
  occupants: Array<{ userId: string; email: string }>;
  billing: BillingView;
  trafficRemain: number | null;
  quotaAccounting: TrafficAccounting;
  quotaAssumed: boolean;
  signals: OpsSignal[];
  ok: boolean | null;
  blockStatus: string;
  blockLabel: string;
  routeKeywords: string[];
  pathSummary: { worstExitMs: number | null; worstTcpMs: number | null; samples: number } | null;
  billingState: 'known' | 'partial' | 'unavailable';
  /** Composite presentation: mainland quality AND agent freshness. */
  dot: NodeDot;
};

export type NodeRootCause = 'blocked' | 'offline' | 'pressure' | 'noprobe' | 'ok' | 'unknown';

function isMachinePressure(node: OpsNodeView): boolean {
  return node.signals.some((signal) => signal.severity >= 3 && signal.kind !== 'carrier-loss')
    || node.agentState === 'stale';
}

export function hasBadCarrierLoss(node: OpsNodeView): boolean {
  return node.signals.some((signal) => signal.kind === 'carrier-loss' && signal.severity >= 3);
}

export function carrierLossLine(node: OpsNodeView): string | null {
  const labels = node.signals
    .filter((signal) => signal.kind === 'carrier-loss' && signal.severity >= 3)
    .map((signal) => signal.label);
  return labels.length ? labels.join(' · ') : null;
}

export function nodeRootCause(node: OpsNodeView): NodeRootCause {
  if (node.qualityState === 'reported' && node.blockStatus === 'LIKELY_BLOCKED') return 'blocked';
  if (node.qualityState === 'reported' && (node.blockStatus === 'DOWN' || node.blockStatus === 'EDGE_FAIL' || node.ok === false)) {
    return 'offline';
  }
  if (node.agentState === 'unreported' && node.catalogState === 'known-listed') return 'noprobe';
  if (isMachinePressure(node)) return 'pressure';
  if (node.qualityState !== 'reported' || node.agentState === 'unavailable' || node.catalogState === 'unavailable') {
    return 'unknown';
  }
  return 'ok';
}

export type TelemetrySource = 'loading' | 'unavailable' | 'ready';
export type TelemetryState = 'loading' | 'unavailable' | 'unreported' | 'reported';

export type OpsPersonView = {
  userId: string;
  email: string;
  user: UserDto | null;
  activityOnly: boolean;
  latestActivity: ActivityUserDto | null;
  pathActivity: ActivityUserDto | null;
  telemetryState: TelemetryState;
  online: boolean;
  onlineDeviceCount: number;
  reportedDeviceCount: number;
  path: CustomerPathVerdict;
  selectedServer: string | null;
  nodeHealth: string | null;
  nodeHealthLabel: string | null;
  exitDelayMs: number | null;
  tcpDelayMs: number | null;
  exitDelayAtSec: number | null;
  tcpDelayAtSec: number | null;
  exitDelayFresh: boolean;
  tcpDelayFresh: boolean;
  lastSeenAt: number | null;
  quotaBytes: number | null;
  usageBytes: number;
  quotaRatio: number | null;
  quotaWarn: boolean;
  quotaOver: boolean;
  expiresAt: number | null;
  expired: boolean;
  expiring: boolean;
  catalogLag: CatalogLag;
  hasExitIdentity: boolean;
  hasHome: boolean;
  hasClaude: boolean;
  accountState: AccountState;
  chores: string[];
  /** @deprecated use latestActivity */
  activity: ActivityUserDto | null;
};

export type AccountState = 'loading' | 'unavailable' | 'present' | 'absent';

export function nodeDot(node: {
  blockStatus: string;
  ok: boolean | null;
  qualityState: QualityState;
  agentState: AgentState;
  signals: OpsSignal[];
}): NodeDot {
  if (node.qualityState === 'reported' && (
    node.blockStatus === 'LIKELY_BLOCKED' || node.blockStatus === 'DOWN' || node.blockStatus === 'EDGE_FAIL' || node.ok === false
  )) {
    return 'bad';
  }
  if (node.agentState === 'stale') return 'warn';
  if (node.agentState === 'unreported') return 'warn';
  if (node.signals.some((signal) => signal.severity >= 3)) return 'warn';
  if (node.qualityState !== 'reported' || node.agentState === 'unavailable') return 'unknown';
  if (node.ok === true || node.blockStatus === 'OK' || node.blockStatus === 'EDGE_OK') return 'ok';
  return 'unknown';
}

function ready(source?: SourceKind): boolean {
  return source === 'ready' || source === undefined;
}

export function assembleOpsNodes(input: {
  catalogYaml?: string | null;
  catalogSource?: SourceKind;
  qualityNodes?: LiveQualityNodeDto[] | null;
  qualitySource?: SourceKind;
  agents?: LiveAgentDto[] | null;
  agentSource?: SourceKind;
  profiles?: NodeProfileDto[] | null;
  profileSource?: SourceKind;
  activity?: ActivityUserDto[] | null;
  activitySource?: SourceKind;
  nowMs: number;
}): OpsNodeView[] {
  const names = new Set<string>();
  const catalogNames = ready(input.catalogSource) && input.catalogYaml != null
    ? catalogProxyNames(input.catalogYaml)
    : null;
  catalogNames?.forEach((name) => names.add(name));
  if (ready(input.qualitySource)) {
    for (const node of input.qualityNodes ?? []) names.add(node.name);
  }
  if (ready(input.agentSource)) {
    for (const agent of input.agents ?? []) names.add(agent.name);
  }
  if (ready(input.profileSource)) {
    for (const profile of input.profiles ?? []) {
      if (profile.status === 'retired') continue;
      names.add(profile.catalogName);
    }
  }
  if (ready(input.activitySource)) {
    for (const row of input.activity ?? []) {
      if (row.online && row.selectedServer) names.add(row.selectedServer);
    }
  }

  const qualityBy = new Map((ready(input.qualitySource) ? input.qualityNodes ?? [] : []).map((node) => [node.name, node]));
  const agentBy = new Map((ready(input.agentSource) ? input.agents ?? [] : []).map((agent) => [agent.name, agent]));
  const profileBy = new Map((ready(input.profileSource) ? input.profiles ?? [] : []).map((profile) => [profile.catalogName, profile]));

  const occupants = new Map<string, Map<string, string>>();
  const pathByNode = new Map<string, { worstExitMs: number | null; worstTcpMs: number | null; samples: number }>();
  const nowSec = Math.floor(input.nowMs / 1000);
  if (ready(input.activitySource)) {
    for (const row of input.activity ?? []) {
      if (!row.online || !row.selectedServer) continue;
      const bucket = occupants.get(row.selectedServer) ?? new Map();
      bucket.set(row.userId, row.email);
      occupants.set(row.selectedServer, bucket);
      const path = pathByNode.get(row.selectedServer) ?? { worstExitMs: null, worstTcpMs: null, samples: 0 };
      path.samples += 1;
      if (row.exitDelayMs != null && measurementFresh(row.exitDelayAtMs, row.lastSeenAt, nowSec)) {
        path.worstExitMs = Math.max(path.worstExitMs ?? 0, row.exitDelayMs);
      }
      if (row.tcpDelayMs != null && measurementFresh(row.tcpDelayAtMs, row.lastSeenAt, nowSec)) {
        path.worstTcpMs = Math.max(path.worstTcpMs ?? 0, row.tcpDelayMs);
      }
      pathByNode.set(row.selectedServer, path);
    }
  }

  const views: OpsNodeView[] = [...names].map((name) => {
    const quality = qualityBy.get(name) ?? null;
    const agent = agentBy.get(name) ?? null;
    const profile = profileBy.get(name) ?? null;
    const people = occupants.get(name);
    const occupantList = people
      ? [...people.entries()].map(([userId, email]) => ({ userId, email }))
      : [];
    const { accounting, assumed } = parseTrafficLimitType(agent?.trafficLimitType);
    const billing = mergedBilling(profile ?? undefined, agent ?? undefined);
    const signals: OpsSignal[] = agent
      ? [...machineSignals(agent, input.nowMs).signals, ...carrierLossSignals(agent.carriers)]
      : [];
    const catalogState: CatalogState = !ready(input.catalogSource)
      ? 'unavailable'
      : catalogNames?.includes(name) ? 'known-listed' : 'known-unlisted';
    const qualityState: QualityState = !ready(input.qualitySource)
      ? 'unavailable'
      : quality ? 'reported' : 'unmeasured';
    const agentState: AgentState = !ready(input.agentSource)
      ? 'unavailable'
      : !agent ? 'unreported'
        : signals.some((signal) => /失联|未更新|未上报/.test(signal.label)) ? 'stale'
          : 'reported';
    const occupancyState: OccupancyState = ready(input.activitySource) ? 'known' : 'unavailable';
    const billingState: 'known' | 'partial' | 'unavailable' = !ready(input.profileSource)
      ? (input.profileSource === 'unavailable'
        ? (agent?.expiredAt != null || agent?.price != null ? 'partial' : 'unavailable')
        : 'partial')
      : 'known';
    const status = quality ? blockStatus(quality) : 'UNPROBED';
    const blockLabelText = qualityState === 'unavailable'
      ? '质量源不可用'
      : qualityState === 'unmeasured'
        ? '大陆未测'
        : blockLabel(quality!);
    const node = {
      name,
      catalogListed: catalogState === 'known-listed' ? true : catalogState === 'known-unlisted' ? false : null,
      catalogState,
      quality,
      qualityState,
      agent,
      agentState,
      profile,
      occupancy: occupancyState === 'known' ? occupantList.length : null,
      occupancyState,
      occupants: occupancyState === 'known' ? occupantList : [],
      billing,
      trafficRemain: trafficRemaining(profile ?? undefined, agent ?? undefined),
      quotaAccounting: accounting,
      quotaAssumed: assumed,
      signals,
      ok: quality ? quality.ok : null,
      blockStatus: status,
      blockLabel: blockLabelText,
      routeKeywords: quality?.routeKeywords.filter((keyword) => !['联通', '电信', '移动'].includes(keyword)) ?? [],
      pathSummary: occupancyState === 'known' ? (pathByNode.get(name) ?? { worstExitMs: null, worstTcpMs: null, samples: 0 }) : null,
      billingState,
      dot: 'unknown' as NodeDot,
    };
    node.dot = nodeDot(node);
    return node;
  });
  return views;
}

export const MONITOR_FOCUS = [
  'needs', 'loss', 'blocked', 'offline', 'pressure', 'expiring', 'unfilled-renew', 'noprobe', 'unknown',
] as const;
export type MonitorFocus = typeof MONITOR_FOCUS[number];

export function isMonitorFocus(value: string | null | undefined): value is MonitorFocus {
  return MONITOR_FOCUS.includes(value as MonitorFocus);
}

export function nodeMatchesFocus(node: OpsNodeView, focus: string | null, nowSec: number): boolean {
  if (!focus) return true;
  const cause = nodeRootCause(node);
  if (focus === 'blocked') return cause === 'blocked';
  if (focus === 'offline') return cause === 'offline';
  if (focus === 'noprobe') return cause === 'noprobe';
  if (focus === 'pressure') return cause === 'pressure';
  if (focus === 'loss') return hasBadCarrierLoss(node);
  if (focus === 'expiring') {
    return Boolean(node.billing.renewsAt && node.billing.renewsAt - nowSec <= 7 * 86_400 && node.billing.renewsAt - nowSec >= 0);
  }
  if (focus === 'unfilled-renew') return node.billing.renewsAt == null;
  if (focus === 'unknown') {
    return node.qualityState !== 'reported' || node.agentState === 'unavailable' || node.catalogState === 'unavailable';
  }
  if (focus === 'needs') {
    return nodeMatchesFocus(node, 'blocked', nowSec)
      || nodeMatchesFocus(node, 'offline', nowSec)
      || nodeMatchesFocus(node, 'noprobe', nowSec)
      || nodeMatchesFocus(node, 'pressure', nowSec)
      || hasBadCarrierLoss(node)
      || (node.qualityState === 'reported' && node.quality?.quality === 'poor');
  }
  return true;
}

export function nodeSearchHaystack(node: OpsNodeView): string {
  return [
    node.name,
    node.quality?.host,
    node.quality?.publicIp,
    node.profile?.publicIp,
    node.profile?.provider,
    node.agent?.os,
    ...node.routeKeywords,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function sortOpsNodes(nodes: OpsNodeView[]): OpsNodeView[] {
  const rank = (node: OpsNodeView) => {
    if (node.qualityState === 'reported' && node.blockStatus === 'LIKELY_BLOCKED') return 0;
    if (node.qualityState === 'reported' && (node.blockStatus === 'DOWN' || node.blockStatus === 'EDGE_FAIL' || node.ok === false)) return 1;
    if (node.agentState === 'unreported' && node.catalogState === 'known-listed') return 2;
    if (isMachinePressure(node) || hasBadCarrierLoss(node)) return 3;
    if (node.quality?.quality === 'poor') return 4;
    return 5;
  };
  return [...nodes].sort((a, b) => {
    const delta = rank(a) - rank(b);
    if (delta !== 0) return delta;
    if (Number(b.catalogListed === true) !== Number(a.catalogListed === true)) {
      return Number(b.catalogListed === true) - Number(a.catalogListed === true);
    }
    const occ = (b.occupancy ?? -1) - (a.occupancy ?? -1);
    if (occ !== 0) return occ;
    return a.name.localeCompare(b.name, 'zh');
  });
}

export function assembleOpsPeople(input: {
  users?: UserDto[] | null;
  usersSource?: SourceKind;
  activity?: ActivityUserDto[] | null;
  telemetrySource: TelemetrySource;
  catalogRevision?: number | null;
  nowSec: number;
}): OpsPersonView[] {
  const activityByUser = new Map<string, ActivityUserDto[]>();
  if (input.telemetrySource === 'ready') {
    for (const row of input.activity ?? []) {
      const list = activityByUser.get(row.userId) ?? [];
      list.push(row);
      activityByUser.set(row.userId, list);
    }
  }

  const usersReady = ready(input.usersSource);
  const ids = new Set<string>();
  if (usersReady) {
    for (const user of input.users ?? []) ids.add(user.id);
  }
  if (input.telemetrySource === 'ready') {
    for (const userId of activityByUser.keys()) ids.add(userId);
  }

  const userBy = new Map((usersReady ? input.users ?? [] : []).map((user) => [user.id, user]));

  return [...ids].map((userId) => {
    const user = userBy.get(userId) ?? null;
    const rows = activityByUser.get(userId) ?? [];
    const latest = rows.length ? rows.reduce((best, row) => (row.lastSeenAt > best.lastSeenAt ? row : best)) : null;
    const pathSource = pickWorstActivity(rows, input.nowSec);
    const telemetryState: TelemetryState = input.telemetrySource === 'loading'
      ? 'loading'
      : input.telemetrySource === 'unavailable'
        ? 'unavailable'
        : latest ? 'reported' : 'unreported';
    const onlineRows = rows.filter((row) => row.online);
    const path = telemetryState === 'reported'
      ? customerPathVerdict({
        lastSeenAt: pathSource?.lastSeenAt,
        online: pathSource?.online,
        nodeHealth: pathSource?.nodeHealth,
        exitDelayMs: pathSource?.exitDelayMs,
        tcpDelayMs: pathSource?.tcpDelayMs,
        exitDelayAtMs: pathSource?.exitDelayAtMs,
        tcpDelayAtMs: pathSource?.tcpDelayAtMs,
        nowSec: input.nowSec,
      })
      : { kind: 'offline' as const };
    const exitDelayFresh = Boolean(
      pathSource?.exitDelayMs != null
      && measurementFresh(pathSource.exitDelayAtMs, pathSource.lastSeenAt, input.nowSec),
    );
    const tcpDelayFresh = Boolean(
      pathSource?.tcpDelayMs != null
      && measurementFresh(pathSource.tcpDelayAtMs, pathSource.lastSeenAt, input.nowSec),
    );
    const quotaBytes = user?.quotaBytes ?? null;
    const usageBytes = user?.usageBytes ?? 0;
    const quotaRatio = quotaBytes != null && quotaBytes > 0 ? usageBytes / quotaBytes : null;
    const expiresAt = user?.expiresAt ?? null;
    const days = expiresAt == null ? null : (expiresAt - input.nowSec) / 86_400;
    const lag = catalogLag(latest?.catalogRevision, input.catalogRevision ?? null);
    const hasExitIdentity = Boolean(user?.hasExitIdentity);
    const hasHome = Boolean(user?.homeBinding);
    const hasClaude = Boolean(user && !user.product?.incomplete && user.product?.accountRef);
    const accountState: AccountState = !usersReady
      ? (input.usersSource === 'unavailable' ? 'unavailable' : 'loading')
      : user ? 'present' : 'absent';
    const chores: string[] = [];
    if (accountState === 'present' && user && !hasExitIdentity) chores.push('没凭证');
    if (accountState === 'present' && user?.product?.incomplete) chores.push('没开 Claude');
    if (accountState === 'present' && user && !hasHome) chores.push('家宽');
    return {
      userId,
      email: user?.email ?? latest?.email ?? userId,
      user,
      activityOnly: user == null,
      latestActivity: latest,
      pathActivity: pathSource,
      telemetryState,
      online: telemetryState === 'reported' && onlineRows.length > 0,
      onlineDeviceCount: new Set(onlineRows.map((row) => row.deviceId).filter(Boolean)).size || onlineRows.length,
      reportedDeviceCount: new Set(rows.map((row) => row.deviceId).filter(Boolean)).size || rows.length,
      path,
      selectedServer: pathSource?.selectedServer ?? null,
      nodeHealth: pathSource?.nodeHealth ?? null,
      nodeHealthLabel: pathSource?.nodeHealthLabel ?? null,
      exitDelayMs: pathSource?.exitDelayMs ?? null,
      tcpDelayMs: pathSource?.tcpDelayMs ?? null,
      exitDelayAtSec: msEpochToSec(pathSource?.exitDelayAtMs),
      tcpDelayAtSec: msEpochToSec(pathSource?.tcpDelayAtMs),
      exitDelayFresh,
      tcpDelayFresh,
      lastSeenAt: latest?.lastSeenAt ?? null,
      quotaBytes,
      usageBytes,
      quotaRatio,
      quotaWarn: quotaRatio != null && quotaRatio >= 0.8 && quotaRatio < 1,
      quotaOver: quotaRatio != null && quotaRatio >= 1,
      expiresAt,
      expired: days != null && days < 0,
      expiring: days != null && days >= 0 && days <= 7,
      catalogLag: lag,
      hasExitIdentity,
      hasHome,
      hasClaude,
      accountState,
      chores,
      activity: latest,
    };
  }).sort((a, b) => Number(b.online) - Number(a.online) || a.email.localeCompare(b.email, 'zh'));
}

export const PERSON_FOCUS = [
  'quota', 'expiring', 'expired', 'claude', 'home', 'online', 'path', 'unmeasured',
  'credential', 'catalog', 'catalog-unreported',
] as const;

export type PersonFocus = typeof PERSON_FOCUS[number];

export function isPersonFocus(value: string | null | undefined): value is PersonFocus {
  return PERSON_FOCUS.includes(value as PersonFocus);
}

export function catalogBehindLive(person: OpsPersonView): boolean {
  return person.catalogLag.state === 'behind'
    && person.online
    && person.accountState === 'present'
    && person.user?.status === 'active';
}

export function personMatchesFocus(person: OpsPersonView, focus: string | null): boolean {
  if (!focus || focus === 'homes') return true;
  if (focus === 'quota') return person.quotaWarn || person.quotaOver;
  if (focus === 'expiring') return person.expiring;
  if (focus === 'expired') return person.expired;
  if (focus === 'claude') return Boolean(person.user?.product?.incomplete);
  if (focus === 'home') return Boolean(person.user && !person.hasHome);
  if (focus === 'online') return person.online;
  if (focus === 'path') return person.path.kind === 'incident';
  if (focus === 'unmeasured') return person.online && person.path.kind === 'unmeasured';
  if (focus === 'catalog') return catalogBehindLive(person);
  if (focus === 'catalog-unreported') return person.catalogLag.state === 'unreported' && person.online;
  if (focus === 'credential') return Boolean(person.user && !person.hasExitIdentity);
  return true;
}
