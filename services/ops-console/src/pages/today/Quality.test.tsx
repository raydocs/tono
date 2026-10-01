import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { QualityBand } from './Quality';

vi.mock('@/lib/use-resource', () => ({
  useResource: () => ({
    status: 'ready', reload: () => {}, data: { items: [8, 9].map((day) => ({
      dayAt: Date.UTC(2026, 8, day) / 1000, platform: 'windows', carrier: 'other',
      node: 'n1', attempts: 1, successes: 1, p50Ms: 20,
      verifiedOutageMin: 5, unmeasuredMin: 0,
    })) },
  }),
}));

vi.mock('@/components/ops/use-chart', () => ({
  useWidth: () => [{ current: null }, 800],
  useCursor: () => ({ index: 0, setIndex: () => {}, clear: () => {}, onKeyDown: () => {} }),
}));

it('keeps UTC bucket dates in overview quality tooltips, ticks and both bar charts', () => {
  const localDay = vi.spyOn(Date.prototype, 'getDate').mockReturnValue(7);
  const localOffset = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(480);
  try {
    const document = new DOMParser().parseFromString(renderToString(<QualityBand />), 'text/html');
    const charts = document.querySelectorAll('.chart-frame');
    expect(charts).toHaveLength(3);
    expect(charts[0]?.textContent).toContain('2026-09-08');
    expect(charts[0]?.textContent).toContain('9/8');
    expect(charts[1]?.textContent).toContain('9/8');
    expect(charts[2]?.textContent).toContain('9/8');
    const firstTick = charts[0]?.querySelector('svg > text');
    const gridLine = charts[0]?.querySelector('svg > g > line');
    expect(firstTick?.getAttribute('x')).toBe(gridLine?.getAttribute('x1'));
  } finally {
    localDay.mockRestore();
    localOffset.mockRestore();
  }
});
