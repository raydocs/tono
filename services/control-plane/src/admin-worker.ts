import controlPlane, { type Env } from './index';

type AdminEnv = Pick<
  Env,
  'DB' | 'ASSETS' | 'ALLOWED_ORIGIN' | 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD' | 'ACCESS_ADMIN_EMAILS' | 'BUILD_SHA'
> & { API: Fetcher };

const ADMIN_MONITOR = 'https://admin.afk.ccwu.cc/ops/#/monitor';
const ABSORBED_HOSTS = new Set(['quality.afk.ccwu.cc', 'ops.afk.ccwu.cc']);

const closedHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function unavailable() {
  return new Response('Not found', { status: 404, headers: closedHeaders });
}

function absorbed() {
  return new Response(null, {
    status: 302,
    headers: { ...closedHeaders, location: ADMIN_MONITOR },
  });
}

function adminBuildSha(env: AdminEnv) {
  const value = env.BUILD_SHA?.trim() ?? '';
  return /^[0-9a-f]{40}$/.test(value) ? value : 'development';
}

export default {
  async fetch(request: Request, env: AdminEnv, context: ExecutionContext) {
    const url = new URL(request.url);
    if (ABSORBED_HOSTS.has(url.hostname.toLowerCase())) return absorbed();

    const allowed =
      url.pathname === '/' ||
      url.pathname === '/ops' ||
      url.pathname.startsWith('/ops/') ||
      url.pathname.startsWith('/api/v1/ops/');
    if (!allowed) return unavailable();

    if (url.pathname === '/') {
      url.pathname = '/ops/';
      request = new Request(url, request);
    }

    // The console routes on the hash, so `/ops/monitor` names no asset and the
    // asset binding answered it with a bare 404 — which is what someone typing
    // or sharing the obvious URL for a page actually gets. Send them to the
    // page they meant instead. A segment containing a dot is a real file
    // (`index.html`, `assets/index-*.js`) and is left alone.
    const deepLink = /^\/ops\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    if (deepLink) {
      return new Response(null, {
        status: 302,
        headers: { ...closedHeaders, location: `/ops/#/${deepLink[1]}` },
      });
    }

    if (url.pathname.startsWith('/api/v1/ops/')) {
      // This is no longer a browser cross-origin request after it enters the
      // service binding. Forwarding the public admin Origin would make the API
      // worker compare it with api.afk.ccwu.cc and reject every state-changing
      // operation before Access authentication runs.
      const headers = new Headers(request.headers);
      headers.delete('origin');
      const internalRequest = new Request(request, { headers });
      const response = await env.API.fetch(internalRequest);
      if (url.pathname === '/api/v1/ops/system/version' && response.ok) {
        const payload = await response.json() as { system?: Record<string, unknown> };
        const api = payload.system ?? {};
        const admin = { service: 'admin', version: '0.0.1', buildSha: adminBuildSha(env) };
        return Response.json({
          system: {
            api,
            admin,
            aligned: api.buildSha === admin.buildSha,
          },
        }, { headers: { 'cache-control': 'no-store' } });
      }
      return response;
    }

    return controlPlane.fetch(request, env as unknown as Env, context);
  },
} satisfies ExportedHandler<AdminEnv>;
