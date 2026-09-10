// Ledger, month close, and FX rates. Frozen in docs/ops/billing-model-proposal.md §6.

import {
  arrayOf,
  assertList,
  bool,
  fields,
  int,
  num,
  oneOf,
  optInt,
  optNum,
  optText,
  text,
  textList,
} from './checkers';

export const LEDGER_KINDS = ['revenue', 'refund', 'credit', 'cost'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_CATEGORIES = [
  'plan', 'server', 'home_line', 'domain', 'control_plane',
  'claude_account', 'chatgpt_account', 'other',
] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

export const LEDGER_SUBJECT_TYPES = ['user', 'node', 'home_exit', 'account', 'fleet'] as const;
export type LedgerSubjectType = (typeof LEDGER_SUBJECT_TYPES)[number];

export const FX_SOURCES = ['frankfurter'] as const;
export type FxSource = (typeof FX_SOURCES)[number];

export interface LedgerEntryDto {
  id: string;
  kind: LedgerKind;
  category: LedgerCategory;
  subjectType: LedgerSubjectType;
  subjectId: string | null;
  amountMinor: number;
  currency: string;
  fxRateToCny: number | null;
  fxDate: string | null;
  cnyMinor: number;
  month: string;
  paidAt: number | null;
  note: string | null;
  reverses: string | null;
  reversedBy: string | null;
  createdBy: string | null;
  createdAt: number;
}

export interface MonthCustomerDto {
  userId: string;
  email: string;
  revenueCnyMinor: number;
  costCnyMinor: number;
  marginCnyMinor: number | null;
  pending: boolean;
}

export interface MonthNodeDto {
  name: string;
  costCnyMinor: number;
  bytes: number;
  cnyPerGbMinor: number | null;
  pending: boolean;
}

/**
 * Why a subject sits on one side of the month's reconciliation and not the
 * other. A row without a reason is a row nobody can act on.
 */
export const RECON_REASONS = ['no_ledger', 'unknown_subject', 'retired_subject', 'no_price'] as const;
export type ReconReason = (typeof RECON_REASONS)[number];

/** `fleet` never reconciles: it is a bill with no single asset behind it. */
export const RECON_SUBJECT_TYPES = ['node', 'home_exit', 'account'] as const;
export type ReconSubjectType = (typeof RECON_SUBJECT_TYPES)[number];

export interface MonthReconRowDto {
  subjectType: ReconSubjectType;
  subjectId: string;
  /** catalog_name / home line display name / account_ref. */
  label: string;
  category: LedgerCategory;
  /** `product_accounts.user_id` for accounts, else null. */
  ownerUserId: string | null;
  /** Asset price in its own currency; null when the asset carries no price. */
  expectedMinor: number | null;
  expectedCurrency: string | null;
  /** Net cost entries for this subject in the month; null on the bill-only side. */
  ledgerCnyMinor: number | null;
  entryIds: string[];
  reason: ReconReason;
}

export interface MonthReconciliationDto {
  /** 账单有台账没有. */
  billsWithoutLedger: MonthReconRowDto[];
  /** 台账有账单没有. */
  ledgerWithoutBill: MonthReconRowDto[];
  asOfSec: number;
}

export type MonthByCategory = Record<LedgerCategory, number>;

export interface MonthSummaryDto {
  month: string;
  closedAt: number | null;
  closedBy: string | null;
  revenueCnyMinor: number;
  costCnyMinor: number;
  marginCnyMinor: number;
  byCategory: MonthByCategory;
  customers: MonthCustomerDto[];
  nodes: MonthNodeDto[];
  unreconciled: number;
  frozen: boolean;
  frozenAt: number | null;
  /** Optional on the wire (org plan v2 §0.3); the Worker always sends both. */
  reconciliation?: MonthReconciliationDto;
  /** How many bills and orphan ledger rows are still unpaired this month. */
  unreconciledBills?: number;
  updatedAt: number;
}

export interface FxRateDto {
  day: string;
  base: string;
  quote: 'CNY';
  rate: number;
  fetchedAt: number;
  source: FxSource;
}

const ENTRY_KEYS = [
  'id', 'kind', 'category', 'subjectType', 'subjectId', 'amountMinor', 'currency',
  'fxRateToCny', 'fxDate', 'cnyMinor', 'month', 'paidAt', 'note',
  'reverses', 'reversedBy', 'createdBy', 'createdAt',
];

export function assertLedgerEntry(value: unknown, path = 'ledgerEntry'): LedgerEntryDto {
  const row = fields(value, path, ENTRY_KEYS);
  return {
    id: text(row, path, 'id'),
    kind: oneOf<LedgerKind>(row, path, 'kind', LEDGER_KINDS),
    category: oneOf<LedgerCategory>(row, path, 'category', LEDGER_CATEGORIES),
    subjectType: oneOf<LedgerSubjectType>(row, path, 'subjectType', LEDGER_SUBJECT_TYPES),
    subjectId: optText(row, path, 'subjectId'),
    amountMinor: int(row, path, 'amountMinor'),
    currency: text(row, path, 'currency'),
    fxRateToCny: optNum(row, path, 'fxRateToCny'),
    fxDate: optText(row, path, 'fxDate'),
    cnyMinor: int(row, path, 'cnyMinor'),
    month: text(row, path, 'month'),
    paidAt: optInt(row, path, 'paidAt'),
    note: optText(row, path, 'note'),
    reverses: optText(row, path, 'reverses'),
    reversedBy: optText(row, path, 'reversedBy'),
    createdBy: optText(row, path, 'createdBy'),
    createdAt: int(row, path, 'createdAt'),
  };
}

export const assertLedgerEntryList = (value: unknown) => assertList(value, assertLedgerEntry);

const CUSTOMER_KEYS = [
  'userId', 'email', 'revenueCnyMinor', 'costCnyMinor', 'marginCnyMinor', 'pending',
];

export function assertMonthCustomer(value: unknown, path = 'monthCustomer'): MonthCustomerDto {
  const row = fields(value, path, CUSTOMER_KEYS);
  return {
    userId: text(row, path, 'userId'),
    email: text(row, path, 'email'),
    revenueCnyMinor: int(row, path, 'revenueCnyMinor'),
    costCnyMinor: int(row, path, 'costCnyMinor'),
    marginCnyMinor: optInt(row, path, 'marginCnyMinor'),
    pending: bool(row, path, 'pending'),
  };
}

const NODE_KEYS = ['name', 'costCnyMinor', 'bytes', 'cnyPerGbMinor', 'pending'];

export function assertMonthNode(value: unknown, path = 'monthNode'): MonthNodeDto {
  const row = fields(value, path, NODE_KEYS);
  return {
    name: text(row, path, 'name'),
    costCnyMinor: int(row, path, 'costCnyMinor'),
    bytes: int(row, path, 'bytes'),
    cnyPerGbMinor: optInt(row, path, 'cnyPerGbMinor'),
    pending: bool(row, path, 'pending'),
  };
}

function assertByCategory(value: unknown, path: string): MonthByCategory {
  const row = fields(value, path, LEDGER_CATEGORIES);
  const out = {} as MonthByCategory;
  for (const key of LEDGER_CATEGORIES) out[key] = int(row, path, key);
  return out;
}

const RECON_ROW_KEYS = [
  'subjectType', 'subjectId', 'label', 'category', 'ownerUserId',
  'expectedMinor', 'expectedCurrency', 'ledgerCnyMinor', 'entryIds', 'reason',
];

export function assertMonthReconRow(value: unknown, path = 'monthReconRow'): MonthReconRowDto {
  const row = fields(value, path, RECON_ROW_KEYS);
  return {
    subjectType: oneOf<ReconSubjectType>(row, path, 'subjectType', RECON_SUBJECT_TYPES),
    subjectId: text(row, path, 'subjectId'),
    label: text(row, path, 'label'),
    category: oneOf<LedgerCategory>(row, path, 'category', LEDGER_CATEGORIES),
    ownerUserId: optText(row, path, 'ownerUserId'),
    expectedMinor: optInt(row, path, 'expectedMinor'),
    expectedCurrency: optText(row, path, 'expectedCurrency'),
    ledgerCnyMinor: optInt(row, path, 'ledgerCnyMinor'),
    entryIds: textList(row, path, 'entryIds'),
    reason: oneOf<ReconReason>(row, path, 'reason', RECON_REASONS),
  };
}

const RECONCILIATION_KEYS = ['billsWithoutLedger', 'ledgerWithoutBill', 'asOfSec'];

export function assertMonthReconciliation(
  value: unknown,
  path = 'monthReconciliation',
): MonthReconciliationDto {
  const row = fields(value, path, RECONCILIATION_KEYS);
  return {
    billsWithoutLedger: arrayOf(row, path, 'billsWithoutLedger', assertMonthReconRow),
    ledgerWithoutBill: arrayOf(row, path, 'ledgerWithoutBill', assertMonthReconRow),
    asOfSec: int(row, path, 'asOfSec'),
  };
}

const SUMMARY_KEYS = [
  'month', 'closedAt', 'closedBy', 'revenueCnyMinor', 'costCnyMinor', 'marginCnyMinor',
  'byCategory', 'customers', 'nodes', 'unreconciled', 'frozen', 'frozenAt',
  'reconciliation', 'unreconciledBills', 'updatedAt',
];

export function assertMonthSummary(value: unknown, path = 'monthSummary'): MonthSummaryDto {
  const row = fields(value, path, SUMMARY_KEYS);
  return {
    month: text(row, path, 'month'),
    closedAt: optInt(row, path, 'closedAt'),
    closedBy: optText(row, path, 'closedBy'),
    revenueCnyMinor: int(row, path, 'revenueCnyMinor'),
    costCnyMinor: int(row, path, 'costCnyMinor'),
    marginCnyMinor: int(row, path, 'marginCnyMinor'),
    byCategory: assertByCategory(row.byCategory, `${path}.byCategory`),
    customers: arrayOf(row, path, 'customers', assertMonthCustomer),
    nodes: arrayOf(row, path, 'nodes', assertMonthNode),
    unreconciled: int(row, path, 'unreconciled'),
    frozen: bool(row, path, 'frozen'),
    frozenAt: optInt(row, path, 'frozenAt'),
    ...(row.reconciliation === undefined ? {} : {
      reconciliation: assertMonthReconciliation(row.reconciliation, `${path}.reconciliation`),
    }),
    ...(row.unreconciledBills === undefined ? {} : { unreconciledBills: int(row, path, 'unreconciledBills') }),
    updatedAt: int(row, path, 'updatedAt'),
  };
}

const FX_KEYS = ['day', 'base', 'quote', 'rate', 'fetchedAt', 'source'];

export function assertFxRate(value: unknown, path = 'fxRate'): FxRateDto {
  const row = fields(value, path, FX_KEYS);
  const quote = oneOf(row, path, 'quote', ['CNY'] as const);
  return {
    day: text(row, path, 'day'),
    base: text(row, path, 'base'),
    quote,
    rate: num(row, path, 'rate'),
    fetchedAt: int(row, path, 'fetchedAt'),
    source: oneOf<FxSource>(row, path, 'source', FX_SOURCES),
  };
}
