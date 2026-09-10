export { can, isOpsRole, OPS_ROLES, OPS_ACTIONS } from '@contract';
export type { OpsRole, OpsAction } from '@contract';

import { can, isOpsRole } from '@contract';
import type { OpsAction, OpsRole } from '@contract';
import { copy, type PageId } from '@/copy/copy';

export const PAGE_REQUIRES: Record<PageId, OpsAction> = {
  today: 'incidents.read',
  nodes: 'nodes.read',
  customers: 'customers.read',
  clients: 'releases.read',
  settings: 'settings.read',
};

export function currentRole(): OpsRole {
  const fromVite = import.meta.env?.VITE_OPS_ROLE as string | undefined;
  return isOpsRole(fromVite) ? fromVite : 'owner';
}

export function visiblePages(role: OpsRole): PageId[] {
  return (Object.keys(copy.pages) as PageId[]).filter((id) => can(PAGE_REQUIRES[id], role));
}

export function firstAllowedPage(role: OpsRole): PageId {
  return visiblePages(role)[0] ?? 'today';
}
