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
import { blockLabel, blockStatus } from './quality';
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

export type OpsPersonView = {
  userId: string;
  email: string;
  user: UserDto | null;
  activity: ActivityUserDto | null;
  online: boolean;
  deviceCount: number;
  path: CustomerPathVerdict;
  selectedServer: string | null;
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
  nowSec: number;
}): OpsPersonView[] {
  const activityByUser = new Map<string, ActivityUserDto[]>();
  for (const row of input.activity ?? []) {
    const list = activityByUser.get(row.userId) ?? [];
    list.push(row);
    activityByUser.set(row.userId, list);
  }

  const ids = new Set<string>();
  for (const user of input.users ?? []) ids.add(user.id);
  for (const userId of activityByUser.keys()) ids.add(userId);

  const userBy = new Map((input.users ?? []).map((user) => [user.id, user]));

  return [...ids].map((userId) => {
    const user = userBy.get(userId) ?? null;
    const rows = activityByUser.get(userId) ?? [];
    const latest = [...rows].sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null;
    const online = rows.some((row) => row.online);
    const pathSource = pickWorstActivity(rows, input.nowSec) ?? latest;
    const path = customerPathVerdict({
      lastSeenAt: pathSource?.lastSeenAt,
      online: pathSource?.online,
      nodeHealth: pathSource?.nodeHealth,
      exitDelayMs: pathSource?.exitDelayMs,
      tcpDelayMs: pathSource?.tcpDelayMs,
      exitDelayAtMs: pathSource?.exitDelayAtMs,
      tcpDelayAtMs: pathSource?.tcpDelayAtMs,
      nowSec: input.nowSec,
    });
    return {
      userId,
      email: user?.email ?? latest?.email ?? userId,
      user,
      activity: latest,
      online,
      deviceCount: new Set(rows.map((row) => row.deviceId).filter(Boolean)).size || rows.length,
      path,
      selectedServer: pathSource?.selectedServer ?? null,
    };
  }).sort((a, b) => Number(b.online) - Number(a.online) || a.email.localeCompare(b.email, 'zh'));
}
