// Pure fleet verdict. No I/O and no clock: every gate reads nowSec so a test
// can walk hysteresis tick by tick. Labels for down/blocked/ok match today's
// NODE_HEALTH_LABELS / fleetQualityStatus copy.

import { customerDesires } from './verdict-customers';
import {
  AGENT_SILENT_SECONDS,
  applyHysteresis,
  agentSilent,
  unreachable,
} from './verdict-hysteresis';

export {
  PATH_SEVERE_MS,
  PATH_WARN_MS,
  nextPathStreak,
  pathStreakOpen,
} from './verdict-customers';

export {
  HYSTERESIS,
  type HysteresisRule,
} from './verdict-hysteresis';

export const VERDICT_RULES_VERSION = 1;

// The hub's mainland sweep is a twelve-hour SSH pass, so a sweep is not stale
// until it has missed a whole cycle with margin; two hours read the fleet as
// 未测 for ten of every twelve. The agent copy is minutes old, and stays so.
const QUALITY_STALE_SECONDS = 26 * 3600;
const AGENTS_STALE_SECONDS = 15 * 60;
const COLLECTOR_STALE_SECONDS = 20 * 60;
const CARRIER_LOSS_PCT = 10;
const PRESSURE_CPU = 90;
const PRESSURE_MEM = 0.95;
const PRESSURE_DISK = 0.95;
const FAIL_ATTEMPTS = 10;
const FAIL_RATIO = 0.3;
const FAIL_USERS = 2;

export const NODE_VERDICTS = [
  'down', 'blocked', 'no_probe', 'degraded', 'pressure', 'unknown', 'ok',
] as const;
export type NodeVerdict = typeof NODE_VERDICTS[number];

export const VERDICT_PRECEDENCE: readonly NodeVerdict[] = NODE_VERDICTS;

export const VERDICT_LABELS: Record<NodeVerdict, string> = {
  down: '整机失联',
  blocked: '疑似被墙',
  no_probe: '无探针',
  degraded: '回程丢包',
  pressure: '高负载',
  unknown: '路径未测',
  ok: '大陆正常',
};

const DEGRADED_LABELS = {
  carrier_loss: '回程丢包',
  customer_fail: '客户连接失败',
  error_spike: '后台报错激增',
} as const;

export type DegradedCause = keyof typeof DEGRADED_LABELS;

export type CarrierSample = { lossPct: number | null; latencyMs: number | null; samples: number };
export type CarrierMap = { unicom?: CarrierSample | null; telecom?: CarrierSample | null; mobile?: CarrierSample | null };

export type NodeFails30m = {
  attempts: number;
  failures: number;
  distinctUsers: number;
  handshakeDistinctUsers: number;
};

export type NodePrior = {
  verdict: NodeVerdict;
  candidateVerdict: NodeVerdict;
  candidateStreak: number;
  candidateSince: number | null;
  changedAt: number;
};

export type NodeVerdictInput = {
  name: string;
  catalogListed: boolean | null;
  ok: boolean | null;
  blockStatus: string | null;
  agentObservedAt: number | null;
  carriers: CarrierMap | null;
  machine: { cpu: number | null; memRatio: number | null; diskRatio: number | null; load1: number | null } | null;
  occupancy: number | null;
  profileStatus: string | null;
  prior: NodePrior | null;
  fails30m: NodeFails30m;
  lastCustomerOkAt: number | null;
  errorSpike: boolean;
};

export type CustomerFails30m = { attempts: number; failures: number };

export type CustomerVerdictInput = {
  userId: string;
  email: string;
  selectedServer: string | null;
  lastSeenAt: number | null;
  online: boolean | null;
  exitDelayMs: number | null;
  tcpDelayMs: number | null;
  exitDelayAtMs: number | null;
  tcpDelayAtMs: number | null;
  fails30m: CustomerFails30m;
  lastFailAt: number | null;
  lastOkAt: number | null;
  switches24h: number;
  priorPathStreak: number;
};

