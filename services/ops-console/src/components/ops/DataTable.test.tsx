import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DataTable } from './DataTable';

it('marks only the sorted header with aria-sort and hides the arrow glyph', () => {
  const document = new DOMParser().parseFromString(renderToString(
    <DataTable
      rows={[{ id: 'a', n: 1 }, { id: 'b', n: 2 }]}
      columns={[
        { id: 'id', header: 'Name', sortValue: (row) => row.id, cell: (row) => row.id },
        { id: 'n', header: 'Count', sortValue: (row) => row.n, cell: (row) => row.n },
        { id: 'x', header: 'Plain', cell: () => '-' },
      ]}
      getRowId={(row) => row.id}
      state="ready"
      sort={{ id: 'n', direction: 'desc' }}
    />,
  ), 'text/html');
  const heads = [...document.querySelectorAll('th')].map((th) => th.getAttribute('aria-sort'));
  expect(heads).toEqual(['none', 'descending', null]);
  expect(document.querySelector('th[aria-sort="descending"] [aria-hidden="true"]')?.textContent).toBe('↓');
});
