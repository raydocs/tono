import type { ActivityUserDto } from '../api';
import type { OpsNodeView, OpsPersonView } from './ops-views';
import { isLikelyBlocked } from './quality';
import { msEpochToSec } from './time';

export const HEARTBEAT_FRESH_SECONDS = 40 * 60;
export const PATH_WARN_MS = 400;
export const PATH_SEVERE_MS = 800;

export type IncidentSeverity = 'severe' | 'warn' | 'notice' | 'info';
export type IncidentCategory = 'node' | 'customer-path' | 'chore';
export type IncidentKind =
  | 'node-blocked'
  | 'node-down'
  | 'node-pressure'
  | 'node-no-probe'
  | 'customer-path-node'
  | 'customer-path-exit'
  | 'customer-path-tcp'
  | 'node-renew'
  | 'quota'
  | 'expired'
  | 'catalog-lag'
  | 'claude'
  | 'home';
export type IncidentSourceState = 'ready' | 'unavailable' | 'unmeasured';

export type OpsIncident = {
  id: string;
  kind: IncidentKind;
  category: IncidentCategory;
  severity: IncidentSeverity;
  title: string;
  detail: string;
  actionRoute: string;
  href: string;
  node?: string;
  userId?: string;
  impactCount: number;
  measuredAtSec: number | null;
  measuredAt?: number | null;
  sourceState: IncidentSourceState;
  /** When set, this customer path issue is already represented by a node accident. */
  causedByNode?: string;
};

export const KPI_HREFS = {
  blocked: '#/monitor?focus=blocked',
  offline: '#/monitor?focus=offline',
  path: '#/failures?focus=customer-path',
  online: '#/users?focus=online',
  quota: '#/users?focus=quota',
  expiring: '#/monitor?focus=expiring',
} as const;

export type CustomerPathVerdict =
  | { kind: 'offline' }
  | { kind: 'stale'; lastSeenAt: number }
  | { kind: 'unmeasured' }
  | { kind: 'ok' }
  | { kind: 'incident'; severity: 'severe' | 'warn'; reason: string; measuredAt: number | null; metric: 'node' | 'exit' | 'tcp' };

export function customerPathVerdict(input: {
  lastSeenAt: number | null | undefined;
  online?: boolean;
  nodeHealth: string | null | undefined;
  exitDelayMs: number | null | undefined;
  tcpDelayMs: number | null | undefined;
  exitDelayAtMs?: number | null;
  tcpDelayAtMs?: number | null;
  nowSec: number;
}): CustomerPathVerdict {
  const lastSeen = input.lastSeenAt ?? null;
  if (lastSeen == null) return { kind: 'offline' };
  const age = input.nowSec - lastSeen;
  if (age > HEARTBEAT_FRESH_SECONDS) return { kind: 'stale', lastSeenAt: lastSeen };
  if (input.online === false) return { kind: 'offline' };

  if (input.nodeHealth === 'blocked' || input.nodeHealth === 'down') {
    return {
      kind: 'incident',
      severity: 'severe',
      reason: input.nodeHealth === 'blocked' ? '所选节点疑似被墙' : '所选节点整机失联',
      measuredAt: lastSeen,
      metric: 'node',
    };
  }

  const delays: Array<{ ms: number; label: string; atSec: number | null }> = [];
  if (input.exitDelayMs != null) {
    delays.push({ ms: input.exitDelayMs, label: '出口', atSec: msEpochToSec(input.exitDelayAtMs) });
  }
  if (input.tcpDelayMs != null) {
    delays.push({ ms: input.tcpDelayMs, label: 'TCP', atSec: msEpochToSec(input.tcpDelayAtMs) });
  }
  if (delays.length === 0) return { kind: 'unmeasured' };

  const worst = delays.reduce((a, b) => (b.ms > a.ms ? b : a));
  const measuredAt = worst.atSec ?? lastSeen;
  const metric = worst.label === 'TCP' ? 'tcp' as const : 'exit' as const;
  if (worst.ms >= PATH_SEVERE_MS) {
    return { kind: 'incident', severity: 'severe', reason: `${worst.label} ${worst.ms}ms`, measuredAt, metric };
  }
  if (worst.ms >= PATH_WARN_MS) {
    return { kind: 'incident', severity: 'warn', reason: `${worst.label} ${worst.ms}ms`, measuredAt, metric };
  }
  return { kind: 'ok' };
}

function pathRank(verdict: CustomerPathVerdict): number {
  if (verdict.kind === 'incident' && verdict.severity === 'severe') return 0;
  if (verdict.kind === 'incident' && verdict.severity === 'warn') return 1;
  if (verdict.kind === 'unmeasured') return 3;
  if (verdict.kind === 'ok') return 4;
  return 5;
}

