import type {
  ActivityUserDto,
  LiveAgentDto,
  LiveQualityNodeDto,
  NodeProfileDto,
  UserDto,
} from '../api';
import { catalogProxyNames } from './catalog';
import { customerPathVerdict, pickWorstActivity, type CustomerPathVerdict } from './incidents';
import { machineSignals, mergedBilling, trafficRemaining, type BillingView } from './machine';
import { catalogLag, type CatalogLag } from './revision';
import { blockLabel, blockStatus } from './quality';
import { msEpochToSec } from './time';
import { parseTrafficLimitType, type TrafficAccounting } from './traffic';

export type NodeDot = 'ok' | 'warn' | 'bad' | 'unknown';

export type OpsNodeView = {
  name: string;
  catalogListed: boolean | null;
  quality: LiveQualityNodeDto | null;
  agent: LiveAgentDto | null;
  profile: NodeProfileDto | null;
  occupancy: number;
  occupants: Array<{ userId: string; email: string }>;
  billing: BillingView;
  trafficRemain: number | null;
  quotaAccounting: TrafficAccounting;
  quotaAssumed: boolean;
  signals: { label: string; severity: number }[];
  ok: boolean | null;
  blockStatus: string;
  blockLabel: string;
  /** Composite presentation: mainland quality AND agent freshness. */
  dot: NodeDot;
};

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
  chores: string[];
  /** @deprecated use latestActivity */
  activity: ActivityUserDto | null;
};

export function nodeDot(
  block: string,
  ok: boolean | null,
  signals: { label: string; severity: number }[],
  hasAgent: boolean,
): NodeDot {
  if (block === 'LIKELY_BLOCKED' || block === 'DOWN' || block === 'EDGE_FAIL' || ok === false) {
    return 'bad';
  }
  if (!hasAgent) return 'warn';
  if (signals.some((signal) => /失联|未更新|未上报/.test(signal.label))) return 'warn';
  if (signals.some((signal) => signal.severity >= 3)) return 'warn';
  if (block === 'UNPROBED' || block === 'PROBE_PARTIAL' || block === 'CHECK_FAILED') return 'unknown';
  if (ok === true || block === 'OK' || block === 'EDGE_OK') return 'ok';
  return 'unknown';
}

export function assembleOpsNodes(input: {
  catalogYaml?: string | null;
  qualityNodes?: LiveQualityNodeDto[] | null;
  agents?: LiveAgentDto[] | null;
  profiles?: NodeProfileDto[] | null;
  activity?: ActivityUserDto[] | null;
  nowMs: number;
}): OpsNodeView[] {
  const names = new Set<string>();
  const catalogNames = input.catalogYaml != null ? catalogProxyNames(input.catalogYaml) : null;
  catalogNames?.forEach((name) => names.add(name));
  for (const node of input.qualityNodes ?? []) names.add(node.name);
  for (const agent of input.agents ?? []) names.add(agent.name);
  for (const profile of input.profiles ?? []) {
    if (profile.status === 'retired') continue;
    names.add(profile.catalogName);
  }
  for (const row of input.activity ?? []) {
    if (row.online && row.selectedServer) names.add(row.selectedServer);
  }

  const qualityBy = new Map((input.qualityNodes ?? []).map((node) => [node.name, node]));
  const agentBy = new Map((input.agents ?? []).map((agent) => [agent.name, agent]));
  const profileBy = new Map((input.profiles ?? []).map((profile) => [profile.catalogName, profile]));

  const occupants = new Map<string, Map<string, string>>();
  for (const row of input.activity ?? []) {
    if (!row.online || !row.selectedServer) continue;
    const bucket = occupants.get(row.selectedServer) ?? new Map();
    bucket.set(row.userId, row.email);
    occupants.set(row.selectedServer, bucket);
  }

  const views: OpsNodeView[] = [...names].sort((a, b) => a.localeCompare(b, 'zh')).map((name) => {
    const quality = qualityBy.get(name) ?? null;
    const agent = agentBy.get(name) ?? null;
    const profile = profileBy.get(name) ?? null;
    const people = occupants.get(name);
    const occupantList = people
      ? [...people.entries()].map(([userId, email]) => ({ userId, email }))
      : [];
    const { accounting, assumed } = parseTrafficLimitType(agent?.trafficLimitType);
    const billing = mergedBilling(profile ?? undefined, agent ?? undefined);
    const signals = agent ? machineSignals(agent, input.nowMs).signals : [];
    const status = quality ? blockStatus(quality) : 'UNPROBED';
    return {
      name,
      catalogListed: catalogNames ? catalogNames.includes(name) : null,
      quality,
      agent,
      profile,
      occupancy: occupantList.length,
      occupants: occupantList,
      billing,
      trafficRemain: trafficRemaining(profile ?? undefined, agent ?? undefined),
      quotaAccounting: accounting,
      quotaAssumed: assumed,
      signals,
      ok: quality ? quality.ok : null,
      blockStatus: status,
      blockLabel: quality ? blockLabel(quality) : '大陆未测',
      dot: nodeDot(status, quality?.ok ?? null, signals, Boolean(agent)),
    };
  });
  return views;
}

export function assembleOpsPeople(input: {
  users?: UserDto[] | null;
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

  const ids = new Set<string>();
  for (const user of input.users ?? []) ids.add(user.id);
  if (input.telemetrySource === 'ready') {
    for (const userId of activityByUser.keys()) ids.add(userId);
  }

  const userBy = new Map((input.users ?? []).map((user) => [user.id, user]));

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
    const quotaBytes = user?.quotaBytes ?? null;
    const usageBytes = user?.usageBytes ?? 0;
    const quotaRatio = quotaBytes != null && quotaBytes > 0 ? usageBytes / quotaBytes : null;
    const expiresAt = user?.expiresAt ?? null;
    const days = expiresAt == null ? null : (expiresAt - input.nowSec) / 86_400;
    const lag = catalogLag(latest?.catalogRevision, input.catalogRevision ?? null);
    const hasExitIdentity = Boolean(user?.hasExitIdentity);
    const hasHome = Boolean(user?.homeBinding);
    const hasClaude = Boolean(user && !user.product?.incomplete && user.product?.accountRef);
    const chores: string[] = [];
    if (user && !hasExitIdentity) chores.push('没凭证');
    if (user?.product?.incomplete) chores.push('Claude');
    if (user && !hasHome) chores.push('家宽');
    if (lag.state === 'behind') chores.push(`目录落后 ${lag.by}`);
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
      chores,
      activity: latest,
    };
  }).sort((a, b) => Number(b.online) - Number(a.online) || a.email.localeCompare(b.email, 'zh'));
}

export const PERSON_FOCUS = [
  'quota', 'expiring', 'expired', 'claude', 'home', 'online', 'path', 'credential',
] as const;

export type PersonFocus = typeof PERSON_FOCUS[number];

export function isPersonFocus(value: string | null | undefined): value is PersonFocus {
  return PERSON_FOCUS.includes(value as PersonFocus);
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
  if (focus === 'credential') return Boolean(person.user && !person.hasExitIdentity);
  return true;
}
