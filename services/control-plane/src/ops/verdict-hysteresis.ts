// Time-based node hysteresis. Age is nowSec − candidateSince (0 on first
// observation). Blocked still uses sweep-count streaks; down still uses the
// agent-silent / fresh-agent gates. Type-only import: no runtime cycle.

import type { NodeVerdict, NodeVerdictInput } from './verdict';

export const AGENT_SILENT_SECONDS = 15 * 60;
const HANDSHAKE_USERS = 2;

export type HysteresisRule = {
  verdict: NodeVerdict;
  enterStreak: number;
  enterSeconds: number;
  enterGate?: 'agent_silent_15m' | 'handshake_or_two';
  exitStreak: number;
  exitSeconds: number;
  exitGate?: 'fresh_agent' | 'connect_ok_or_two_clean';
};

export const HYSTERESIS: readonly HysteresisRule[] = [
  { verdict: 'down', enterStreak: 1, enterSeconds: 0, enterGate: 'agent_silent_15m', exitStreak: 1, exitSeconds: 0, exitGate: 'fresh_agent' },
  { verdict: 'blocked', enterStreak: 2, enterSeconds: 0, enterGate: 'handshake_or_two', exitStreak: 2, exitSeconds: 0, exitGate: 'connect_ok_or_two_clean' },
  { verdict: 'no_probe', enterStreak: 1, enterSeconds: 0, exitStreak: 1, exitSeconds: 0 },
  { verdict: 'degraded', enterStreak: 2, enterSeconds: 600, exitStreak: 1, exitSeconds: 900 },
  { verdict: 'probe_unreachable', enterStreak: 2, enterSeconds: 600, exitStreak: 1, exitSeconds: 0 },
  { verdict: 'pressure', enterStreak: 3, enterSeconds: 900, exitStreak: 1, exitSeconds: 900 },
  { verdict: 'unknown', enterStreak: 1, enterSeconds: 0, exitStreak: 1, exitSeconds: 0 },
  { verdict: 'ok', enterStreak: 1, enterSeconds: 0, exitStreak: 1, exitSeconds: 0 },
];

const RANK: Record<NodeVerdict, number> = {
  down: 7, blocked: 6, no_probe: 5, degraded: 4, probe_unreachable: 3, pressure: 2, unknown: 1, ok: 0,
};

const HYSTERESIS_BY = Object.fromEntries(HYSTERESIS.map((rule) => [rule.verdict, rule])) as Record<NodeVerdict, HysteresisRule>;

export type AppliedHysteresis = {
  verdict: NodeVerdict;
  candidateVerdict: NodeVerdict;
  candidateStreak: number;
  candidateSince: number | null;
};

type HysteresisCtx = {
  nowSec: number;
  qualitySweepAt: number | null;
};

function rule(verdict: NodeVerdict): HysteresisRule {
  return HYSTERESIS_BY[verdict];
}

export function agentSilent(observedAt: number | null, nowSec: number): boolean {
  return observedAt == null || nowSec - observedAt > AGENT_SILENT_SECONDS;
}

function agentFresh(observedAt: number | null, nowSec: number): boolean {
  return observedAt != null && nowSec - observedAt <= AGENT_SILENT_SECONDS;
}

export function unreachable(node: NodeVerdictInput): boolean {
  return node.ok === false || node.blockStatus === 'DOWN' || node.blockStatus === 'EDGE_FAIL';
}

function canEnter(
  target: NodeVerdict,
  streak: number,
  age: number,
  node: NodeVerdictInput,
  ctx: HysteresisCtx,
): boolean {
  const spec = rule(target);
  if (target === 'down') {
    return unreachable(node) && agentSilent(node.agentObservedAt, ctx.nowSec) && age >= spec.enterSeconds;
  }
  if (target === 'blocked') {
    if (streak >= spec.enterStreak) return true;
    return streak >= 1 && node.fails30m.handshakeDistinctUsers >= HANDSHAKE_USERS;
  }
  return streak >= spec.enterStreak && age >= spec.enterSeconds;
}

function canExit(
  current: NodeVerdict,
  cleanStreak: number,
  age: number,
  node: NodeVerdictInput,
  ctx: HysteresisCtx,
): boolean {
  const spec = rule(current);
  if (current === 'down') return agentFresh(node.agentObservedAt, ctx.nowSec);
  if (current === 'blocked') {
    const okAfterSweep = node.lastCustomerOkAt != null
      && ctx.qualitySweepAt != null
      && node.lastCustomerOkAt >= ctx.qualitySweepAt;
    if (cleanStreak >= 1 && okAfterSweep) return true;
    return cleanStreak >= spec.exitStreak;
  }
  return age >= spec.exitSeconds;
}

export function applyHysteresis(
  observed: NodeVerdict,
  node: NodeVerdictInput,
  ctx: HysteresisCtx,
): AppliedHysteresis {
  const prior = node.prior;
  const committed = prior?.verdict ?? 'unknown';
  if (observed === committed) {
    return { verdict: committed, candidateVerdict: observed, candidateStreak: 0, candidateSince: null };
  }
  const sameCandidate = prior?.candidateVerdict === observed;
  const streak = sameCandidate ? prior.candidateStreak + 1 : 1;
  const exiting = RANK[observed] < RANK[committed];
  const priorExiting = prior != null
    && RANK[prior.candidateVerdict] < RANK[committed]
    && prior.candidateSince != null;
  // Exit age is time spent observing anything cleaner than the committed
  // verdict. Candidate identity (ok vs unknown) must not reset that clock.
  const candidateSince = exiting && priorExiting
    ? prior.candidateSince ?? ctx.nowSec
    : (sameCandidate && prior.candidateSince != null ? prior.candidateSince : ctx.nowSec);
  const age = ctx.nowSec - candidateSince;
  if (RANK[observed] > RANK[committed]) {
    if (canEnter(observed, streak, age, node, ctx)) {
      return { verdict: observed, candidateVerdict: observed, candidateStreak: 0, candidateSince: null };
    }
    return { verdict: committed, candidateVerdict: observed, candidateStreak: streak, candidateSince };
  }
  if (canExit(committed, streak, age, node, ctx)) {
    if (canEnter(observed, streak, age, node, ctx)) {
      return { verdict: observed, candidateVerdict: observed, candidateStreak: 0, candidateSince: null };
    }
    return { verdict: 'unknown', candidateVerdict: observed, candidateStreak: streak, candidateSince };
  }
  return { verdict: committed, candidateVerdict: observed, candidateStreak: streak, candidateSince };
}
