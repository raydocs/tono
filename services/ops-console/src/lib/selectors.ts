import type { NodeHealthWord, NodeLifecycle, NodeSummaryDto } from '@contract';
import { copy } from '@/copy/copy';

/**
 * Two axes, kept apart on purpose.
 *
 * The health word is the engine's judgement and drives the count sentence; the
 * lifecycle is an inventory fact and drives the chips. The old page mixed them
 * — 在售 sat in the same sentence as 被墙 — which is how a retired machine
 * ended up counted as a fault. Nothing here recomputes a verdict: every
 * predicate reads the word the engine already wrote (R4).
 */
export const NODE_FILTERS = ['lost', 'blocked', 'degraded', 'ok', 'unmeasured'] as const;

export type NodeFilterId = (typeof NODE_FILTERS)[number];
export type NodeFilter = NodeFilterId | null;

/** The word each fragment of the count sentence stands for, in engine order. */
const FILTER_WORD: Record<NodeFilterId, NodeHealthWord> = {
  lost: copy.health.lost,
  blocked: copy.health.blocked,
  degraded: copy.health.degraded,
  ok: copy.health.ok,
  unmeasured: copy.health.unmeasured,
};

export function nodeWord(id: NodeFilterId): NodeHealthWord {
  return FILTER_WORD[id];
}

export function selectNodes(
  nodes: readonly NodeSummaryDto[],
  filter: NodeFilter,
): NodeSummaryDto[] {
  if (filter === null) return [...nodes];
  return nodes.filter((node) => node.health === FILTER_WORD[filter]);
}

export function countLine(nodes: readonly NodeSummaryDto[]): Record<NodeFilterId, number> {
  const out = {} as Record<NodeFilterId, number>;
  for (const id of NODE_FILTERS) out[id] = selectNodes(nodes, id).length;
  return out;
}

/**
 * Which lifecycles the grid shows.
 *
 * Retired machines are inventory, not fleet: they answer no probe and would
 * otherwise fill the page with alarms nobody can act on. They are one chip
 * away, and the chip carries their count so the reader knows they exist.
 */
export const NODE_LIFECYCLE_CHIPS: NodeLifecycle[] = ['listed', 'unlisted', 'retired'];

export function selectLifecycle(
  nodes: readonly NodeSummaryDto[],
  lifecycle: NodeLifecycle | null,
): NodeSummaryDto[] {
  if (lifecycle === null) return nodes.filter((node) => node.lifecycle !== 'retired');
  return nodes.filter((node) => node.lifecycle === lifecycle);
}

export function lifecycleCounts(
  nodes: readonly NodeSummaryDto[],
): Record<NodeLifecycle, number> {
  const out = {} as Record<NodeLifecycle, number>;
  for (const id of NODE_LIFECYCLE_CHIPS) {
    out[id] = nodes.filter((node) => node.lifecycle === id).length;
  }
  return out;
}

/**
 * The fragments worth printing.
 *
 * A zero is a measurement here — the engine judged every machine — but five
 * fragments of prose at 32 px wrap to two lines, and "0 台失联" is a line of
 * the sentence spent saying nothing happened. So the sentence names only what
 * is there, in the engine's own precedence order, and a fleet that is entirely
 * fine reads "42 台正常".
 */
export function countFragments(counts: Record<NodeFilterId, number>): NodeFilterId[] {
  return NODE_FILTERS.filter((id) => counts[id] > 0);
}

/**
 * The same sentence at 390 px.
 *
 * Five fragments of 32 px prose is four lines on a phone, which pushes the
 * table — the thing the phone is for — off the first screen. The list is
 * already in severity order, so the head of it is what an operator on a phone
 * came to see; a filter they have turned on stays whatever its rank, or the
 * sentence would stop explaining the list under it.
 */
export function topFragments(
  ids: readonly NodeFilterId[],
  limit: number,
  keep: NodeFilter,
): NodeFilterId[] {
  if (ids.length <= limit) return [...ids];
  const head = ids.slice(0, limit);
  if (keep === null || head.includes(keep)) return head;
  return [...head.slice(0, limit - 1), keep];
}

export function nodeRegion(name: string): string {
  const cut = name.indexOf('·');
  if (cut <= 0) return name;
  return name.slice(0, cut).trim();
}
