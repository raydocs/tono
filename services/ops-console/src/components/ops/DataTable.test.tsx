import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { copy } from '@/copy/copy';
import { DataTable, type DataColumn } from './DataTable';

const columns: DataColumn<{ id: string }>[] = [{ id: 'id', header: 'id', cell: (row) => row.id }];
const table = (props: Partial<Parameters<typeof DataTable<{ id: string }>>[0]>) => (
  <DataTable rows={[]} columns={columns} getRowId={(row) => row.id} state="ready" {...props} />
);

it('offers retry under a table error and calls the refetch', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const retry = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(table({ state: 'error', errorMessage: 'hub down', onRetry: retry })));
    expect(host.textContent).toContain('hub down');
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === copy.retry);
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('draws no retry on a table error when no refetch is given', () => {
  const html = renderToString(table({ state: 'error', errorMessage: 'hub down' }));
  expect(html).toContain('hub down');
  expect(html).not.toContain(copy.retry);
});

it('says the neutral empty word for an empty table unless the caller names what is missing', () => {
  expect(renderToString(table({ state: 'empty' }))).toContain(copy.emptyRows);
  expect(renderToString(table({ state: 'empty' }))).not.toContain(copy.emptyList);
  expect(renderToString(table({ state: 'empty', emptyMessage: copy.emptyList }))).toContain(copy.emptyList);
});
