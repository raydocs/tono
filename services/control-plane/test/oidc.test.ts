import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyOidcIdToken } from '../src/oidc';

afterEach(() => vi.restoreAllMocks());

describe('OIDC key response lifecycle', () => {
  it.each([
    { status: 503, headers: {}, error: 'OIDC key service failed' },
    { status: 302, headers: { location: 'https://example.com/keys' }, error: 'OIDC key service failed' },
    { status: 200, headers: { 'content-length': String(256 * 1024 + 1) }, error: 'OIDC key response too large' },
  ])('cancels rejected key response: $status $error', async ({ status, headers, error }) => {
    const cancel = vi.fn();
    // An upstream may send headers and keep streaming. Rejecting the headers
    // must release that body rather than retaining it across login retries.
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('upstream body')); },
      cancel,
    }), { status, headers: headers as HeadersInit });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ sub: 'test-subject', nonce: 'test-nonce' })}.AAAA`;
    try {
      await expect(verifyOidcIdToken('google', token, 'test-audience')).rejects.toMatchObject({
        message: error,
        temporary: true,
      });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      await response.body?.cancel();
    }
  });
});
