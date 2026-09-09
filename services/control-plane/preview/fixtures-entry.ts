// Local-only Worker entry for fixture capture. Production `src/index.ts` is
// unchanged: Access still verifies a real JWT, but the JWKS fetch is answered
// from this isolate so `wrangler dev` does not need a Cloudflare Access team.
import worker from '../src/index';

const FIXTURE_JWKS = {
  keys: [{
    kty: 'RSA',
    kid: 'tono-fixtures-access',
    use: 'sig',
    alg: 'RS256',
    n: 'nUdOpd7MfUJ5Y703Caq1LMd8lB_G_o_ubqeX-5Mehk1g6i7Gbu1tHdUzhP63VuPnx1ahItlNizNUcmQR5an-ATlkd9R6wZfQcce-ssbXAAWtvAqCnDNds5vUPVZRjGpiDt10A1t3ZSaQLH7n7Kjjxt38FBvw_7Iv31QxeStgudtraJo9CWE60DGH1K0ebG8E790Ljm2vjjQvHHOzPS1e5Eppo6pn4lOi2hPCvpxwVdBkNoXFa0cF64iSZ-xeNdLrIZVDncrlEP3SN9kS8fo--HBXEE4uiNkgY1XvZcC7x-_oZ6hPvur4zZ34S5imfRq0XZeoIybkDLGD5oH73T4KmQ',
    e: 'AQAB',
  }],
};

const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  if (url === 'https://test-team.cloudflareaccess.com/cdn-cgi/access/certs') {
    return Promise.resolve(
      Response.json(FIXTURE_JWKS, { headers: { 'cache-control': 'public, max-age=300' } }),
    );
  }
  return originalFetch(input as RequestInfo, init);
};

// This entry mints trust for a fixture-only JWKS. It must never answer for a
// deployed hostname: refuse anything that is not plain local wrangler dev, so
// a mistaken `wrangler deploy --config wrangler.fixtures.jsonc` serves nothing.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0']);

export default {
  ...worker,
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const host = new URL(request.url).hostname;
    if (!LOCAL_HOSTS.has(host)) {
      return new Response('fixtures worker only serves local wrangler dev', { status: 421 });
    }
    return (worker as { fetch: (r: Request, e: unknown, c: ExecutionContext) => Promise<Response> }).fetch(request, env, ctx);
  },
};
