import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { NodeErrors } from './Errors';

it('labels a UTC error-day bar with its UTC date west of UTC', () => {
  const localDay = vi.spyOn(Date.prototype, 'getDate').mockReturnValue(7);
  try {
    const dayAt = Date.UTC(2026, 8, 8) / 1000;
    const html = renderToString(<NodeErrors
      name="n1"
      recent={{
        value: [{ dayAt, category: 'dial', count: 3, sample: null }],
        asOfSec: dayAt,
        source: 'xray',
      } as never}
    />);
    expect(html).toContain('2026-09-08 · ');
    expect(html).not.toContain('2026-09-07');
  } finally {
    localDay.mockRestore();
  }
});
