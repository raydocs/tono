import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { SystemHealthDto } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import ClientsPage from './Clients';

it('keeps old page data visibly stale when the shared health read succeeds', () => {
  const now = nowSec();
  const health: SystemHealthDto = {
    ok: true, buildSha: null, contractVersion: 1, sources: [],
    cronLastRunAt: null, cronLastDurationMs: null, cronLastError: null,
    cronSteps: null, backfill: null, updatedAt: now,
  };
  const html = renderToString(<ClientsPage
    releases={{ status: 'ready', data: [], fetchedAt: now - 3600 }}
    health={{ status: 'ready', data: health, fetchedAt: now }}
    onChanged={() => undefined}
  />);
  expect(html).toContain(copy.pageStale);
  expect(html).not.toContain(copy.consoleStale);
  expect(html).toContain('stamp-late');
});
