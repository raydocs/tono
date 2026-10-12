import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BackendUnreachableError } from './api';
import { useResource, type Resource } from './use-resource';

it('keeps the last good data and records the error when a refetch finds the hub unreachable', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const down = new BackendUnreachableError('server', 'bad gateway', 502);
  const load = vi.fn<() => Promise<string>>()
    .mockResolvedValueOnce('rows')
    .mockRejectedValueOnce(down)
    .mockResolvedValueOnce('rows again');
  let seen: Resource<string> = { status: 'loading' };
  function Probe({ beat }: { beat: number }) {
    seen = useResource('k', load, beat);
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Probe beat={0} />); });
    expect(seen).toMatchObject({ status: 'ready', data: 'rows' });
    await act(async () => { root.render(<Probe beat={1} />); });
    expect(seen).toMatchObject({ status: 'ready', data: 'rows', unreachable: down });
    await act(async () => { root.render(<Probe beat={2} />); });
    expect(seen).toMatchObject({ status: 'ready', data: 'rows again' });
    expect(seen).not.toHaveProperty('unreachable', down);
  } finally {
    await act(async () => { root.unmount(); });
  }
});
