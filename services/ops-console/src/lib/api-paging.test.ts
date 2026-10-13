import { getAllJson, opsApi } from './api';

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

afterEach(() => { vi.unstubAllGlobals(); });

/** A Worker that answers `limit` rows per page and a cursor until the rows run out. */
function stubList(total: number) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://ops.example');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const from = Number(url.searchParams.get('cursor') ?? 0);
    const to = Math.min(from + limit, total);
    return json({
      items: Array.from({ length: to - from }, (_, i) => ({ id: `c-${from + i}` })),
      nextCursor: to < total ? String(to) : null,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('lists every customer past 2,000 instead of dropping the tail and the cursor', async () => {
  // SOL-CP-ADMIN-USERS-PAGE: customer 2,001 onward was neither listed nor searchable.
  const fetchMock = stubList(2_450);
  const list = await opsApi.customers();
  expect(list.items).toHaveLength(2_450);
  expect(list.items.at(-1)).toEqual({ id: 'c-2449' });
  expect(list.nextCursor).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(13);
});

it('still stops an ordinary list at its guard and says more is left', async () => {
  stubList(2_450);
  const list = await getAllJson<{ id: string }>('incidents');
  expect(list.items).toHaveLength(2_000);
  expect(list.nextCursor).not.toBeNull();
});
