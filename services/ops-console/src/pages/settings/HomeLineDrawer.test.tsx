import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { UsageStrip } from './HomeLineDrawer';

it('labels a UTC home-line usage bar with its UTC date west of UTC', () => {
  const localDay = vi.spyOn(Date.prototype, 'getDate').mockReturnValue(7);
  try {
    const html = renderToString(
      <UsageStrip days={[{ dayAt: Date.UTC(2026, 8, 8) / 1000, bytes: 1024 }]} ready />,
    );
    expect(html).toContain('2026-09-08 · ');
    expect(html).not.toContain('2026-09-07');
  } finally {
    localDay.mockRestore();
  }
});