export type VerdictInput = {
  nodes: NodeVerdictInput[];
  customers: CustomerVerdictInput[];
  nowSec: number;
  qualitySweepAt: number | null;
  agentsSnapshotAt: number | null;
  maintenance: ReadonlySet<string>;
};

export type IncidentSeverity = 'severe' | 'warn' | 'notice';
export type IncidentSubjectType = 'node' | 'user' | 'home_exit' | 'fleet';

export type IncidentDesire = {
  dedupeKey: string;
  kind: string;
  subjectType: IncidentSubjectType;
  subjectId: string;
  severity: IncidentSeverity;
  title: string;
  detail: string | null;
  cause: string | null;
  parentDedupeKey?: string;
  impactCount: number;
  evidence: Record<string, unknown>;
  suggestedJob?: 'catalog_retire';
  /**
   * Read back from the live table by a pass that did not evaluate this
   * subject. It keeps the incident alive and links children to it, and the
   * reconciler leaves its row alone: a scoped pass must not rewrite evidence
   * it never measured, nor touch every incident on every heartbeat.
   */
  carried?: boolean;
};

export type AgentStatus = 'online' | 'stale' | 'missing';

export type NodeVerdictResult = {
  name: string;
  verdict: NodeVerdict;
  label: string;
  reason: string | null;
  qualityStatus: string | null;
  agentStatus: AgentStatus | null;
  catalogListed: boolean | null;
  occupancy: number | null;
  candidateVerdict: NodeVerdict;
  candidateStreak: number;
  candidateSince: number | null;
  changed: boolean;
  previousVerdict: NodeVerdict | null;
  changedAt: number;
  lastCustomerOkAt: number | null;
  lastQualitySweepAt: number | null;
  evidence: Record<string, unknown>;
};

export type VerdictOutput = {
  rulesVersion: number;
  nodes: NodeVerdictResult[];
  desires: IncidentDesire[];
  pathStreaks: Record<string, number>;
};

type SnapshotCtx = {
  nowSec: number;
  qualitySweepAt: number | null;
  agentsSnapshotAt: number | null;
};

const CARRIER_KEYS = ['unicom', 'telecom', 'mobile'] as const;

function snapshotStale(at: number | null, nowSec: number, maxAge: number): boolean {
  return at == null || nowSec - at > maxAge;
}

export function agentStatusAt(observedAt: number | null, nowSec: number): AgentStatus {
  if (observedAt == null) return 'missing';
  return nowSec - observedAt > AGENT_SILENT_SECONDS ? 'stale' : 'online';
}

function lossyCarriers(carriers: CarrierMap | null): Array<{ key: string; lossPct: number }> {
  if (!carriers) return [];
  const out: Array<{ key: string; lossPct: number }> = [];
  for (const key of CARRIER_KEYS) {
    const row = carriers[key];
    if (!row || row.samples <= 0 || row.lossPct == null || row.lossPct < CARRIER_LOSS_PCT) continue;
    out.push({ key, lossPct: row.lossPct });
  }
  return out;
}

function customerFailRatio(fails: NodeFails30m): boolean {
  if (fails.attempts < FAIL_ATTEMPTS || fails.attempts <= 0) return false;
  return fails.failures / fails.attempts >= FAIL_RATIO && fails.distinctUsers >= FAIL_USERS;
}

function pressureHit(machine: NodeVerdictInput['machine']): boolean {
  if (!machine) return false;
  return (machine.cpu != null && machine.cpu >= PRESSURE_CPU)
    || (machine.memRatio != null && machine.memRatio >= PRESSURE_MEM)
    || (machine.diskRatio != null && machine.diskRatio >= PRESSURE_DISK);
}

function degradedCause(node: NodeVerdictInput): DegradedCause | null {
  if (lossyCarriers(node.carriers).length) return 'carrier_loss';
  if (customerFailRatio(node.fails30m)) return 'customer_fail';
  if (node.errorSpike) return 'error_spike';
  return null;
}

