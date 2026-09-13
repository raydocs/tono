import type {
  AcceptanceItemDto,
  AcceptanceState,
  JobStatus,
  JobType,
  NodeAcceptanceDto,
  NodeBindingsDto,
  NodeErrorRowDto,
  NodeLifecycle,
  NodeVerdict,
  Tone,
} from '@contract';
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
  /**
   * 仍要上架 only. The Worker refuses a relist its 可售验收单 says is not
   * sellable; this sends `override: true`, which lets it through and writes the
   * blockers it went past into the audit log.
   */
  override?: boolean;
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

/* -------------------------------------------------------------- 可售验收 */

/**
 * The colour of one line of the sheet.
 *
 * 已核 stays neutral rather than green: twelve green ticks is the picture that
 * taught everyone to stop reading the sheet, and the only lines worth a colour
 * are the ones asking for work. `unknown` is grey for the same reason a source
 * nobody wired up is grey — it is a gap, not an alarm (R5).
 */
const ACCEPTANCE_TONE: Record<AcceptanceState, Tone> = {
  pass: 'ok',
  fail: 'sev',
  unknown: 'unk',
  pending: 'info',
};

export function acceptanceTone(state: AcceptanceState): Tone {
  return ACCEPTANCE_TONE[state];
}

/**
 * The sheet in reading order: what is stopping 上架 first, then everything
 * else in the order the Worker wrote it.
 *
 * An operator opening this page has one question, and scrolling past nine
 * ticks to find the two lines that matter is how they learn to stop opening
 * it. The Worker's own order is kept inside each half so the sheet does not
 * reshuffle itself between two visits.
 */
export function orderedAcceptance(sheet: NodeAcceptanceDto): AcceptanceItemDto[] {
  const blocking = new Set(sheet.blockers);
  return [
    ...sheet.items.filter((item) => blocking.has(item.key)),
    ...sheet.items.filter((item) => !blocking.has(item.key)),
  ];
}

/** The blocker keys read back as the labels the sheet shows them under. */
export function blockerLabels(sheet: NodeAcceptanceDto): string[] {
  const byKey = new Map(sheet.items.map((item) => [item.key, item.label]));
  return sheet.blockers.map((key) => byKey.get(key) ?? key);
}

/**
 * 仍要上架, built from the sheet it is overriding.
 *
 * It is not in `NODE_ACTIONS` because it only exists while a specific machine
 * is failing specific checks, and its consequence names them: a confirmation
 * that says "这会上架" without repeating what is being waived is the dialog
 * that gets clicked through.
 */
export function overrideRelistAction(sheet: NodeAcceptanceDto): NodeActionSpec {
  const base = NODE_ACTIONS.find((action) => action.id === 'relist')!;
  return {
    ...base,
    label: copy.nodeAcceptanceOverride,
    override: true,
    consequence: copy.nodeAcceptanceOverrideLead(blockerLabels(sheet)) + copy.nodeActionConsequence.relist,
  };
}

/**
 * Why this action cannot be taken on this node, or `null` when it can.
 *
 * `komari` is the stand-in for "the hub is talking to this machine": it is the
 * one binding that means an agent answered recently, so a node without it
 * cannot be asked to restart anything, and saying so up front beats queueing
 * work that will expire unleased fifteen minutes later.
 */
export function actionBlockReason(
  action: NodeActionSpec,
  node: NodeActionSubject,
  /** The 可售验收单, or `null` while it has not been read back yet. */
  sheet?: NodeAcceptanceDto | null,
): string | null {
  if (node.lifecycle === 'retired') return copy.nodeActionBlocked.retired;
  if (action.needsHub && !node.bindings.komari) return copy.nodeActionBlocked.hub;
  if (action.id === 'unlist' || action.id === 'retire') {
    if (node.catalogListed === null) return copy.nodeActionBlocked.unknownListing;
    if (node.catalogListed === false && action.id === 'unlist') return copy.nodeActionBlocked.notListed;
  }
  if (action.id === 'relist') {
    if (node.catalogListed === null) return copy.nodeActionBlocked.unknownListing;
    if (node.catalogListed === true) return copy.nodeActionBlocked.alreadyListed;
    // 上架 is the one action the Worker refuses on its own reading of the
    // sheet, so the button says the same thing here rather than letting the
    // operator find out from a 409.
    if (sheet === undefined || sheet === null) return copy.nodeActionBlocked.acceptanceUnread;
    if (!sheet.sellable) {
      return copy.nodeActionBlocked.notSellable(String(sheet.blockers.length), blockerLabels(sheet));
    }
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

/* ------------------------------------------- 这台机器: typed in, not measured */

/** An empty box means "there is none", which is a value and not a blank. */
export function textOrNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

export function numberOrNull(value: string): number | null {
  const text = value.trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const GB = 1000 ** 3;

/**
 * The allowance is typed in GB because that is the number on the invoice, and
 * in the 商家's GB — a terabyte plan is a thousand of these, not 1024.
 */
export function gbToBytes(value: string): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.round(parsed * GB);
}

export function bytesToGb(value: number | null): string {
  if (value === null) return '';
  return String(Math.round(value / GB));
}

/**
 * Line tags as they are read out loud, separated by whichever mark was to
 * hand. Not whitespace: `CN2 GIA` is one tag, and splitting on the space in it
 * turned one confirmed line into two labels that mean nothing.
 */
export function parseLineTags(value: string): string[] {
  return value
    .split(/[,，、·]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * Which day of the month the counter turns over on, read back off the cycle
 * the meter is already using. The contract carries the cycle's start rather
 * than the anchor day, so the form recovers the day from it and falls back to
 * the first — a machine with no cycle yet has no anchor to preserve.
 */
export function anchorDayOf(cycleStart: number | null): string {
  if (cycleStart === null) return '1';
  return String(new Date(cycleStart * 1_000).getDate());
}

/** A token the engine wrote, not a sentence a person did: `carrier_loss`, `ok`. */
function isToken(reason: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(reason);
}

const REASON_SENTENCES: Record<string, string> = copy.nodeReason;

/**
 * 凭什么, or nothing at all.
 *
 * Three cases, and the third is the one production got wrong. A healthy
 * machine has no reason worth a line — the engine still writes `ok` there, and
 * printing it put a raw token under the one word on the page that was already
 * saying 正常. A non-ok verdict usually carries a sentence, which travels
 * unchanged. And when it carries a bare token instead, it is translated here or
 * dropped: an operator can act on "回程丢包偏高" and cannot act on
 * `carrier_loss`.
 */
export function reasonSentence(verdict: NodeVerdict, reason: string | null): string | null {
  if (verdict === 'ok' || !reason) return null;
  const trimmed = reason.trim();
  if (trimmed === '') return null;
  if (!isToken(trimmed)) return trimmed;
  return REASON_SENTENCES[trimmed] ?? null;
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
