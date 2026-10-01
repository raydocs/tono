import { expect, it } from 'vitest';
import type { Env } from '../src/env';
import { handleReleaseHost } from '../src/releases/host';

it('returns a legacy installer range before consuming its R2 stream', async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new TextEncoder().encode('cdef'));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const object = {
    size: 10,
    httpEtag: '"installer"',
    body,
    writeHttpMetadata() {},
    arrayBuffer: () => new Response(body).arrayBuffer(),
  };
  const releases = {
    head: async () => ({ size: 10 }),
    get: async (_key: string, options: R2GetOptions) => {
      expect(options.range).toEqual({ offset: 2, length: 4 });
      return object;
    },
  };
  const response = await handleReleaseHost(new Request(
    'https://releases.afk.ccwu.cc/download/Tono-installer.zip',
    { headers: { range: 'bytes=2-5' } },
  ), { RELEASES: releases } as unknown as Env);

  expect(response?.status).toBe(206);
  expect(response?.headers.get('content-range')).toBe('bytes 2-5/10');
  expect(response?.headers.get('content-length')).toBe('4');
  expect(pulls).toBe(0);
  expect(await response?.text()).toBe('cdef');
});
