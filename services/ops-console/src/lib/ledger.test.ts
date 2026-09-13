import { describe, expect, it } from 'vitest';
import type { MonthSummaryDto } from './api-ledger';
import {
  categoryTotals,
  currencyFor,
  currencyLocked,
  customerRow,
  dayOf,
  formatAmount,
  formatCny,
  formatPerGb,
  formatRate,
  fxIsStale,
  monthChoices,
  monthFromDay,
  monthOf,
  monthWords,
  nodeRow,
  parseAmountMinor,
  pendingCustomers,
  shiftMonth,
  sortedEntries,
  subjectTypeFor,
  toCnyMinor,
} from './ledger';

/** The instant the screenshot suite freezes: 2026-09-09 03:23:46 +08:00. */
const NOW = 1_788_895_426;

/** Noon on the ninth wherever this test runs — the月 and 日 must not move with TZ. */
const LOCAL_NOON = Math.floor(new Date(2026, 8, 9, 12).getTime() / 1_000);

describe('months', () => {
  it('reads the month and the day off the local clock', () => {
    expect(monthOf(LOCAL_NOON)).toBe('2026-09');
    expect(dayOf(LOCAL_NOON)).toBe('2026-09-09');
  });

  it('steps across a year boundary in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-09', -9)).toBe('2025-12');
  });

  it('offers this month first and a year of them', () => {
    const choices = monthChoices(LOCAL_NOON);
    expect(choices[0]).toBe('2026-09');
    expect(choices).toHaveLength(13);
    expect(choices[12]).toBe('2025-09');
  });

  it('says a month the way an operator says it', () => {
    expect(monthWords('2026-09')).toBe('2026 年 9 月');
  });

  it('takes the month off a day, and refuses a half-typed one', () => {
    expect(monthFromDay('2026-09-03')).toBe('2026-09');
    expect(monthFromDay('2026-09')).toBeNull();
  });
});

describe('money', () => {
  it('prints yuan from minor units, grouped, with the sign kept', () => {
    expect(formatCny(123_456)).toBe('¥1,234.56');
    expect(formatCny(-4_500)).toBe('-¥45.00');
    expect(formatCny(0)).toBe('¥0.00');
    expect(formatCny(null)).toBeNull();
  });

  it('trails the code on anything but yuan, because ¥ is two currencies', () => {
    expect(formatAmount(12_800, 'USD')).toBe('128.00 USD');
    expect(formatAmount(12_800, 'CNY')).toBe('¥128.00');
  });

  it('treats a yen as its own smallest unit', () => {
    expect(formatAmount(1_000, 'JPY')).toBe('1,000 JPY');
    expect(parseAmountMinor('1000', 'JPY')).toBe(1_000);
    expect(parseAmountMinor('128.5', 'USD')).toBe(12_850);
  });

  it('refuses an amount that is not a number', () => {
    expect(parseAmountMinor('', 'CNY')).toBeNull();
    expect(parseAmountMinor('一百', 'CNY')).toBeNull();
    expect(parseAmountMinor('12.3.4', 'CNY')).toBeNull();
    expect(parseAmountMinor('.', 'CNY')).toBeNull();
  });

  it('converts once, at the end, at the day rate', () => {
    expect(toCnyMinor(12_800, 'USD', 7.1234)).toBe(91_180);
    expect(toCnyMinor(1_000, 'JPY', 0.0489)).toBe(4_890);
    expect(toCnyMinor(500, 'CNY', 1)).toBe(500);
    expect(toCnyMinor(500, 'USD', 0)).toBeNull();
  });

  it('shows a rate to four places and a per-GB cost to the cent', () => {
    expect(formatRate(7.1)).toBe('7.1000');
    expect(formatPerGb(43)).toBe('¥0.43');
    expect(formatPerGb(null)).toBeNull();
  });
});

