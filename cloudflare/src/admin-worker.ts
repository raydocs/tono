import controlPlane, { type Env } from './index';

type AdminEnv = Pick<
  Env,
  'DB' | 'ASSETS' | 'ALLOWED_ORIGIN' | 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD' | 'ACCESS_ADMIN_EMAILS'
>;

function unavailable() {
  return new Response('Not found', {
    status: 404,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'permissions-policy': 'camera=(), geolocation=(), microphone=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

export default {
  async fetch(request: Request, env: AdminEnv, context: ExecutionContext) {
    const url = new URL(request.url);
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