function verdictForRow(row: ActivityUserDto, nowSec: number): CustomerPathVerdict {
  return customerPathVerdict({
    lastSeenAt: row.lastSeenAt,
    online: row.online,
    nodeHealth: row.nodeHealth,
    exitDelayMs: row.exitDelayMs,
    tcpDelayMs: row.tcpDelayMs,
    exitDelayAtMs: row.exitDelayAtMs,
    tcpDelayAtMs: row.tcpDelayAtMs,
    nowSec,
  });
}

function nodeHealthRank(value: string | null | undefined): number {
  if (value === 'down' || value === 'blocked') return 0;
  if (value === 'ok') return 3;
  return 2;
}

function worstDelayMs(row: ActivityUserDto): number {
  return Math.max(row.exitDelayMs ?? -1, row.tcpDelayMs ?? -1);
}

/** Negative if `a` is the worse (preferred) path sample. */
export function comparePathActivity(a: ActivityUserDto, b: ActivityUserDto, nowSec: number): number {
  const rankDelta = pathRank(verdictForRow(a, nowSec)) - pathRank(verdictForRow(b, nowSec));
  if (rankDelta !== 0) return rankDelta;
  const healthDelta = nodeHealthRank(a.nodeHealth) - nodeHealthRank(b.nodeHealth);
  if (healthDelta !== 0) return healthDelta;
  const delayDelta = worstDelayMs(b) - worstDelayMs(a);
  if (delayDelta !== 0) return delayDelta;
  return b.lastSeenAt - a.lastSeenAt;
}

/** Among online devices, the worst path; if nobody is online, the newest row. */
export function pickWorstActivity(rows: ActivityUserDto[], nowSec: number): ActivityUserDto | null {
  if (rows.length === 0) return null;
  const online = rows.filter((row) => row.online);
  if (online.length === 0) {
    return rows.reduce((best, row) => (row.lastSeenAt > best.lastSeenAt ? row : best));
  }
  return online.reduce((best, row) => (comparePathActivity(row, best, nowSec) < 0 ? row : best));
}

function nodeOffline(node: OpsNodeView): boolean {
  const status = node.blockStatus;
  return status === 'DOWN' || status === 'EDGE_FAIL' || node.ok === false;
}

function incident(
  partial: Omit<OpsIncident, 'href' | 'measuredAt'> & { actionRoute: string },
): OpsIncident {
  return {
    ...partial,
    href: partial.actionRoute,
    measuredAt: partial.measuredAtSec,
  };
}

