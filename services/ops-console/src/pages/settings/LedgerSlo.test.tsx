import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { copy } from '@/copy/copy';
import { LedgerSlo } from './LedgerSlo';

const row = (node: string) => ({
  dayAt: Date.UTC(2026, 8, 8) / 1000, platform: 'windows', carrier: 'other',
  node, attempts: 1, successes: 1, p50Ms: 20,
  verifiedOutageMin: 0, unmeasuredMin: 0,
});
const fixture = vi.hoisted(() => ({ nodes: ['n1'] }));

vi.mock('@/lib/use-resource', () => ({
  useResource: () => ({
    status: 'ready',
    data: { items: fixture.nodes.map(row) },
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

it('draws ten measurement rows until the operator asks for all of them', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.nodes = Array.from({ length: 25 }, (_, i) => `n${String(i).padStart(2, '0')}`);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const rows = () => host.querySelectorAll('tbody tr').length;
  try {
    await act(async () => root.render(<LedgerSlo />));
    expect(rows()).toBe(10);
    const toggle = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === copy.ledger.sloMore(25))!;
    await act(async () => toggle.click());
    expect(rows()).toBe(25);
    expect(host.textContent).toContain(copy.ledger.sloFewer);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    fixture.nodes = ['n1'];
    vi.unstubAllGlobals();
  }
});
