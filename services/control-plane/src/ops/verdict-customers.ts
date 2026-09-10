// Customer-side desires. Kept beside the node engine so verdict.ts stays under
// the file-size cap. Type-only import: no runtime cycle with ./verdict.

import type { CustomerVerdict, FunnelStage } from './contract';
import { funnelDays, stageSentence } from './funnel';
import type {
  CustomerVerdictInput,
  IncidentDesire,
  IncidentSeverity,
} from './verdict';

export const PATH_WARN_MS = 400;
export const PATH_SEVERE_MS = 800;

export const HEARTBEAT_FRESH_SECONDS = 40 * 60;
const FUTURE_SKEW_SECONDS = 5 * 60;
const PATH_OPEN_STREAK = 3;
const PATH_CLOSE_STREAK = 3;
const REPEAT_FAIL = 3;
const SWITCH_CHURN = 4;

function clipTitle(value: string): string {
  return value.length <= 200 ? value : value.slice(0, 200);
}

/**
 * Read-side freshness when no open customer-* incident exists.
 * Stale or missing heartbeat is 未上报; a fresh sample is `fresh` so the
 * caller can distinguish 离线 (heard from, not connected) from 正常.
 */
export function customerFreshnessVerdict(
  lastSeenAt: number | null | undefined,
  nowSec: number,
): 'unreported' | 'fresh' {
  if (lastSeenAt == null || !Number.isFinite(lastSeenAt) || lastSeenAt <= 0) return 'unreported';
  if (nowSec - lastSeenAt > HEARTBEAT_FRESH_SECONDS) return 'unreported';
  return 'fresh';
}

/**
 * Never-connected people are 还没用起来, not 未上报/离线. Unreachable,
 * unstable and ok stay as they are.
 */
export function neverUsedOverride(
  verdict: CustomerVerdict,
  stage: FunnelStage,
  stageSinceAt: number,
  nowSec: number,
): { verdict: CustomerVerdict; reason: string } | null {
  if (stage === 'connected') return null;
  if (verdict !== 'unreported' && verdict !== 'offline') return null;
  return { verdict: 'never_used', reason: stageSentence(stage, funnelDays(nowSec, stageSinceAt)) };
}

function sampleFresh(atMs: number | null | undefined, heartbeatSec: number | null, nowSec: number): boolean {
  if (atMs != null && Number.isFinite(atMs)) {
    const atSec = Math.floor(atMs / 1000);
    const age = nowSec - atSec;
    return age >= -FUTURE_SKEW_SECONDS && age <= HEARTBEAT_FRESH_SECONDS;
  }
  if (heartbeatSec == null) return false;
  return nowSec - heartbeatSec <= HEARTBEAT_FRESH_SECONDS;
}

function worstFreshDelay(customer: CustomerVerdictInput, nowSec: number): number | null {
  if (customer.lastSeenAt == null) return null;
  if (nowSec - customer.lastSeenAt > HEARTBEAT_FRESH_SECONDS) return null;
  if (customer.online === false) return null;
  const delays: number[] = [];
  if (customer.exitDelayMs != null && sampleFresh(customer.exitDelayAtMs, customer.lastSeenAt, nowSec)) {
    delays.push(customer.exitDelayMs);
  }
  if (customer.tcpDelayMs != null && sampleFresh(customer.tcpDelayAtMs, customer.lastSeenAt, nowSec)) {
    delays.push(customer.tcpDelayMs);
  }
  if (delays.length === 0) return null;
  return Math.max(...delays);
}

/**
 * Path streak: n>=3 open (consecutive slow), n=1..2 candidate, n=0 closed,
 * n<0 open with clean evaluations (need PATH_CLOSE_STREAK cleans to close).
 */
