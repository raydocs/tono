import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { LedgerSlo } from './LedgerSlo';

vi.mock('@/lib/use-resource', () => ({
  useResource: () => ({
    status: 'ready',
    data: { items: [{
      dayAt: Date.UTC(2026, 8, 8) / 1000, platform: 'windows', carrier: 'other',
      node: 'n1', attempts: 1, successes: 1, p50Ms: 20,
      verifiedOutageMin: 0, unmeasuredMin: 0,
    }] },
  }),
}));

it('keeps the UTC bucket date when the operator’s local day differs', () => {
  // A UTC-midnight bucket is still the previous local day west of UTC.
  const localDay = vi.spyOn(Date.prototype, 'getDate').mockReturnValue(7);
  try {
    expect(renderToString(<LedgerSlo />)).toContain('2026-09-08');
  } finally {
    localDay.mockRestore();
  }
});
