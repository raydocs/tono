import type { JobStatus, JobType, NodeBindingsDto, NodeErrorRowDto, NodeLifecycle } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import { formatWhenAgo } from './display';

/**
 * What the action rail is allowed to do, and why a button is grey.
 *
 * The rules live here rather than in the rail so they can be read as a table
 * and tested as one. Every 不能按 has a sentence attached: a disabled button
 * with no reason is the thing that makes an operator reload the page and try
 * again, which on 重启 Xray is the worst possible response.
 */

export type NodeActionId =
  | 'unlist'
  | 'relist'
  | 'identitySync'
  | 'pullErrors'
  | 'restart'
  | 'probe'
  | 'retire';

export type NodeActionSpec = {
  id: NodeActionId;
  label: string;
  /**
   * The queue entry this button asks for, or `null` for 退役 — that one still
   * goes through the older preview-then-confirm pair, because it rewrites the
   * catalog rather than asking a machine to do something.
   */
  jobType: JobType | null;
  /** Runs on the machine itself, so the hub has to be able to reach it. */
  needsHub: boolean;
  /** Will not run until the node's name has been typed back at it. */
  destructive: boolean;
  /** One sentence, in what the customer will feel. Shown in the dialog. */
  consequence: string;
};

/** The rail, left to right. The read-only pair sits between the two halves. */
export const NODE_ACTIONS: readonly NodeActionSpec[] = [
  {
    id: 'unlist',
    label: copy.nodeActions.unlist,
    jobType: 'catalog_retire',
    needsHub: false,
    destructive: true,
    consequence: copy.nodeActionConsequence.unlist,
  },
  {
    id: 'relist',
    label: copy.nodeActions.relist,
    jobType: 'catalog_relist',
    needsHub: false,
    destructive: true,
    consequence: copy.nodeActionConsequence.relist,
  },
  {
    id: 'identitySync',
    label: copy.nodeActions.identitySync,
    jobType: 'identity_sync',
    needsHub: true,
    destructive: true,
    consequence: copy.nodeActionConsequence.identitySync,
  },
  {
    id: 'pullErrors',
    label: copy.nodeActions.pullErrors,
    jobType: 'xray_dial_errors',
    needsHub: true,
    destructive: false,
    consequence: copy.nodeActionConsequence.pullErrors,
  },
  {
    id: 'restart',
    label: copy.nodeActions.restart,
    jobType: 'xray_restart',
    needsHub: true,
    destructive: true,
    consequence: copy.nodeActionConsequence.restart,
  },
  {
    id: 'probe',
    label: copy.nodeActions.probe,
    jobType: 'node_probe',
    needsHub: true,
    destructive: false,
    consequence: copy.nodeActionConsequence.probe,
  },
  {
    id: 'retire',
    label: copy.nodeActions.retire,
    jobType: null,
    needsHub: false,
    destructive: true,
    consequence: copy.nodeActionConsequence.retire,
  },
];

export type NodeActionSubject = {
  lifecycle: NodeLifecycle;
  catalogListed: boolean | null;
  bindings: Pick<NodeBindingsDto, 'komari'>;
};

/**
 * Why this action cannot be taken on this node, or `null` when it can.
 *
 * `komari` is the stand-in for "the hub is talking to this machine": it is the
 * one binding that means an agent answered recently, so a node without it
 * cannot be asked to restart anything, and saying so up front beats queueing
 * work that will expire unleased fifteen minutes later.
 */
export function actionBlockReason(action: NodeActionSpec, node: NodeActionSubject): string | null {
  if (node.lifecycle === 'retired') return copy.nodeActionBlocked.retired;
  if (action.needsHub && !node.bindings.komari) return copy.nodeActionBlocked.hub;
  if (action.id === 'unlist' || action.id === 'retire') {
    if (node.catalogListed === null) return copy.nodeActionBlocked.unknownListing;
    if (node.catalogListed === false && action.id === 'unlist') return copy.nodeActionBlocked.notListed;
  }
  if (action.id === 'relist') {
    if (node.catalogListed === null) return copy.nodeActionBlocked.unknownListing;
    if (node.catalogListed === true) return copy.nodeActionBlocked.alreadyListed;
  }
  return null;
}

