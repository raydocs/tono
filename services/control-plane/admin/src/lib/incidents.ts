import type { ActivityUserDto } from '../api';
import type { OpsNodeView, OpsPersonView } from './ops-views';
import { isLikelyBlocked } from './quality';

export const HEARTBEAT_FRESH_SECONDS = 40 * 60;
export const PATH_WARN_MS = 400;
export const PATH_SEVERE_MS = 800;

export type IncidentSeverity = 'severe' | 'warn' | 'notice' | 'info';

export type OpsIncident = {
  id: string;
  severity: IncidentSeverity;
  title: string;
  detail: string;
  href: string;
  node?: string;
  userId?: string;
  measuredAt?: number | null;
  /** When set, this customer path issue is already represented by a node accident. */
  causedByNode?: string;
};

export type CustomerPathVerdict =
  | { kind: 'offline' }
  | { kind: 'stale'; lastSeenAt: number }
  | { kind: 'unmeasured' }
  | { kind: 'ok' }
  | { kind: 'incident'; severity: 'severe' | 'warn'; reason: string; measuredAt: number | null };

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
    };
  }

  const delays: Array<{ ms: number; label: string; at: number | null }> = [];
  if (input.exitDelayMs != null) {
    delays.push({ ms: input.exitDelayMs, label: '出口', at: input.exitDelayAtMs ?? lastSeen });
  }
  if (input.tcpDelayMs != null) {
    delays.push({ ms: input.tcpDelayMs, label: 'TCP', at: input.tcpDelayAtMs ?? lastSeen });
  }
  if (delays.length === 0) return { kind: 'unmeasured' };

  const worst = delays.reduce((a, b) => (b.ms > a.ms ? b : a));
  if (worst.ms >= PATH_SEVERE_MS) {
    return { kind: 'incident', severity: 'severe', reason: `${worst.label} ${worst.ms}ms`, measuredAt: worst.at };
  }
  if (worst.ms >= PATH_WARN_MS) {
    return { kind: 'incident', severity: 'warn', reason: `${worst.label} ${worst.ms}ms`, measuredAt: worst.at };
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

/** Among online devices, the worst path; if nobody is online, the newest row. */
export function pickWorstActivity(rows: ActivityUserDto[], nowSec: number): ActivityUserDto | null {
  if (rows.length === 0) return null;
  const online = rows.filter((row) => row.online);
  const pool = online.length ? online : rows;
  return pool.reduce((best, row) => (
    pathRank(verdictForRow(row, nowSec)) < pathRank(verdictForRow(best, nowSec)) ? row : best
  ));
}

function nodeOffline(node: OpsNodeView): boolean {
  const status = node.blockStatus;
  return status === 'DOWN' || status === 'EDGE_FAIL' || node.ok === false;
}

export function incidentsFromWorld(input: {
  nodes: OpsNodeView[];
  people: OpsPersonView[];
  catalogRevision: number | null;
  nowSec: number;
}): OpsIncident[] {
  const incidents: OpsIncident[] = [];

  for (const node of input.nodes) {
    const href = `#/monitor?focus=blocked&node=${encodeURIComponent(node.name)}`;
    const listed = node.catalogListed === true;
    const affecting = node.occupancy > 0 || listed;

    if (node.quality && isLikelyBlocked(node.quality)) {
      incidents.push({
        id: `node-block:${node.name}`,
        severity: 'severe',
        title: node.name,
        detail: listed ? '疑似被墙，仍在客户目录' : '疑似被墙',
        href,
        node: node.name,
      });
    } else if (node.quality && nodeOffline(node) && affecting) {
      incidents.push({
        id: `node-down:${node.name}`,
        severity: 'severe',
        title: node.name,
        detail: node.occupancy > 0
          ? `整机失联，${node.occupancy} 人在用`
          : '整机失联，仍在客户目录',
        href,
        node: node.name,
      });
    } else if (node.quality && nodeOffline(node)) {
      incidents.push({
        id: `node-down-idle:${node.name}`,
        severity: 'warn',
        title: node.name,
        detail: '整机失联（未在售、无人在用）',
        href,
        node: node.name,
      });
    }

    if (listed && !node.agent) {
      incidents.push({
        id: `node-noprobe:${node.name}`,
        severity: 'warn',
        title: node.name,
        detail: '在售但没有探针',
        href: `#/monitor?focus=noprobe&node=${encodeURIComponent(node.name)}`,
        node: node.name,
      });
    }

    const load = node.signals.find((signal) => signal.severity >= 3);
    if (load) {
      incidents.push({
        id: `node-pressure:${node.name}:${load.label}`,
        severity: 'warn',
        title: node.name,
        detail: load.label,
        href: `#/monitor?focus=pressure&node=${encodeURIComponent(node.name)}`,
        node: node.name,
      });
    }

    if (node.billing.renewsAt) {
      const days = (node.billing.renewsAt - input.nowSec) / 86_400;
      if (days >= 0 && days <= 7) {
        incidents.push({
          id: `node-renew:${node.name}`,
          severity: 'notice',
          title: node.name,
          detail: `${Math.ceil(days)} 天后续费`,
          href: `#/monitor?focus=expiring&node=${encodeURIComponent(node.name)}`,
          node: node.name,
        });
      }
    }
  }

  const nodeAccidents = new Set(
    incidents.filter((item) => item.node && item.severity === 'severe').map((item) => item.node as string),
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
      incidents.push({
        id: `path:${person.userId}`,
        severity: path.severity,
        title: person.email,
        detail: path.reason,
        href: `#/failures?focus=customer-path&user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
        measuredAt: path.measuredAt,
      });
    }

    const user = person.user;
    if (user?.status === 'active' && user.quotaBytes && user.usageBytes / user.quotaBytes >= 0.8) {
      const over = user.usageBytes >= user.quotaBytes;
      incidents.push({
        id: `quota:${person.userId}`,
        severity: over ? 'warn' : 'notice',
        title: person.email,
        detail: over ? '流量已超' : `流量用了 ${Math.round((user.usageBytes / user.quotaBytes) * 100)}%`,
        href: `#/users?focus=quota&user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
      });
    }
    if (user?.status === 'active' && user.expiresAt) {
      const days = (user.expiresAt - input.nowSec) / 86_400;
      if (days < 0) {
        incidents.push({
          id: `expired:${person.userId}`,
          severity: 'warn',
          title: person.email,
          detail: '已经过期',
          href: `#/users?focus=expired&user=${encodeURIComponent(person.userId)}`,
          userId: person.userId,
        });
      } else if (days <= 7) {
        incidents.push({
          id: `expiring:${person.userId}`,
          severity: 'notice',
          title: person.email,
          detail: `${Math.ceil(days)} 天后到期`,
          href: `#/users?focus=expiring&user=${encodeURIComponent(person.userId)}`,
          userId: person.userId,
        });
      }
    }
    if (person.activity?.catalogRevision != null && input.catalogRevision != null
      && person.activity.catalogRevision < input.catalogRevision) {
      incidents.push({
        id: `catalog-lag:${person.userId}`,
        severity: 'notice',
        title: person.email,
        detail: `目录落后 ${input.catalogRevision - person.activity.catalogRevision} 版`,
        href: `#/users?user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
      });
    }
    if (user?.status === 'active' && user.product?.incomplete) {
      incidents.push({
        id: `claude:${person.userId}`,
        severity: 'info',
        title: person.email,
        detail: '还没开 Claude',
        href: `#/users?focus=claude&user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
      });
    }
    if (user?.status === 'active' && !user.homeBinding) {
      incidents.push({
        id: `home:${person.userId}`,
        severity: 'info',
        title: person.email,
        detail: '还没绑家宽',
        href: `#/users?focus=home&user=${encodeURIComponent(person.userId)}`,
        userId: person.userId,
      });
    }
  }

  const rank: Record<IncidentSeverity, number> = { severe: 0, warn: 1, notice: 2, info: 3 };
  incidents.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
  return incidents;
}

export function accidentsOnly(incidents: OpsIncident[]): OpsIncident[] {
  return incidents.filter((item) => item.severity === 'severe' || item.severity === 'warn');
}

export function choresOnly(incidents: OpsIncident[]): OpsIncident[] {
  return incidents.filter((item) => item.severity === 'notice' || item.severity === 'info');
}
