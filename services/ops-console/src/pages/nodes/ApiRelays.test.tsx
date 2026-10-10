import { renderToString } from 'react-dom/server';
import { assertApiRelays } from '@contract';
import { copy } from '@/copy/copy';
import { formatLatency } from '@/lib/display';
import { materializeOps } from '@/lib/ops-fixtures';
import raw from '../../../fixtures/api-relays.json';
import { ApiRelays } from './ApiRelays';

it('lists each API relay with its tone, latency and check age from the committed fixture', () => {
  const data = assertApiRelays(materializeOps(raw.body, raw.clock));
  const host = document.createElement('div');
  host.innerHTML = renderToString(<ApiRelays relays={{ status: 'ready', data, fetchedAt: 0 }} />);
  const text = host.textContent ?? '';
  expect(text).toContain(copy.apiRelays.title);
  expect(text).toContain(`Los Angeles · Westwood${copy.apiRelays.up}${formatLatency(142)}`);
  expect(text).toContain(`Los Angeles · Mesa${copy.apiRelays.down}`);
  expect(text).toContain(copy.apiRelays.checked(copy.ago.minutes(2)));
  expect(host.querySelector('.tone-ok')).not.toBeNull();
  expect(host.querySelector('.tone-sev')?.getAttribute('title')).toBe('tcp connect: timed out after 5000 ms');
});
