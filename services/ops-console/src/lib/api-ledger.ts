import type { ListDto } from '@contract';
import { urlFor } from './api';
import { send } from './api-customer-actions';
import { readAccounts, type ProductAccount } from './customers-legacy';

/**
 * 账目's half of the wire, in the shape `docs/ops/billing-model-proposal.md`
 * §6 freezes. The Worker is building the other side against the same list, so
 * every field here is that list and nothing more.
 *
 * The requests go through the customer actions' `send` rather than `api.ts`
 * for the reason that file already gives: a refusal has to keep its status and
 * its code. This page has to tell `FX_RATE_MISSING` — the day's rate is simply
 * not fetched yet, and the operator can wait or move the date — apart from a
 * month that is locked, and `Error(message)` alone cannot.
 *
 * All amounts are integers in the currency's smallest unit. A float would put
 * the operator's monthly total a cent out somewhere around the eighth entry,
 * and the whole point of this page is that it agrees with a bank statement.
 */

export const LEDGER_KINDS = ['revenue', 'refund', 'credit', 'cost'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_CATEGORIES = [
  'plan', 'server', 'home_line', 'domain',
  'control_plane', 'claude_account', 'chatgpt_account', 'other',
] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

export type LedgerSubjectType = 'user' | 'node' | 'home_exit' | 'account' | 'fleet';

/** The six the operator actually pays bills in; the rate table carries the rest. */
export const LEDGER_CURRENCIES = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD'] as const;
export type LedgerCurrency = (typeof LEDGER_CURRENCIES)[number];

export type LedgerEntryDto = {
  id: string;
  kind: LedgerKind;
  category: LedgerCategory;
  subjectType: LedgerSubjectType;
  subjectId: string | null;
  amountMinor: number;
  currency: string;
  /** What one unit of `currency` was worth in CNY on `fxDate`; 1 for CNY itself. */
  fxRateToCny: number;
  fxDate: string | null;
  cnyMinor: number;
  month: string;
  paidAt: number | null;
  note: string | null;
  /** The entry this one reverses, and the one that reversed it. Never both. */
  reverses: string | null;
  reversedBy: string | null;
  createdBy: string | null;
  createdAt: number;
};

export type MonthCustomerRow = {
  userId: string;
  email: string;
  revenueCnyMinor: number;
  costCnyMinor: number;
  /** Null when a machine they sit on is not reconciled: 待核对, never a number. */
  marginCnyMinor: number | null;
  pending: boolean;
};

export type MonthNodeRow = {
  name: string;
  costCnyMinor: number;
  bytes: number | null;
  /** Yuan per GB, not minor units — the contract spells `Minor` where it means it. */
  cnyPerGbMinor: number | null;
  pending: boolean;
};

export type MonthSummaryDto = {
  month: string;
  closedAt: number | null;
  closedBy: string | null;
  revenueCnyMinor: number;
  costCnyMinor: number;
  marginCnyMinor: number;
  byCategory: Partial<Record<LedgerCategory, number>>;
  customers: MonthCustomerRow[];
  nodes: MonthNodeRow[];
  unreconciled: number;
  updatedAt: number;
};

export type FxRateDto = {
  day: string;
  base: string;
  quote: 'CNY';
  rate: number;
  fetchedAt: number;
  source: string;
};

/** What `POST ledger` accepts. The Worker fills in the rate, the date and the CNY. */
export type LedgerEntryInput = {
  kind: LedgerKind;
  category: LedgerCategory;
  subjectType: LedgerSubjectType;
  subjectId: string | null;
  amountMinor: number;
  currency: string;
  month: string;
  paidAt: number | null;
  note: string | null;
};

/** The refusal the drawer has a sentence for: no rate for that day yet. */
export const FX_RATE_MISSING = 'FX_RATE_MISSING';

/**
 * The hub's word for a field it will not take.
 *
 * `POST ledger` answers 400 with this when money coming in is written in
 * anything but yuan. The drawer never sends one — the field is locked — so the
 * only way it arrives is the two sides disagreeing about which kinds are
 * yuan-only, and the operator is owed the sentence the field already carries
 * rather than a message written for whoever is fixing the drift.
 */
export const VALIDATION_ERROR = 'VALIDATION_ERROR';

const path = (...parts: string[]) => parts.map(encodeURIComponent).join('/');

const asEntry = (value: unknown) => value as LedgerEntryDto;
const asMonth = (value: unknown) => value as MonthSummaryDto;

export const ledgerApi = {
  entries: (month: string, signal?: AbortSignal) =>
    send<ListDto<LedgerEntryDto>>(
      'GET',
      'ledger',
      undefined,
      (value) => value as ListDto<LedgerEntryDto>,
      { signal, query: { month } },
    ),

  month: (month: string, signal?: AbortSignal) =>
    send<MonthSummaryDto>('GET', path('months', month), undefined, asMonth, { signal }),

  /** The rate for one day, or a refusal saying it has not been fetched yet. */
  fx: (day: string, base: string, signal?: AbortSignal) =>
    send<FxRateDto>(
      'GET',
      'fx',
      undefined,
      (value) => value as FxRateDto,
      { signal, query: { day, base } },
    ),

  create: (input: LedgerEntryInput) => send<LedgerEntryDto>('POST', 'ledger', input, asEntry),

  /** The only edit a written entry allows, and only while the month is open. */
  editNote: (id: string, note: string) =>
    send<LedgerEntryDto>('PATCH', path('ledger', id), { note }, asEntry),

  reverse: (id: string) =>
    send<LedgerEntryDto>('POST', `${path('ledger', id)}/reverse`, {}, asEntry),

  close: (month: string) =>
    send<MonthSummaryDto>('POST', `${path('months', month)}/close`, {}, asMonth),

  /** Every account the two AI categories can be billed to, assigned or pooled. */
  productAccounts: (signal?: AbortSignal): Promise<ProductAccount[]> =>
    send('GET', 'product-accounts', undefined, readAccounts, { signal }),

  /** The month as a file. A link, not a fetch: the browser saves it. */
  exportHref: (month: string): string => urlFor(`${path('months', month)}/export.csv`),
};
