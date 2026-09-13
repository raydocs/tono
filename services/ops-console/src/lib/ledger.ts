import { copy } from '@/copy/copy';
import type {
  LedgerCategory,
  LedgerCurrency,
  LedgerEntryDto,
  LedgerKind,
  LedgerSubjectType,
  MonthCustomerRow,
  MonthNodeRow,
  MonthSummaryDto,
} from './api-ledger';

/**
 * The arithmetic and the wording behind 账目, kept out of the page.
 *
 * Money is held as integers in the currency's smallest unit everywhere, and
 * turned into text in exactly one place — here — so the page never divides by
 * a hundred on its own. The one currency that is not two decimals is the one
 * that catches every implementation out: a yen is its own smallest unit, so
 * `1000` is ¥1000 and not ¥10.00, and `DECIMALS` is why an entry pasted off a
 * Japanese invoice does not land a hundred times too small.
 */

const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Currencies whose smallest unit is not a hundredth. */
const DECIMALS: Record<string, number> = { JPY: 0, KRW: 0 };

export function decimalsOf(currency: string): number {
  return DECIMALS[currency.toUpperCase()] ?? 2;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Which month an instant falls in, in the operator's own timezone.
 *
 * Local rather than UTC for the same reason the expiry fields are local: the
 * first of the month on a bank statement is the first of the month here, and a
 * UTC round trip moves eight hours of every month into the one before it.
 */
export function monthOf(seconds: number): string {
  const date = new Date(seconds * 1_000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function dayOf(seconds: number): string {
  const date = new Date(seconds * 1_000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

/** The month a day belongs to; an unparseable day belongs to none. */
export function monthFromDay(day: string): string | null {
  const match = DAY.exec(day.trim());
  return match === null ? null : `${match[1]}-${match[2]}`;
}

export function shiftMonth(month: string, delta: number): string {
  const match = MONTH.exec(month);
  if (!match) return month;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** The months an operator might still be writing into: this one and the year before it. */
export function monthChoices(seconds: number, count = 13): string[] {
  const here = monthOf(seconds);
  const out: string[] = [];
  for (let step = 0; step < count; step += 1) out.push(shiftMonth(here, -step));
  return out;
}

export function monthWords(month: string): string {
  const match = MONTH.exec(month);
  if (!match) return month;
  return copy.ledger.monthName(match[1], String(Number(match[2])));
}

/* ------------------------------------------------------------------ money */

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function minorText(minor: number, decimals: number): string {
  const negative = minor < 0;
  const whole = Math.abs(Math.round(minor));
  const unit = 10 ** decimals;
  const head = group(String(Math.floor(whole / unit)));
  const tail = decimals === 0 ? '' : `.${String(whole % unit).padStart(decimals, '0')}`;
  return `${negative ? '-' : ''}${head}${tail}`;
}

/**
 * Yuan, with the sign in front of the symbol: a refund is money that went back
 * out, and "¥-45.00" reads as a currency nobody uses.
 */
export function formatCny(minor: number | null | undefined): string | null {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return null;
  return `${minor < 0 ? '-' : ''}¥${minorText(Math.abs(minor), 2)}`;
}

/**
 * An amount in the currency it was paid in.
 *
 * The code trails the number rather than a symbol leading it, because ¥ is
 * both of two currencies on this page's list and "¥1,000" would be either
 * a thousand yuan or sixty of them.
 */
export function formatAmount(minor: number | null | undefined, currency: string): string | null {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return null;
  if (currency.toUpperCase() === 'CNY') return formatCny(minor);
  return `${minorText(minor, decimalsOf(currency))} ${currency.toUpperCase()}`;
}

/** What the operator typed, as minor units. Anything but a number is a refusal. */
export function parseAmountMinor(text: string, currency: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || !/^-?\d*(\.\d*)?$/.test(trimmed) || !/\d/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** decimalsOf(currency));
}

/** The same money in yuan, at one day's rate. Rounded once, at the end. */
export function toCnyMinor(minor: number, currency: string, rate: number): number | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (currency.toUpperCase() === 'CNY') return Math.round(minor);
  return Math.round((minor / 10 ** decimalsOf(currency)) * rate * 100);
}

/* --------------------------------------------------------------- 币种 */

/**
 * Which currency an entry may be written in, decided by what kind it is.
 *
 * Money coming in only ever arrives in yuan — every customer pays in yuan, and
 * a refund or a credit is that same payment going back — so those three kinds
 * have no currency to choose and the hub refuses anything else with a 400. The
 * bills are the other way round: servers, domains and the two AI accounts are
 * invoiced in dollars, so a cost starts there and stays wherever the operator
 * puts it.
 */
export function currencyLocked(kind: LedgerKind): boolean {
  return kind !== 'cost';
}

/**
 * The currency after a change of kind: yuan whenever the kind locks it, and
 * dollars for a cost that was sitting on the locked default. A cost already in
 * euros keeps its euros — the rule sets a starting point, not a preference.
 */
export function currencyFor(kind: LedgerKind, current: LedgerCurrency): LedgerCurrency {
  if (currencyLocked(kind)) return 'CNY';
  return current === 'CNY' ? 'USD' : current;
}

/** A rate reads to four places: a yen is worth 0.0489 of a yuan. */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return copy.missing;
  return rate.toFixed(4);
}

/**
 * Whether the rate that came back is older than the day it was asked for.
 *
 * The rates are pulled once a day, so asking about today before the pull has
 * run answers with yesterday's — usable, and the operator has to be told,
 * because a month's totals are only checkable if every conversion says which
 * day it used.
 */
export function fxIsStale(asked: string, got: string): boolean {
  return DAY.test(asked) && DAY.test(got) && got < asked;
}

/* --------------------------------------------------------------- subjects */

/** What a category is billed to. The Worker refuses any other pairing. */
const SUBJECT_OF: Record<LedgerCategory, LedgerSubjectType> = {
  plan: 'user',
  server: 'node',
  home_line: 'home_exit',
  domain: 'fleet',
  control_plane: 'fleet',
  claude_account: 'account',
  chatgpt_account: 'account',
  other: 'fleet',
};

export function subjectTypeFor(category: LedgerCategory): LedgerSubjectType {
  return SUBJECT_OF[category];
}

/* ---------------------------------------------------------------- summary */

/** The category rows, biggest first; a category with nothing in it is absent. */
export function categoryTotals(
  summary: MonthSummaryDto,
): Array<{ category: LedgerCategory; cnyMinor: number }> {
  const rows: Array<{ category: LedgerCategory; cnyMinor: number }> = [];
  for (const [key, value] of Object.entries(summary.byCategory)) {
    if (typeof value !== 'number' || value === 0) continue;
    rows.push({ category: key as LedgerCategory, cnyMinor: value });
  }
  rows.sort((a, b) => Math.abs(b.cnyMinor) - Math.abs(a.cnyMinor));
  return rows;
}

export function customerRow(
  summary: MonthSummaryDto | null,
  userId: string,
): MonthCustomerRow | null {
  return summary?.customers.find((row) => row.userId === userId) ?? null;
}

export function nodeRow(summary: MonthSummaryDto | null, name: string): MonthNodeRow | null {
  return summary?.nodes.find((row) => row.name === name) ?? null;
}

export function pendingCustomers(summary: MonthSummaryDto): MonthCustomerRow[] {
  return summary.customers.filter((row) => row.pending);
}

export function pendingNodes(summary: MonthSummaryDto): MonthNodeRow[] {
  return summary.nodes.filter((row) => row.pending);
}

/** Yuan per GB, to the cent. Null stays null: 待核对 is not a rounding of zero. */
export function formatPerGb(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  // Minor units per GB, like every other money field on the summary.
  return `¥${minorText(Math.round(value), 2)}`;
}

/* ---------------------------------------------------------------- entries */

/**
 * The month's entries, newest payment first.
 *
 * `paidAt` is what an operator scans for — it is the date on the receipt —
 * and entries that carry none sort by when they were written down, which is
 * the only other date they have.
 */
export function sortedEntries(rows: readonly LedgerEntryDto[]): LedgerEntryDto[] {
  return [...rows].sort((a, b) => (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt));
}

/** How an entry is named in a sentence: the note if it has one, else its category. */
export function entryWords(row: LedgerEntryDto): string {
  const note = row.note?.trim();
  if (note) return note;
  return `${copy.ledger.kind[row.kind]} · ${copy.ledger.category[row.category]}`;
}
