import { describe, expect, it } from 'vitest';
import { assertList, assertCustomerSummary, type CustomerSummaryDto } from '@contract';
import { copy } from '@/copy/copy';
import raw from '../../fixtures/customers.json';
import {
  CUSTOMER_FILTERS,
  customerCounts,
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
    expect(copy.customerCount.online(counts.online)).toBe('4 位在线');
    expect(copy.customerCount.unreachable(counts.unreachable)).toBe('1 位连不上');
  });

  /**
   * R1 at the selector, not at the pixel: a customer whose client has never
   * reported must not be counted online, and the only thing separating that
   * from a genuine `false` is the freshness stamp.
   */
  it('never counts an unmeasured customer as online', () => {
    const online = selectCustomers(rows, 'online');
    expect(online.length).toBeGreaterThan(0);
    for (const row of online) {
      expect(row.connected.asOfSec, row.userId).not.toBeNull();
      expect(row.connected.value, row.userId).toBe(true);
    }
    const unreported = rows.filter((row) => row.connected.asOfSec === null);
    expect(unreported.length).toBeGreaterThan(0);
    for (const row of unreported) {
      expect(online).not.toContain(row);
    }
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
