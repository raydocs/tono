import { copy } from '@/copy/copy';
import { mapFleetHealth } from './health';
import type { FleetNodeDto } from './types';

/** Every filter the 节点 page offers. R4: the count and the list share this list. */
export const NODE_FILTERS = ['listed', 'blocked', 'unmeasured'] as const;

export type NodeFilterId = (typeof NODE_FILTERS)[number];
export type NodeFilter = NodeFilterId | null;

export function selectNodes(nodes: readonly FleetNodeDto[], filter: NodeFilter): FleetNodeDto[] {
  if (filter === 'listed') return nodes.filter((node) => node.catalogListed === true);
  if (filter === 'blocked') return nodes.filter((node) => mapFleetHealth(node) === copy.health.blocked);
  if (filter === 'unmeasured') return nodes.filter((node) => mapFleetHealth(node) === copy.health.unmeasured);
  return [...nodes];
}

export function countLine(nodes: readonly FleetNodeDto[]): Record<NodeFilterId, number> {
  return {
    listed: selectNodes(nodes, 'listed').length,
    blocked: selectNodes(nodes, 'blocked').length,
    unmeasured: selectNodes(nodes, 'unmeasured').length,
  };
}

export function nodeRegion(name: string): string {
  const cut = name.indexOf('·');
  if (cut <= 0) return name;
  return name.slice(0, cut).trim();
}
