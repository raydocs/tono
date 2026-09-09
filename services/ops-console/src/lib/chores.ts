import type { CustomerSummaryDto } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import { formatDate, formatPercent } from './display';
import type { FleetNodeDto } from './types';

export type ChoreKind = keyof typeof copy.choreKind;

/**
 * 待办 is the third axis: never an incident, never a health word, always the
 * `rem` tone. Nothing here is broken — a renewal in nine days and a customer
 * at 94 % of quota are things to do, and mixing them into 进行中 is how the
 * old dashboard ended up claiming eleven faults on a healthy fleet.
 */
export type Chore = {
  id: string;
  kind: ChoreKind;
  summary: string;
  dueAt: number | null;
};

const DAY = 86_400;
/** Two weeks: long enough to buy a renewal, short enough not to be wallpaper. */
const SOON = 14 * DAY;
const NODE_QUOTA_CHORE = 0.7;
const CUSTOMER_QUOTA_CHORE = 0.9;

function due(at: number | null | undefined): boolean {
  return typeof at === 'number' && at - nowSec() < SOON;
}

/** 续费、额度、缺资料 for the fleet. Ordered by when they bite. */
export function fleetChores(nodes: readonly FleetNodeDto[]): Chore[] {
  const out: Chore[] = [];
  for (const node of nodes) {
    const profile = node.profile;
    if (!profile || (profile.price === null && profile.renewsAt === null)) {
      out.push({
        id: `node-profile-${node.name}`,
        kind: 'profile',
        summary: copy.chore.nodeProfile(node.name),
        dueAt: null,
      });
      continue;
    }
    if (due(profile.renewsAt)) {
      out.push({
        id: `node-renew-${node.name}`,
        kind: 'renew',
        summary: copy.chore.nodeRenew(node.name, formatDate(profile.renewsAt)),
        dueAt: profile.renewsAt,
      });
    }
    const quota = profile.trafficQuotaBytes;
    const used = profile.trafficUsedBytes;
    if (quota !== null && quota > 0 && used !== null && used / quota >= NODE_QUOTA_CHORE) {
      out.push({
        id: `node-quota-${node.name}`,
        kind: 'quota',
        summary: copy.chore.nodeQuota(node.name, formatPercent(used / quota)),
        dueAt: profile.trafficCycleEnd,
      });
    }
  }
  return sortChores(out);
}

/** 到期、额度、缺资料 for the people. `mask` is the privacy toggle's email masker. */
export function customerChores(
  rows: readonly CustomerSummaryDto[],
  mask: (email: string) => string,
): Chore[] {
  const out: Chore[] = [];
  for (const row of rows) {
    const who = mask(row.email);
    if (due(row.expiresAt)) {
      out.push({
        id: `user-expiry-${row.userId}`,
        kind: 'expiry',
        summary: copy.chore.customerExpiry(who, formatDate(row.expiresAt)),
        dueAt: row.expiresAt,
      });
    }
    const quota = row.quotaBytes;
    const used = row.usageBytes.value;
    if (quota !== null && quota > 0 && row.usageBytes.asOfSec !== null && used / quota >= CUSTOMER_QUOTA_CHORE) {
      out.push({
        id: `user-quota-${row.userId}`,
        kind: 'quota',
        summary: copy.chore.customerQuota(who, formatPercent(used / quota)),
        dueAt: row.expiresAt,
      });
    }
    if (row.platforms.length === 0 || row.minAppVersion === null) {
      out.push({
        id: `user-profile-${row.userId}`,
        kind: 'profile',
        summary: copy.chore.customerProfile(who),
        dueAt: null,
      });
    }
  }
  return sortChores(out);
}

/** Dated chores first, soonest at the top; the undated ones sink to the bottom. */
export function sortChores(rows: readonly Chore[]): Chore[] {
  return [...rows].sort((a, b) => {
    if (a.dueAt === null && b.dueAt === null) return a.summary.localeCompare(b.summary, 'zh');
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt - b.dueAt;
  });
}
