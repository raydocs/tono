import { renderToString } from 'react-dom/server';
import type { CustomerDeviceDto } from '@contract';
import { copy } from '@/copy/copy';
import { Devices } from './Devices';

vi.mock('@/lib/use-resource', () => ({
  useResource: () => ({
    status: 'error', message: 'Device standing read failed', sessionExpired: false, reload: () => undefined,
  }),
}));

it('shows a failed standing read instead of empty history and prevents an unknown log toggle', () => {
  const device: CustomerDeviceDto = {
    id: 'existing-device', name: 'MacBook Pro', status: 'active', platform: 'macos',
    lastSeenAt: null, appVersion: '0.0.74', osVersion: '15', selectedServer: 'test',
    createdAt: 1, connected: false, lastFailAt: null, lastFailCode: null, lastFailNode: null,
  };
  const html = renderToString(<Devices userId="existing-user" devices={[device]} onChanged={() => undefined} />);
  const host = document.createElement('div');
  host.innerHTML = html;
  expect(host.textContent).toContain('Device standing read failed');
  expect(host.textContent).not.toContain(copy.deviceNoAction);
  const toggle = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === copy.deviceLogsOn);
  expect(toggle?.disabled).toBe(true);
});