const CANCELLABLE: JobStatus[] = ['queued', 'leased'];

/** A job that is still waiting or still running can be called off; the rest cannot. */
export function canCancelJob(status: JobStatus): boolean {
  return CANCELLABLE.includes(status);
}

/**
 * Price with its unit, in whatever the 商家 charges. Two decimals at most, and
 * trailing zeros dropped: `5.5 $` rather than `5.50 $`, `12 €` rather than
 * `12.00 €`. A symbol goes in front, a three-letter code goes after — that is
 * how both are read out loud.
 */
export function formatMoney(price: number | null, currency: string | null): string | null {
  if (price === null || !Number.isFinite(price)) return null;
  const amount = String(Math.round(price * 100) / 100);
  if (!currency) return amount;
  return /^[A-Za-z]+$/.test(currency) ? `${amount} ${currency}` : `${currency}${amount}`;
}

/** 30 天, 365 天 — the billing period as the operator writes it on the invoice. */
export function formatBillingCycle(days: number | null): string | null {
  if (days === null || !Number.isFinite(days) || days <= 0) return null;
  return copy.nodeCycleDays(String(Math.round(days)));
}

/**
 * One bar's share of the tallest bar in the block, as a CSS length.
 *
 * It lives here rather than in the page because a page that computes a
 * percentage is a page that can print one, and the floor matters: a day with
 * one error must still draw something, or "quiet" and "one" look identical.
 */
export function barSize(value: number, max: number): string {
  if (max <= 0 || value <= 0) return '2px';
  return `${Math.max(8, Math.round((value / max) * 100))}%`;
}

/**
 * A date the operator is waiting for, in the direction it actually points.
 *
 * `formatWhenAgo` floors at zero, so a renewal three weeks out came back as
 * 刚刚 — the one reading that would let a node lapse unnoticed. Anything
 * already past falls back to it, because an expiry that has been and gone is
 * exactly a 天前.
 */
export function formatDeadline(value: number | null): string | null {
  if (value === null) return null;
  const seconds = value - nowSec();
  if (seconds < 0) return formatWhenAgo(value);
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return copy.nodeAhead.soon;
  if (hours < 24) return copy.nodeAhead.hours(String(hours));
  return copy.nodeAhead.days(String(Math.floor(hours / 24)));
}

export type ErrorCategory = {
  category: string;
  total: number;
  /** One entry per day in the range, oldest first, so the bars line up. */
  days: Array<{ dayAt: number; count: number }>;
  /** The newest line the machine actually printed, or nothing. */
  sample: string | null;
  sampleAt: number | null;
};

/**
 * The error rows arrive per day per category; the question the block answers
 * is "what is this machine complaining about, and is it getting worse", so
 * they are folded on category and sorted by how much of the noise each one is.
 */
export function foldErrors(rows: readonly NodeErrorRowDto[]): ErrorCategory[] {
  const byCategory = new Map<string, ErrorCategory>();
  for (const row of rows) {
    let found = byCategory.get(row.category);
    if (!found) {
      found = { category: row.category, total: 0, days: [], sample: null, sampleAt: null };
      byCategory.set(row.category, found);
    }
    found.total += row.count;
    found.days.push({ dayAt: row.dayAt, count: row.count });
    if (row.sample && (found.sampleAt === null || row.dayAt >= found.sampleAt)) {
      found.sample = row.sample;
      found.sampleAt = row.dayAt;
    }
  }
  const out = [...byCategory.values()];
  for (const entry of out) entry.days.sort((a, b) => a.dayAt - b.dayAt);
  return out.sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}
