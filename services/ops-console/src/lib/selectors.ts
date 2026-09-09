import { copy } from '@/copy/copy';
import { mapFleetHealth } from './health';
import type { FleetNodeDto } from './types';

export type NodeFilter = 'listed' | 'blocked' | 'unmeasured' | null;

export function selectNodes(nodes: readonly FleetNodeDto[], filter: NodeFilter): FleetNodeDto[] {
  if (filter === 'listed') return nodes.filter((node) => node.catalogListed === true);
  if (filter === 'blocked') return nodes.filter((node) => mapFleetHealth(node) === copy.health.blocked);
  if (filter === 'unmeasured') return nodes.filter((node) => mapFleetHealth(node) === copy.health.unmeasured);
  return [...nodes];
}

export function countLine(nodes: readonly FleetNodeDto[]) {
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