function labelFor(verdict: NodeVerdict, cause: DegradedCause | null): string {
  if (verdict === 'degraded' && cause) return DEGRADED_LABELS[cause];
  return VERDICT_LABELS[verdict];
}

function reasonFor(verdict: NodeVerdict, cause: DegradedCause | null): string {
  if (verdict === 'degraded' && cause) return cause;
  if (verdict === 'down') return 'unreachable';
  if (verdict === 'blocked') return 'likely_blocked';
  if (verdict === 'no_probe') return 'agent_missing';
  if (verdict === 'pressure') return 'machine_pressure';
  if (verdict === 'unknown') return 'snapshot_stale';
  return 'ok';
}

/** Raw precedence, first match. Down includes the agent-silent enter gate. */
export function observedVerdict(node: NodeVerdictInput, ctx: SnapshotCtx): NodeVerdict {
  if (unreachable(node) && agentSilent(node.agentObservedAt, ctx.nowSec)) return 'down';
  // The sweep says unreachable but Komari heard from the box within 15 minutes:
  // the two sources disagree, and neither "正常" nor "失联" is honest until they
  // agree again. Report it as unmeasured rather than letting it fall through.
  if (unreachable(node)) return 'unknown';
  if (node.ok === true && node.blockStatus === 'LIKELY_BLOCKED') return 'blocked';
  if (node.catalogListed === true && node.agentObservedAt == null) return 'no_probe';
  if (degradedCause(node)) return 'degraded';
  if (pressureHit(node.machine)) return 'pressure';
  if (
    snapshotStale(ctx.qualitySweepAt, ctx.nowSec, QUALITY_STALE_SECONDS)
    || snapshotStale(ctx.agentsSnapshotAt, ctx.nowSec, AGENTS_STALE_SECONDS)
  ) return 'unknown';
  return 'ok';
}

function clipTitle(value: string): string {
  return value.length <= 200 ? value : value.slice(0, 200);
}

function occupancyLine(occupancy: number | null, unit: '位客户仍在用' | '人在用'): string | null {
  const n = occupancy ?? 0;
  if (n <= 0) return null;
  return `${n} ${unit}`;
}

function nodeDesireTitle(verdict: NodeVerdict, label: string, occupancy: number | null, listed: boolean | null): string {
  const n = occupancy ?? 0;
  if (verdict === 'blocked') {
    if (n > 0) return `大陆连不上这台机器，${n} 位客户仍在用`;
    return listed === true ? '疑似被墙，仍在客户目录' : '疑似被墙';
  }
  if (verdict === 'down') {
    if (n > 0) return `整机失联，${n} 人在用`;
    return listed === true ? '整机失联，仍在客户目录' : '整机失联';
  }
  if (verdict === 'no_probe') return '在售但没有探针';
  const people = occupancyLine(occupancy, '人在用');
  return people ? `${label}，${people}` : label;
}

function nodeKind(verdict: NodeVerdict): string | null {
  if (verdict === 'blocked') return 'node-blocked';
  if (verdict === 'down') return 'node-down';
  if (verdict === 'degraded') return 'node-degraded';
  if (verdict === 'pressure') return 'node-pressure';
  if (verdict === 'no_probe') return 'node-no-probe';
  return null;
}

function nodeSeverity(verdict: NodeVerdict): IncidentSeverity | null {
  if (verdict === 'blocked' || verdict === 'down') return 'severe';
  if (verdict === 'degraded' || verdict === 'pressure') return 'warn';
  if (verdict === 'no_probe') return 'notice';
  return null;
}

