import controlPlane, { type Env } from './index';

type AdminEnv = Pick<
  Env,
  'DB' | 'ASSETS' | 'ALLOWED_ORIGIN' | 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD' | 'ACCESS_ADMIN_EMAILS'
>;

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
    return controlPlane.fetch(request, env as Env, context);
  },
} satisfies ExportedHandler<AdminEnv>;
