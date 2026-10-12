import { describe, expect, it } from 'vitest';
import type { CustomerSummaryDto } from '@contract';
import { absoluteExpiryPatch, customerFactsGaps } from './customer-facts';
import { fromDateInput } from './settings';

const row = (userId: string, lifecycle: CustomerSummaryDto['lifecycle'], expiresAt: number | null) =>
  ({ userId, lifecycle, expiresAt }) as CustomerSummaryDto;

describe('customer facts gaps', () => {
  it('counts only in-use customers with no expiry date', () => {
    const gaps = customerFactsGaps([
      row('a', 'active', null),
      row('b', 'active', 1_800_000_000),
      row('c', 'suspended', null),
      row('d', 'expired', null),
      row('e', 'active', null),
    ]);
    expect(gaps.noExpiry).toEqual(['a', 'e']);
  });

  it('is empty when every in-use customer has a date', () => {
    expect(customerFactsGaps([row('a', 'active', 1_800_000_000)]).noExpiry).toEqual([]);
    expect(customerFactsGaps([]).noExpiry).toEqual([]);
  });
});

describe('absolute expiry patch', () => {
  const now = fromDateInput('2026-10-12') ?? 0;

  it('turns a typed future date into the one patch every customer gets', () => {
    expect(absoluteExpiryPatch('2026-12-31', now)).toEqual({ expiresAt: fromDateInput('2026-12-31') });
  });

  it('refuses text that is not a date, an empty box and a date that is not after now', () => {
    expect(absoluteExpiryPatch('', now)).toBeNull();
    expect(absoluteExpiryPatch('soon', now)).toBeNull();
    expect(absoluteExpiryPatch('2026-10-12', now)).toBeNull();
    expect(absoluteExpiryPatch('2025-01-01', now)).toBeNull();
  });
});
