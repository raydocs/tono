// The two ways a node becomes 疑似被墙 / 多位客户连不上, kept apart from the
// precedence table so verdict.ts stays under its budget. Type-only imports
// from verdict.ts: no runtime cycle.

import type { NodeFails30m, NodeVerdictInput } from './verdict';

/** Distinct customers it takes before their failures speak for a node. */
export const FAIL_USERS = 2;

// The mainland sweep is one hub dialling every node from the same few agents.
// When every node it judged says LIKELY_BLOCKED, the agents could not dial
// out; the fleet was not dialled. From 2026-10-08 to 10-26 the one agent whose
// every dial failed read 17 nodes on five providers as 疑似被墙 for eighteen
// days while customers connected through them. Such a sweep is not block
// evidence. Three judged nodes is the smallest fleet where "all" means much.
export const BLOCK_SUSPECT_MIN_NODES = 3;
const MAINLAND_JUDGED = new Set(['OK', 'LIKELY_BLOCKED', 'DEGRADED']);

export function blockEvidenceSuspect(nodes: readonly Pick<NodeVerdictInput, 'blockStatus'>[]): boolean {
  const judged = nodes.filter((node) => node.blockStatus != null && MAINLAND_JUDGED.has(node.blockStatus));
  if (judged.length < BLOCK_SUSPECT_MIN_NODES) return false;
  return judged.every((node) => node.blockStatus === 'LIKELY_BLOCKED');
}

// Blocked has two sources. The mainland sweep's verdict keeps its word; the
// customers' own failures (rules version 3) get theirs, because an operator
// reading 疑似被墙 looks for a wall, and here two people simply could not
// reach the exit while reaching nothing else was wrong for them.
export const BLOCKED_LABELS = {
  likely_blocked: '疑似被墙',
  customer_unreachable: '多位客户连不上',
} as const;

export type BlockedCause = keyof typeof BLOCKED_LABELS;

/** Customers are the probes (owner, 2026-10-26): see verdict-facts exitUnreachableUsers. */
export function customersUnreachable(fails: NodeFails30m): boolean {
  return fails.handshakeDistinctUsers >= FAIL_USERS;
}

export function blockedCause(node: NodeVerdictInput): BlockedCause {
  return customersUnreachable(node.fails30m) ? 'customer_unreachable' : 'likely_blocked';
}
