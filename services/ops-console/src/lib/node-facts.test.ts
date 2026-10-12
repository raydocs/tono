import { describe, expect, it } from 'vitest';
import type { NodeSummaryDto } from '@contract';
import { batchPatch, batchProblem, EMPTY_BATCH, nodeFactsGaps, type BatchForm } from './node-facts';

const row = (
  name: string,
  over: { lifecycle?: string; quota?: number | null; stamped?: boolean; expiresAt?: number | null; renewsAt?: number | null } = {},
) => ({
  name,
  lifecycle: over.lifecycle ?? 'listed',
  quota: {
    value: over.quota === undefined ? { quota: 1_000_000_000_000 } : over.quota === null ? null : { quota: over.quota },
    asOfSec: over.stamped === false ? null : 1_700_000_000,
    source: 'profile',
  },
  expiresAt: over.expiresAt ?? null,
  renewsAt: over.renewsAt ?? null,
}) as unknown as NodeSummaryDto;

describe('nodeFactsGaps', () => {
  it('counts active machines without an allowance or an expiry, and skips retired ones', () => {
    const gaps = nodeFactsGaps([
      row('complete', { expiresAt: 1_800_000_000 }),
      row('renews-only', { renewsAt: 1_800_000_000 }),
      row('no-quota', { quota: null, expiresAt: 1_800_000_000 }),
      row('zero-quota', { quota: 0, expiresAt: 1_800_000_000 }),
      row('unstamped', { stamped: false, expiresAt: 1_800_000_000 }),
      row('no-dates'),
      row('retired', { lifecycle: 'retired', quota: null }),
    ]);
    expect(gaps.noQuota).toEqual(['no-quota', 'zero-quota', 'unstamped']);
    expect(gaps.noExpiry).toEqual(['no-dates']);
  });
});

describe('batchPatch', () => {
  const filledQuota: BatchForm = { ...EMPTY_BATCH, quotaGb: '100', cycleKind: 'calendar_day', anchorDay: '5', counts: 'in_out' };

  it('sends only the boxes that were filled, with the quota whole and in bytes', () => {
    expect(batchPatch(EMPTY_BATCH)).toEqual({});
    expect(batchPatch({ ...EMPTY_BATCH, expires: '2027-03-01' })).toEqual({ expiresAt: expect.any(Number) });
    expect(batchPatch(filledQuota)).toEqual({
      quota: { quotaBytes: 100_000_000_000, cycleKind: 'calendar_day', cycleAnchorDay: 5, counts: 'in_out' },
    });
    expect(batchPatch({ ...EMPTY_BATCH, price: '5.5', currency: ' usd ', billing: '30' })).toEqual({
      price: 5.5, currency: 'USD', billingCycle: 30,
    });
  });

  it('refuses the forms the Worker would refuse', () => {
    expect(batchProblem(EMPTY_BATCH)).toBe('empty');
    expect(batchProblem({ ...EMPTY_BATCH, quotaGb: '100' })).toBe('quotaRules');
    expect(batchProblem({ ...filledQuota, quotaGb: '0' })).toBe('quota');
    expect(batchProblem({ ...filledQuota, anchorDay: '40' })).toBe('anchor');
    expect(batchProblem({ ...EMPTY_BATCH, price: '5' })).toBe('priceCycle');
    expect(batchProblem({ ...EMPTY_BATCH, currency: '$' })).toBe('currency');
    expect(batchProblem(filledQuota)).toBeNull();
  });
});
