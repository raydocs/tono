import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { copy } from '@/copy/copy';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): never {
  throw new Error('render exploded');
}

async function mount(child: React.ReactNode) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<ErrorBoundary>{child}</ErrorBoundary>); });
  return { host, done: async () => { await act(async () => { root.unmount(); }); host.remove(); } };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

it('replaces a page that throws on render with the crashed block and a reload button', async () => {
  const { host, done } = await mount(<Broken />);
  try {
    expect(host.textContent).toContain(copy.pageCrashed);
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === copy.reloadPage);
    expect(button).toBeDefined();
  } finally {
    await done();
  }
});

it('reloads once for a failed page chunk and then falls back to the block', async () => {
  const reload = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
  function Stale(): never {
    throw new TypeError('Failed to fetch dynamically imported module: /ops/assets/Nodes.js');
  }
  const first = await mount(<Stale />);
  await first.done();
  expect(reload).toHaveBeenCalledTimes(1);
  const second = await mount(<Stale />);
  try {
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.host.textContent).toContain(copy.pageCrashed);
  } finally {
    await second.done();
  }
});
