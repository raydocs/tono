// 可售验收单，以及下架前谁还挂在这台机器上。

import type { SourceId } from './vocabulary';
import { SOURCE_IDS } from './vocabulary';
import {
  arrayOf,
  bool,
  fields,
  int,
  oneOf,
  optInt,
  optText,
  text,
  textList,
  violation,
} from './checkers';

/** Who still depends on a node that is about to leave the catalog. */
export interface RetireCustomerOnNodeDto {
  userId: string;
  email: string;
  lastSeenAt: number;
}

export interface RetireDependenciesDto {
  customersOnNode: RetireCustomerOnNodeDto[];
  defaultProxyBindings: number;
  exitTokenActive: boolean;
  lastRosterAt: number | null;
}

/**
 * Where one line of the 可售验收单 stands.
 *
 * `unknown` and `fail` are not the same answer and must never be collapsed:
 * "no customer has ever connected from 大陆" is a thing nobody has measured,
 * while "every customer who tried failed" is a thing that was measured and
 * came back bad. `pending` is the third: work is already queued that will
 * answer the question, so the operator should wait rather than override.
 */
export const ACCEPTANCE_STATES = ['pass', 'fail', 'unknown', 'pending'] as const;
export type AcceptanceState = (typeof ACCEPTANCE_STATES)[number];

/**
 * One check on the sheet, with the fact it was decided on.
 *
 * `evidence` is the sentence an operator can act on — never a rule name, and
 * never a number without its unit — and `source`/`asOfSec` say who measured it
 * and when, so a green tick from a sweep that last ran a week ago cannot read
 * as a green tick from this morning.
 */
export interface AcceptanceItemDto {
  key: string;
  label: string;
  state: AcceptanceState;
  evidence: string | null;
  asOfSec: number | null;
  source: SourceId;
}

/**
 * 这台机器能不能卖，以及还差什么.
 *
 * `blockers` is the item keys standing between this node and the catalog, so
 * `sellable === (blockers.length === 0)` — the checker enforces the pair,
 * because a sheet that says 可以上架 while listing three blockers is worse
 * than no sheet.
 */
export interface NodeAcceptanceDto {
  items: AcceptanceItemDto[];
  sellable: boolean;
  blockers: string[];
  asOfSec: number | null;
}

const RETIRE_CUSTOMER_KEYS = ['userId', 'email', 'lastSeenAt'];

export function assertRetireCustomerOnNode(value: unknown, path = 'retireCustomer'): RetireCustomerOnNodeDto {
  const row = fields(value, path, RETIRE_CUSTOMER_KEYS);
  return {
    userId: text(row, path, 'userId'),
    email: text(row, path, 'email'),
    lastSeenAt: int(row, path, 'lastSeenAt'),
  };
}

const RETIRE_DEPENDENCIES_KEYS = [
  'customersOnNode', 'defaultProxyBindings', 'exitTokenActive', 'lastRosterAt',
];

export function assertRetireDependencies(value: unknown, path = 'retireDependencies'): RetireDependenciesDto {
  const row = fields(value, path, RETIRE_DEPENDENCIES_KEYS);
  return {
    customersOnNode: arrayOf(row, path, 'customersOnNode', assertRetireCustomerOnNode),
    defaultProxyBindings: int(row, path, 'defaultProxyBindings'),
    exitTokenActive: bool(row, path, 'exitTokenActive'),
    lastRosterAt: optInt(row, path, 'lastRosterAt'),
  };
}

const ACCEPTANCE_ITEM_KEYS = ['key', 'label', 'state', 'evidence', 'asOfSec', 'source'];

export function assertAcceptanceItem(value: unknown, path = 'acceptanceItem'): AcceptanceItemDto {
  const row = fields(value, path, ACCEPTANCE_ITEM_KEYS);
  const asOfSec = optInt(row, path, 'asOfSec');
  // Same rule as `Measured`: a zero here reads as "measured in 1970".
  if (asOfSec !== null && asOfSec <= 0) violation(`${path}.asOfSec`);
  return {
    key: text(row, path, 'key'),
    label: text(row, path, 'label'),
    state: oneOf<AcceptanceState>(row, path, 'state', ACCEPTANCE_STATES),
    evidence: optText(row, path, 'evidence'),
    asOfSec,
    source: oneOf<SourceId>(row, path, 'source', SOURCE_IDS),
  };
}

const ACCEPTANCE_KEYS = ['items', 'sellable', 'blockers', 'asOfSec'];

export function assertNodeAcceptance(value: unknown, path = 'nodeAcceptance'): NodeAcceptanceDto {
  const row = fields(value, path, ACCEPTANCE_KEYS);
  const items = arrayOf(row, path, 'items', assertAcceptanceItem);
  const blockers = textList(row, path, 'blockers');
  const sellable = bool(row, path, 'sellable');
  const asOfSec = optInt(row, path, 'asOfSec');
  if (asOfSec !== null && asOfSec <= 0) violation(`${path}.asOfSec`);
  const keys = new Set(items.map((item) => item.key));
  if (keys.size !== items.length) violation(`${path}.items`);
  // A blocker nobody can point at on the sheet, or a verdict that disagrees
  // with its own list, is a bug on the far side rather than a page to render.
  for (const key of blockers) if (!keys.has(key)) violation(`${path}.blockers`);
  if (sellable !== (blockers.length === 0)) violation(`${path}.sellable`);
  return { items, sellable, blockers, asOfSec };
}
