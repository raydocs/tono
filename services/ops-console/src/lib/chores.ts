import type { CustomerSummaryDto, FunnelRowDto, Platform } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import { formatDate, formatPercent } from './display';
import { stageSentence, STUCK_DAYS, stuck } from './funnel';
import { compareVersions } from './releases';
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
  /**
   * Who the chore is about, on the chores that are about reaching a person.
   *
   * 待办 used to be a sentence and a date, which is enough for a renewal and
   * not enough for an onboarding: chasing somebody means having their handle
   * on the row and a way into their page. `userId` is null for an address that
   * was opened and never registered — there is no 360 to open, so the row goes
   * to the invite instead.
   */
  who?: { userId: string | null; email: string; wechatId: string | null };
};

const DAY = 86_400;
/** Two weeks: long enough to buy a renewal, short enough not to be wallpaper. */
const SOON = 14 * DAY;
/** When an onboarding fell due: the day the person had been stuck three days. */
const STUCK = STUCK_DAYS * DAY;
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

/**
 * 到期、额度、版本过旧、缺资料 for the people.
 *
 * `mask` is the privacy toggle's email masker. `minSupported` is the floor
 * each platform's newest published release still serves: a client below it is
 * a thing to do, not an incident — nothing is broken, and nobody gets cut off
 * for being old. A customer on several platforms is listed once, against the
 * first floor their oldest version falls under, because the chore is about
 * the person and one row per platform would triple the list for one problem.
 */
export function customerChores(
  rows: readonly CustomerSummaryDto[],
  mask: (email: string) => string,
  minSupported: Partial<Record<Platform, string>> = {},
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
    const stale = tooOld(row, minSupported);
    if (stale !== null) {
      out.push({
        id: `user-version-${row.userId}`,
        kind: 'version',
        summary: copy.chore.customerVersion(who, stale),
        dueAt: null,
      });
    }
    /**
     * 还没用起来 is a thing to do, not a fault, so it arrives here rather than
     * in the incident list — and it is dated at the day it became one, which
     * puts the person who has been waiting longest at the top and gets the
     * chore into 今天必须做 rather than leaving it undated at the bottom.
     */
    if (row.stage !== 'connected' && stuck(row.stageSinceAt)) {
      out.push({
        id: `onboarding:${row.userId}`,
        kind: 'onboarding',
        summary: copy.onboardChore(who, stageSentence(row.stage, row.stageSinceAt)),
        dueAt: row.stageSinceAt + STUCK,
        who: { userId: row.userId, email: row.email, wechatId: row.wechatId },
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

/**
 * The people who were opened and never registered, as chores.
 *
 * They have no customer row for `customerChores` to walk, and they are the
 * half of the funnel most likely to be forgotten: nobody has an account to
 * stumble over, so the only place they can appear is here. Same three-day
 * window as the registered half, same masked address, same id shape.
 */
export function inviteChores(
  invites: readonly FunnelRowDto[],
  mask: (email: string) => string,
): Chore[] {
  const out: Chore[] = [];
  for (const row of invites) {
    if (!stuck(row.stageSinceAt)) continue;
    out.push({
      id: `onboarding:${row.key}`,
      kind: 'onboarding',
      summary: copy.onboardChore(mask(row.email), stageSentence(row.stage, row.stageSinceAt)),
      dueAt: row.stageSinceAt + STUCK,
      who: { userId: null, email: row.email, wechatId: row.wechatId },
    });
  }
  return sortChores(out);
}

/**
 * The version this customer is running, if it is under a floor one of their
 * platforms has set. Null when nothing is too old — or when nothing has been
 * reported, which is 缺资料 rather than 版本过旧.
 */
function tooOld(
  row: CustomerSummaryDto,
  minSupported: Partial<Record<Platform, string>>,
): string | null {
  const running = row.minAppVersion;
  if (running === null) return null;
  for (const platform of row.platforms) {
    const floor = minSupported[platform];
    if (floor && compareVersions(running, floor) < 0) return running;
  }
  return null;
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
