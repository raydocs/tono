import { describe, expect, it } from 'vitest';
import { assertList, assertCustomerSummary, type CustomerSummaryDto } from '@contract';
import { copy } from '@/copy/copy';
import raw from '../../fixtures/customers.json';
import {
  CUSTOMER_FILTERS,
  customerCounts,
  planWired,
  PLATFORM_CHIPS,
  platformCounts,
  releasedPlatforms,
  selectByPlatform,
  selectCustomers,
} from './customers';

const rows: CustomerSummaryDto[] = assertList(
  (raw as { list: unknown }).list,
  assertCustomerSummary,
).items;

describe('customer selectors', () => {
  it('uses the same function for the sentence and the table', () => {
    const counts = customerCounts(rows);
    for (const filter of CUSTOMER_FILTERS) {
      expect(counts[filter], filter).toBe(selectCustomers(rows, filter).length);
    }
  });

  it('counts exactly the fragments the sentence offers', () => {
    expect(Object.keys(customerCounts(rows)).sort()).toEqual([...CUSTOMER_FILTERS].sort());
    for (const filter of CUSTOMER_FILTERS) {
      expect(copy.customerCount[filter], filter).toBeTypeOf('function');
    }
  });

  it('reads the sentence the page was designed around', () => {
    const counts = customerCounts(rows);
    expect(copy.customerCount.all(counts.all)).toBe('20 位客户');
    expect(copy.customerCount.ok(counts.ok)).toBe('4 位正常');
    expect(copy.customerCount.unreachable(counts.unreachable)).toBe('1 位连不上');
  });

  /**
   * R4 as the operator checks it: click the fragment, read the rows, and every
   * row repeats the word that was just counted.
   */
  it('counts only the rows that carry the word the fragment says', () => {
    const well = selectCustomers(rows, 'ok');
    expect(well.length).toBeGreaterThan(0);
    for (const row of well) expect(row.health, row.userId).toBe(copy.customerHealth.ok);
    const unreachable = selectCustomers(rows, 'unreachable');
    expect(unreachable.length).toBeGreaterThan(0);
    for (const row of unreachable) {
      expect(row.health, row.userId).toBe(copy.customerHealth.unreachable);
    }
  });

  /**
   * R1 at the selector, not at the pixel: a customer whose client has never
   * reported must not be counted, and neither must one whose last word was
   * "connected" a day ago — that is the row production counted while the row
   * itself read 离线.
   */
  it('never counts a customer the table calls something else', () => {
    const unreported = rows.filter((row) => row.connected.asOfSec === null);
    expect(unreported.length).toBeGreaterThan(0);
    const well = selectCustomers(rows, 'ok');
    for (const row of unreported) expect(well).not.toContain(row);

    const stale: CustomerSummaryDto = {
      ...rows[0],
      userId: 'u-stale',
      verdict: 'offline',
      health: copy.customerHealth.offline,
      connected: { value: true, asOfSec: rows[0].connected.asOfSec, source: 'telemetry' },
    };
    const withStale = [...rows, stale];
    expect(customerCounts(withStale).ok).toBe(customerCounts(rows).ok);
    expect(selectCustomers(withStale, 'ok')).not.toContain(stale);
  });

  /**
   * The three plan columns are one group: this fleet has expiry dates, so they
   * are shown, and a fleet with none of the three would hide all three rather
   * than keep a column of dashes across the addresses.
   */
  it('shows the plan columns only while some row has something in one', () => {
    expect(planWired(rows)).toBe(true);
    const blank = rows.map((row) => ({
      ...row,
      services: [],
      minAppVersion: null,
      expiresAt: null,
    }));
    expect(planWired(blank)).toBe(false);
    expect(planWired([])).toBe(false);
  });

  it('offers all five platform chips, whether or not anything ships for them', () => {
    expect(PLATFORM_CHIPS.length).toBe(5);
    const counts = platformCounts(rows);
    const live = releasedPlatforms(rows);
    for (const platform of PLATFORM_CHIPS) {
      expect(counts[platform], platform).toBe(selectByPlatform(rows, platform).length);
      if (!live.has(platform)) expect(counts[platform], platform).toBe(0);
    }
    // Nothing has shipped for three of them, so three chips say 未发布.
    expect(PLATFORM_CHIPS.filter((platform) => !live.has(platform)).length).toBe(3);
  });

  it('the platform filter narrows without ever dropping a row into nowhere', () => {
    const withPlatform = rows.filter((row) => row.platforms.length > 0);
    const covered = new Set<string>();
    for (const platform of PLATFORM_CHIPS) {
      for (const row of selectByPlatform(rows, platform)) covered.add(row.userId);
    }
    expect(covered.size).toBe(withPlatform.length);
  });
});