function evaluateNode(node: NodeVerdictInput, ctx: SnapshotCtx): NodeVerdictResult {
  const observed = observedVerdict(node, ctx);
  const applied = applyHysteresis(observed, node, ctx);
  const cause = applied.verdict === 'degraded' ? degradedCause(node) : null;
  const previous = node.prior?.verdict ?? null;
  const changed = previous !== applied.verdict;
  const loss = lossyCarriers(node.carriers);
  return {
    name: node.name,
    verdict: applied.verdict,
    label: labelFor(applied.verdict, cause),
    reason: reasonFor(applied.verdict, cause),
    qualityStatus: node.blockStatus,
    agentStatus: agentStatusAt(node.agentObservedAt, ctx.nowSec),
    catalogListed: node.catalogListed,
    occupancy: node.occupancy,
    candidateVerdict: applied.candidateVerdict,
    candidateStreak: applied.candidateStreak,
    candidateSince: applied.candidateSince,
    changed,
    previousVerdict: previous,
    changedAt: changed ? ctx.nowSec : (node.prior?.changedAt ?? ctx.nowSec),
    lastCustomerOkAt: node.lastCustomerOkAt,
    lastQualitySweepAt: ctx.qualitySweepAt,
    evidence: {
      observed,
      ok: node.ok,
      blockStatus: node.blockStatus,
      agentObservedAt: node.agentObservedAt,
      loss,
      machine: node.machine,
      fails30m: node.fails30m,
      errorSpike: node.errorSpike,
      handshakeDistinctUsers: node.fails30m.handshakeDistinctUsers,
    },
  };
}

function desireForNode(node: NodeVerdictResult): IncidentDesire | null {
  const kind = nodeKind(node.verdict);
  const severity = nodeSeverity(node.verdict);
  if (!kind || !severity) return null;
  const occupancy = node.occupancy ?? 0;
  const retire = (node.verdict === 'blocked' || node.verdict === 'down') && node.catalogListed === true;
  return {
    dedupeKey: `${kind}:${node.name}`,
    kind,
    subjectType: 'node',
    subjectId: node.name,
    severity,
    title: clipTitle(nodeDesireTitle(node.verdict, node.label, node.occupancy, node.catalogListed)),
    detail: node.name,
    cause: node.reason,
    impactCount: occupancy,
    evidence: { verdict: node.verdict, occupancy, catalogListed: node.catalogListed },
    suggestedJob: retire ? 'catalog_retire' : undefined,
  };
}

function collectorStale(ctx: SnapshotCtx): boolean {
  return snapshotStale(ctx.qualitySweepAt, ctx.nowSec, QUALITY_STALE_SECONDS)
    || snapshotStale(ctx.agentsSnapshotAt, ctx.nowSec, COLLECTOR_STALE_SECONDS);
}

export function evaluate(input: VerdictInput): VerdictOutput {
  const ctx: SnapshotCtx = {
    nowSec: input.nowSec,
    qualitySweepAt: input.qualitySweepAt,
    agentsSnapshotAt: input.agentsSnapshotAt,
  };
  const nodes = input.nodes.map((node) => evaluateNode(node, ctx));
  // A retired machine is a lifecycle fact, not an incident: it is expected to
  // be unreachable, and its verdict is still recorded for the node page.
  const retired = new Set(input.nodes.filter((n) => n.profileStatus === 'retired').map((n) => n.name));
  const desires: IncidentDesire[] = [];
  for (const node of nodes) {
    if (input.maintenance.has(node.name) || retired.has(node.name)) continue;
    const desire = desireForNode(node);
    if (desire) desires.push(desire);
  }
  if (collectorStale(ctx)) {
    desires.push({
      dedupeKey: 'fleet-collector-stale',
      kind: 'fleet-collector-stale',
      subjectType: 'fleet',
      subjectId: 'collector',
      severity: 'severe',
      title: '采集器超过 20 分钟未上报',
      detail: '探针快照超过 20 分钟没更新，或大陆扫描超过 26 小时没跑',
      cause: 'collector_stale',
      impactCount: 0,
      evidence: { qualitySweepAt: ctx.qualitySweepAt, agentsSnapshotAt: ctx.agentsSnapshotAt },
    });
  }
  const customers = customerDesires(input.customers, input.nowSec, desires, input.maintenance);
  desires.push(...customers.desires);
  return {
    rulesVersion: VERDICT_RULES_VERSION,
    nodes,
    desires,
    pathStreaks: customers.pathStreaks,
  };
}