export function nextPathStreak(prior: number, slow: boolean): number {
  if (slow) {
    if (prior < 0) return PATH_OPEN_STREAK;
    return prior + 1;
  }
  if (prior >= PATH_OPEN_STREAK) return -1;
  if (prior < 0) {
    const cleans = -prior + 1;
    return cleans >= PATH_CLOSE_STREAK ? 0 : -cleans;
  }
  return 0;
}

export function pathStreakOpen(streak: number): boolean {
  return streak >= PATH_OPEN_STREAK || streak < 0;
}

export function customerDesires(
  customers: CustomerVerdictInput[],
  nowSec: number,
  nodeDesires: IncidentDesire[],
  maintenance: ReadonlySet<string>,
): { desires: IncidentDesire[]; pathStreaks: Record<string, number> } {
  const severeByNode = new Map<string, string>();
  for (const desire of nodeDesires) {
    if (desire.subjectType === 'node' && desire.severity === 'severe') {
      severeByNode.set(desire.subjectId, desire.dedupeKey);
    }
  }
  const desires: IncidentDesire[] = [];
  const pathStreaks: Record<string, number> = {};
  for (const customer of customers) {
    if (customer.selectedServer && maintenance.has(customer.selectedServer)) continue;
    const parent = customer.selectedServer ? severeByNode.get(customer.selectedServer) : undefined;
    const demote = parent != null;

    const delay = worstFreshDelay(customer, nowSec);
    const slow = delay != null && delay >= PATH_WARN_MS;
    const streak = nextPathStreak(customer.priorPathStreak, slow);
    pathStreaks[customer.userId] = streak;
    if (pathStreakOpen(streak)) {
      const ms = delay != null && delay >= PATH_WARN_MS ? delay : PATH_WARN_MS;
      const own: IncidentSeverity = ms >= PATH_SEVERE_MS ? 'severe' : 'warn';
      desires.push({
        dedupeKey: `customer-path-slow:${customer.userId}`,
        kind: 'customer-path-slow',
        subjectType: 'user',
        subjectId: customer.userId,
        severity: demote ? 'notice' : own,
        title: clipTitle(`${customer.email} 路径 ${ms}ms`),
        detail: ms >= PATH_SEVERE_MS ? `路径严重偏慢 ${ms}ms` : `路径偏慢 ${ms}ms`,
        cause: 'path_slow',
        parentDedupeKey: parent,
        impactCount: 1,
        evidence: { delayMs: delay, pathStreak: streak, selectedServer: customer.selectedServer },
      });
    }

    const fail = customer.fails30m.failures;
    const noOkAfter = customer.lastOkAt == null
      || customer.lastFailAt == null
      || customer.lastOkAt < customer.lastFailAt;
    if (fail >= REPEAT_FAIL && noOkAfter) {
      desires.push({
        dedupeKey: `customer-repeat-fail:${customer.userId}`,
        kind: 'customer-repeat-fail',
        subjectType: 'user',
        subjectId: customer.userId,
        severity: demote ? 'notice' : 'warn',
        title: clipTitle(`${customer.email} 30 分钟内连续连接失败`),
        detail: `${fail} 次失败，期间没有连上`,
        cause: 'repeat_fail',
        parentDedupeKey: parent,
        impactCount: 1,
        evidence: { failures: fail, lastFailAt: customer.lastFailAt, lastOkAt: customer.lastOkAt },
      });
    }

    if (customer.switches24h >= SWITCH_CHURN) {
      desires.push({
        dedupeKey: `customer-switch-churn:${customer.userId}`,
        kind: 'customer-switch-churn',
        subjectType: 'user',
        subjectId: customer.userId,
        severity: 'notice',
        title: clipTitle(`${customer.email} 24 小时内切换 ${customer.switches24h} 次`),
        detail: null,
        cause: 'switch_churn',
        parentDedupeKey: parent,
        impactCount: 1,
        evidence: { switches24h: customer.switches24h, selectedServer: customer.selectedServer },
      });
    }
  }
  return { desires, pathStreaks };
}
