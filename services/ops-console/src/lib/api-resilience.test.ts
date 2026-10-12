import { ApiRefusal, BackendUnreachableError, SessionExpiredError, getJson, postJson, readRetry } from './api';
import { copy } from '@/copy/copy';

const html = (status: number) => new Response('<html>bad gateway</html>', {
  status,
  headers: { 'content-type': 'text/html' },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => { readRetry.delayMs = 0; });
afterEach(() => { vi.unstubAllGlobals(); readRetry.delayMs = 1_000; });

function stubFetch(...answers: Array<Response | Error | DOMException>) {
  const fetchMock = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift()! : answers[0]!;
    if (!(next instanceof Response)) throw next;
    return next.clone();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('reports an HTML 502 from the edge as the backend being down, not as an expired session', async () => {
  stubFetch(html(502));
  const error = await getJson('nodes').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BackendUnreachableError);
  expect(error).not.toBeInstanceOf(SessionExpiredError);
  expect(error).toMatchObject({ kind: 'server', status: 502, message: copy.backendError(502) });
});

it('keeps 403 as an expired session, and an OK non-JSON page as the login page', async () => {
  const forbidden = stubFetch(html(403));
  await expect(getJson('nodes')).rejects.toBeInstanceOf(SessionExpiredError);
  expect(forbidden).toHaveBeenCalledTimes(1);
  stubFetch(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await expect(getJson('nodes')).rejects.toBeInstanceOf(SessionExpiredError);
});

it('turns a throwing fetch into a Chinese network error, never the browser message', async () => {
  stubFetch(new TypeError('Failed to fetch'));
  const error = await getJson('nodes').catch((e: unknown) => e);
  expect(error).toMatchObject({ kind: 'network', message: copy.backendUnreachable });
  expect((error as Error).message).not.toContain('Failed to fetch');
});

it('reports our own request timeout as a timeout', async () => {
  stubFetch(new DOMException('signal timed out', 'TimeoutError'));
  await expect(getJson('nodes')).rejects.toMatchObject({ kind: 'timeout', message: copy.backendTimeout });
});

it('retries a read once after an unreachable answer and resolves with the second', async () => {
  const fetchMock = stubFetch(html(503), json({ ok: 1 }));
  await expect(getJson('nodes')).resolves.toEqual({ ok: 1 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not retry a 4xx envelope refusal', async () => {
  const fetchMock = stubFetch(json({ error: { message: 'refused by hub' } }, 409));
  await expect(getJson('nodes')).rejects.toMatchObject({ message: 'refused by hub' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('never retries a write', async () => {
  const fetchMock = stubFetch(html(503));
  await expect(postJson('incidents/x/ack', {})).rejects.toBeInstanceOf(ApiRefusal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('stops waiting to retry when the caller aborts', async () => {
  readRetry.delayMs = 60_000;
  stubFetch(html(502));
  const ac = new AbortController();
  const pending = getJson('nodes', ac.signal).catch((e: unknown) => e);
  await new Promise((resolve) => setTimeout(resolve, 5));
  ac.abort();
  expect(await pending).toMatchObject({ name: 'AbortError' });
});