export function incidentsFromWorld(input: {
  nodes: OpsNodeView[];
  people: OpsPersonView[];
  catalogRevision: number | null;
  nowSec: number;
}): OpsIncident[] {
  const incidents: OpsIncident[] = [];

  for (const node of input.nodes) {
    const listed = node.catalogListed === true;
    const occupied = node.occupancyState === 'known' && (node.occupancy ?? 0) > 0;
    const affecting = occupied || listed;
    const impact = node.occupancyState === 'known' ? (node.occupancy ?? 0) : 0;
    const measured = node.agent?.observedAt ?? null;

    if (node.quality && isLikelyBlocked(node.quality)) {
      incidents.push(incident({
        id: `node-block:${node.name}`,
        kind: 'node-blocked',
        category: 'node',
        severity: 'severe',
        title: node.name,
        detail: listed ? '疑似被墙，仍在客户目录' : '疑似被墙',
        actionRoute: `#/monitor?focus=blocked&node=${encodeURIComponent(node.name)}`,
        node: node.name,
        impactCount: impact,
        measuredAtSec: measured,
        sourceState: 'ready',
      }));
    } else if (node.quality && nodeOffline(node) && affecting) {
      incidents.push(incident({
        id: `node-down:${node.name}`,
        kind: 'node-down',
        category: 'node',
        severity: 'severe',
        title: node.name,
        detail: occupied
          ? `整机失联，${node.occupancy} 人在用`
          : '整机失联，仍在客户目录',
        actionRoute: `#/monitor?focus=offline&node=${encodeURIComponent(node.name)}`,
        node: node.name,
        impactCount: impact,
        measuredAtSec: measured,
        sourceState: 'ready',
      }));
    } else if (node.quality && nodeOffline(node)) {
      incidents.push(incident({
        id: `node-down-idle:${node.name}`,
        kind: 'node-down',
        category: 'node',
        severity: 'warn',
        title: node.name,
        detail: '整机失联（未在售、无人在用）',
        actionRoute: `#/monitor?focus=offline&node=${encodeURIComponent(node.name)}`,
        node: node.name,
        impactCount: 0,
        measuredAtSec: measured,
        sourceState: 'ready',
      }));
    }

    if (listed && node.agentState === 'unreported') {
      incidents.push(incident({
        id: `node-noprobe:${node.name}`,
        kind: 'node-no-probe',
        category: 'node',
        severity: 'warn',
        title: node.name,
        detail: '在售但没有探针',
        actionRoute: `#/monitor?focus=noprobe&node=${encodeURIComponent(node.name)}`,
        node: node.name,
        impactCount: impact,
        measuredAtSec: null,
        sourceState: 'ready',
      }));
    }

    const load = node.signals.find((signal) => signal.severity >= 3);
    if (load) {
      incidents.push(incident({
        id: `node-pressure:${node.name}:${load.label}`,
        kind: 'node-pressure',
        category: 'node',
        severity: 'warn',
        title: node.name,
        detail: load.label,
        actionRoute: `#/monitor?focus=pressure&node=${encodeURIComponent(node.name)}`,
        node: node.name,
        impactCount: impact,
        measuredAtSec: measured,
        sourceState: 'ready',
      }));
    }

    if (node.billing.renewsAt) {
      const days = (node.billing.renewsAt - input.nowSec) / 86_400;
      if (days >= 0 && days <= 7) {
        incidents.push(incident({
          id: `node-renew:${node.name}`,
          kind: 'node-renew',
          category: 'chore',
          severity: 'notice',
          title: node.name,
          detail: `${Math.ceil(days)} 天后续费`,
          actionRoute: `#/monitor?focus=expiring&node=${encodeURIComponent(node.name)}`,
          node: node.name,
          impactCount: impact,
          measuredAtSec: node.billing.renewsAt,
          sourceState: 'ready',
        }));
      }
    }
  }

  const nodeAccidents = new Set(
    incidents.filter((item) => item.category === 'node' && item.severity === 'severe').map((item) => item.node as string),
  );

  const seenUsers = new Set<string>();
  for (const person of input.people) {
    if (seenUsers.has(person.userId)) continue;
    seenUsers.add(person.userId);
    const path = person.path;
    if (path.kind === 'incident') {
      const causedByNode = person.selectedServer && nodeAccidents.has(person.selectedServer)
        ? person.selectedServer
        : undefined;
      if (causedByNode) continue;
      const kind: IncidentKind = path.metric === 'tcp'
        ? 'customer-path-tcp'
        : path.metric === 'node'
          ? 'customer-path-node'
          : 'customer-path-exit';
      incidents.push(incident({
        id: `path:${person.userId}`,
        kind,
        category: 'customer-path',
        severity: path.severity,
        title: person.email,
        detail: path.reason,
        actionRoute: `#/users?focus=path&user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
        node: person.selectedServer ?? undefined,
        impactCount: person.reportedDeviceCount || 1,
        measuredAtSec: path.measuredAt,
        sourceState: 'ready',
      }));
    }

    const user = person.user;
    if (user?.status === 'active' && user.quotaBytes && user.usageBytes / user.quotaBytes >= 0.8) {
      const over = user.usageBytes >= user.quotaBytes;
      incidents.push(incident({
        id: `quota:${person.userId}`,
        kind: 'quota',
        category: 'chore',
        severity: over ? 'warn' : 'notice',
        title: person.email,
        detail: over ? '流量已超' : `流量用了 ${Math.round((user.usageBytes / user.quotaBytes) * 100)}%`,
        actionRoute: `#/users?focus=quota&user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
        impactCount: 1,
        measuredAtSec: null,
        sourceState: 'ready',
      }));
    }
    if (user?.status === 'active' && user.expiresAt) {
      const days = (user.expiresAt - input.nowSec) / 86_400;
      if (days < 0) {
        incidents.push(incident({
          id: `expired:${person.userId}`,
          kind: 'expired',
          category: 'chore',
          severity: 'warn',
          title: person.email,
          detail: '已经过期',
          actionRoute: `#/users?focus=expired&user=${encodeURIComponent(person.userId)}`,
          userId: person.userId,
          impactCount: 1,
          measuredAtSec: user.expiresAt,
          sourceState: 'ready',
        }));
      } else if (days <= 7) {
        incidents.push(incident({
          id: `expiring:${person.userId}`,
          kind: 'expired',
          category: 'chore',
          severity: 'notice',
          title: person.email,
          detail: `${Math.ceil(days)} 天后到期`,
          actionRoute: `#/users?focus=expiring&user=${encodeURIComponent(person.userId)}`,
          userId: person.userId,
          impactCount: 1,
          measuredAtSec: user.expiresAt,
          sourceState: 'ready',
        }));
      }
    }
    if (person.catalogLag.state === 'behind') {
      incidents.push(incident({
        id: `catalog-lag:${person.userId}`,
        kind: 'catalog-lag',
        category: 'chore',
        severity: 'notice',
        title: person.email,
        detail: `目录落后 ${person.catalogLag.by} 版`,
        actionRoute: `#/users?user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
        impactCount: 1,
        measuredAtSec: null,
        sourceState: 'ready',
      }));
    }
    if (user?.status === 'active' && user.product?.incomplete) {
      incidents.push(incident({
        id: `claude:${person.userId}`,
        kind: 'claude',
        category: 'chore',
        severity: 'info',
        title: person.email,
        detail: '还没开 Claude',
        actionRoute: `#/users?focus=claude&user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
        impactCount: 1,
        measuredAtSec: null,
        sourceState: 'ready',
      }));
    }
    if (user?.status === 'active' && !user.homeBinding) {
      incidents.push(incident({
        id: `home:${person.userId}`,
        kind: 'home',
        category: 'chore',
        severity: 'info',
        title: person.email,
        detail: '还没绑家宽',
        actionRoute: `#/users?focus=home&user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
        impactCount: 1,
        measuredAtSec: null,
        sourceState: 'ready',
      }));
    }
  }

  return sortIncidents(incidents);
}

export function sortIncidents(incidents: OpsIncident[]): OpsIncident[] {
  const rank: Record<IncidentSeverity, number> = { severe: 0, warn: 1, notice: 2, info: 3 };
  return [...incidents].sort((a, b) => {
    const severity = rank[a.severity] - rank[b.severity];
    if (severity !== 0) return severity;
    const impact = b.impactCount - a.impactCount;
    if (impact !== 0) return impact;
    const measured = (b.measuredAtSec ?? -1) - (a.measuredAtSec ?? -1);
    if (measured !== 0) return measured;
    return a.title.localeCompare(b.title, 'zh');
  });
}

export function accidentsOnly(incidents: OpsIncident[]): OpsIncident[] {
  return incidents.filter((item) =>
    (item.severity === 'severe' || item.severity === 'warn')
    && (item.category === 'node' || item.category === 'customer-path'),
  );
}

export function choresOnly(incidents: OpsIncident[]): OpsIncident[] {
  return incidents.filter((item) => item.category === 'chore');
}

export type DashboardKpi = {
  id: keyof typeof KPI_HREFS;
  label: string;
  value: number | null;
  href: string;
  alert: boolean;
};

export function dashboardKpis(input: {
  nodes: OpsNodeView[];
  people: OpsPersonView[];
  incidents: OpsIncident[];
  qualityAvailable: boolean;
  activityAvailable: boolean;
  usersAvailable: boolean;
  nowSec: number;
}): DashboardKpi[] {
  const blocked = input.qualityAvailable
    ? input.nodes.filter((node) => node.qualityState === 'reported' && node.blockStatus === 'LIKELY_BLOCKED').length
    : null;
  const offline = input.qualityAvailable
    ? input.nodes.filter((node) => node.qualityState === 'reported' && (node.blockStatus === 'DOWN' || node.blockStatus === 'EDGE_FAIL' || node.ok === false)).length
    : null;
  const path = input.activityAvailable
    ? input.incidents.filter((item) => item.category === 'customer-path').length
    : null;
  const online = input.activityAvailable
    ? input.people.filter((person) => person.online).length
    : null;
  const quota = input.usersAvailable
    ? input.people.filter((person) => person.quotaWarn || person.quotaOver).length
    : null;
  const expiring = input.nodes.filter((node) => (
    node.billing.renewsAt != null
    && node.billing.renewsAt - input.nowSec <= 7 * 86_400
    && node.billing.renewsAt - input.nowSec >= 0
  )).length;
  return [
    { id: 'blocked', label: '被墙', value: blocked, href: KPI_HREFS.blocked, alert: (blocked ?? 0) > 0 },
    { id: 'offline', label: '失联', value: offline, href: KPI_HREFS.offline, alert: (offline ?? 0) > 0 },
    { id: 'path', label: '客户路径差', value: path, href: KPI_HREFS.path, alert: (path ?? 0) > 0 },
    { id: 'online', label: '在线客户', value: online, href: KPI_HREFS.online, alert: false },
    { id: 'quota', label: '额度告急', value: quota, href: KPI_HREFS.quota, alert: (quota ?? 0) > 0 },
    { id: 'expiring', label: '7 天续费', value: expiring, href: KPI_HREFS.expiring, alert: expiring > 0 },
  ];
}