describe('币种', () => {
  it('locks the three kinds of money that only ever comes in as yuan', () => {
    expect(currencyLocked('revenue')).toBe(true);
    expect(currencyLocked('refund')).toBe(true);
    expect(currencyLocked('credit')).toBe(true);
    expect(currencyLocked('cost')).toBe(false);
  });

  it('forces yuan on the locked kinds whatever was chosen before', () => {
    expect(currencyFor('revenue', 'USD')).toBe('CNY');
    expect(currencyFor('refund', 'JPY')).toBe('CNY');
    expect(currencyFor('credit', 'CNY')).toBe('CNY');
  });

  it('starts a bill in dollars but keeps a currency the operator picked', () => {
    expect(currencyFor('cost', 'CNY')).toBe('USD');
    expect(currencyFor('cost', 'EUR')).toBe('EUR');
    expect(currencyFor('cost', 'USD')).toBe('USD');
  });
});

describe('汇率 freshness', () => {
  it('calls a rate stale only when its day is behind the one asked for', () => {
    expect(fxIsStale('2026-09-10', '2026-09-09')).toBe(true);
    expect(fxIsStale('2026-09-09', '2026-09-09')).toBe(false);
    expect(fxIsStale('2026-09', '2026-09-09')).toBe(false);
  });
});

describe('subjects', () => {
  it('bills each category to the thing it is a bill for', () => {
    expect(subjectTypeFor('plan')).toBe('user');
    expect(subjectTypeFor('server')).toBe('node');
    expect(subjectTypeFor('home_line')).toBe('home_exit');
    expect(subjectTypeFor('claude_account')).toBe('account');
    expect(subjectTypeFor('domain')).toBe('fleet');
  });
});

const SUMMARY: MonthSummaryDto = {
  month: '2026-09',
  closedAt: null,
  closedBy: null,
  revenueCnyMinor: 500_000,
  costCnyMinor: 300_000,
  marginCnyMinor: 200_000,
  byCategory: { plan: 500_000, server: 200_000, domain: 0, home_line: 100_000 },
  customers: [
    { userId: 'u-01', email: 'a@b.c', revenueCnyMinor: 12_800, costCnyMinor: 4_000, marginCnyMinor: 8_800, pending: false },
    { userId: 'u-02', email: 'd@e.f', revenueCnyMinor: 12_800, costCnyMinor: 0, marginCnyMinor: null, pending: true },
  ],
  nodes: [
    { name: 'Tokyo · Fuji', costCnyMinor: 4_000, bytes: 1_000, cnyPerGbMinor: 0.42, pending: false },
    { name: 'Seoul · Han', costCnyMinor: 4_000, bytes: null, cnyPerGbMinor: null, pending: true },
  ],
  unreconciled: 2,
  reconciliation: { billsWithoutLedger: [], ledgerWithoutBill: [], asOfSec: NOW },
  unreconciledBills: 0,
  updatedAt: NOW,
};

describe('the month summary', () => {
  it('drops empty categories and puts the biggest first', () => {
    expect(categoryTotals(SUMMARY).map((row) => row.category)).toEqual(['plan', 'server', 'home_line']);
  });

  it('finds a customer and a machine by the key each is named by', () => {
    expect(customerRow(SUMMARY, 'u-02')?.pending).toBe(true);
    expect(customerRow(SUMMARY, 'u-99')).toBeNull();
    expect(customerRow(null, 'u-01')).toBeNull();
    expect(nodeRow(SUMMARY, 'Tokyo · Fuji')?.cnyPerGbMinor).toBe(0.42);
  });

  it('keeps a pending margin null rather than calling it zero', () => {
    const [row] = pendingCustomers(SUMMARY);
    expect(row.marginCnyMinor).toBeNull();
    expect(formatCny(row.marginCnyMinor)).toBeNull();
  });
});

describe('entries', () => {
  it('puts the newest payment first and dates a paidless entry by when it was written', () => {
    const rows = sortedEntries([
      { paidAt: NOW - 86_400, createdAt: NOW } as never,
      { paidAt: null, createdAt: NOW + 10 } as never,
      { paidAt: NOW, createdAt: NOW } as never,
    ]);
    expect(rows.map((row) => row.paidAt)).toEqual([null, NOW, NOW - 86_400]);
  });
});
