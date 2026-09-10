import type { CustomerSummaryDto, FunnelDto, FunnelRowDto, FunnelStage } from '@contract';
import { FUNNEL_STAGES } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';

const DAY = 86_400;

/**
 * How long somebody has to be stuck before it is a thing to do.
 *
 * Three days is the hub's own threshold for the `onboarding` chore, and the
 * console derives the invite half with the same number: a list where the two
 * halves used different windows would show one person from Tuesday and hide
 * another from the same afternoon.
 */
export const STUCK_DAYS = 3;

/**
 * One row of the 客户 table: somebody with an account, or somebody who was
 * opened and never registered.
 *
 * They share a table because they are the same question — who is this person
 * and what do I owe them — and they cannot share a type, because an invite has
 * no verdict, no devices and no page of its own. The union keeps the columns
 * honest: every cell has to say what it shows for a row that has no account.
 */
export type ListRow =
  | { key: string; customer: CustomerSummaryDto; invite: null }
  | { key: string; customer: null; invite: FunnelRowDto };

/** The people on the funnel who have no `users` row at all. */
export function invitesOf(funnel: FunnelDto | null): FunnelRowDto[] {
  if (funnel === null) return [];
  return funnel.items.filter((row) => row.userId === null);
}

/**
 * The table's rows, customers first.
 *
 * Only the invites are taken from the funnel: everybody else on it already has
 * a customer row carrying the same `stage`, and adding them twice would count
 * them twice — the 高丢包 2 / 高丢包 8 bug with a different name.
 */
export function listRows(
  customers: readonly CustomerSummaryDto[],
  invites: readonly FunnelRowDto[],
): ListRow[] {
  return [
    ...customers.map((customer) => ({ key: customer.userId, customer, invite: null as null })),
    ...invites.map((invite) => ({ key: invite.key, customer: null as null, invite })),
  ];
}

export function stageOf(row: ListRow): FunnelStage {
  return row.customer === null ? row.invite.stage : row.customer.stage;
}

export function stageSinceOf(row: ListRow): number {
  return row.customer === null ? row.invite.stageSinceAt : row.customer.stageSinceAt;
}

export function emailOf(row: ListRow): string {
  return row.customer === null ? row.invite.email : row.customer.email;
}

export function wechatOf(row: ListRow): string | null {
  return row.customer === null ? row.invite.wechatId : row.customer.wechatId;
}

/**
 * R4 for the funnel bar: the segment and the rows it filters to are the same
 * predicate, called from `stageCounts` and from the table with one id.
 */
export function selectByStage(rows: readonly ListRow[], stage: FunnelStage | null): ListRow[] {
  if (stage === null) return [...rows];
  return rows.filter((row) => stageOf(row) === stage);
}

export function stageCounts(rows: readonly ListRow[]): Record<FunnelStage, number> {
  const out = {} as Record<FunnelStage, number>;
  for (const stage of FUNNEL_STAGES) out[stage] = selectByStage(rows, stage).length;
  return out;
}

/** Whole days since a stamp, floored — 23 hours of being stuck is not a day. */
export function daysSince(at: number, now = nowSec()): number {
  return Math.max(0, Math.floor((now - at) / DAY));
}

/**
 * The one sentence a stuck row is worth: which step, and how long ago.
 *
 * 上报过还没连上 carries no day count on purpose — the client reported once and
 * has said nothing since, so "stuck for five days" would be a number the
 * console cannot stand behind.
 */
export function stageSentence(stage: FunnelStage, since: number, now = nowSec()): string {
  const days = daysSince(since, now);
  const said = copy.funnelLine;
  if (stage === 'invited') return said.invited(days);
  if (stage === 'registered') return said.registered(days);
  if (stage === 'device_added') return said.device_added(days);
  if (stage === 'reported') return said.reported();
  return said.connected();
}

/** Whether this row has been standing on the same step long enough to chase. */
export function stuck(since: number, now = nowSec()): boolean {
  return daysSince(since, now) >= STUCK_DAYS;
}
