import { parseBytesRange } from '../http';
import type { Env } from '../env';

export const RELEASE_HOST = 'releases.afk.ccwu.cc';

// Release-host aliases rewrite to the same static asset path. Include an
// explicit revision in the inner asset request so a previously cached alias
// cannot keep serving an older Sparkle feed after an asset-only deployment.
export const RELEASE_ASSET_REVISION = 'site-public-pages-20260819';

const RELEASE_ASSET_MAP = new Map<string, string>([
  ['/', '/releases/'],
  ['/index.html', '/releases/'],
  ['/releases', '/releases/'],
  ['/releases/', '/releases/'],
  ['/style.css', '/releases/style.css'],
  ['/manifest.json', '/releases/manifest.json'],
  ['/appcast.xml', '/appcast.xml'],
  ['/macos/appcast.xml', '/appcast.xml'],
  // Windows updaters used to ask raw.githubusercontent.com, which is
  // blocked in mainland China — so the customers most in need of a fix
  // were the ones who could not be told one existed, unless they were
  // already connected through the product being fixed.
  ['/windows/latest.json', '/windows/latest.json'],
  ['/favicon.svg', '/releases/favicon.svg'],
  ['/favicon.ico', '/releases/favicon.svg'],
  ['/robots.txt', '/releases/robots.txt'],
  ['/sitemap.xml', '/releases/sitemap.xml'],
  ['/.well-known/security.txt', '/releases/security.txt'],
  ['/help', '/releases/help.html'],
  ['/help/', '/releases/help.html'],
  ['/status', '/releases/status.html'],
  ['/status/', '/releases/status.html'],
  ['/archive', '/releases/archive.html'],
  ['/archive/', '/releases/archive.html'],
]);

function secureReleaseResponse(r: Response, path: string): Response {
  const h = new Headers(r.headers);
  h.set(
    'content-security-policy',
    "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  h.set('permissions-policy', 'camera=(), geolocation=(), microphone=()');
  h.set('referrer-policy', 'no-referrer');
  h.set('x-content-type-options', 'nosniff');
  h.set('x-frame-options', 'DENY');
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  if (path === '/' || path.endsWith('.html')) {
    h.set('cache-control', 'no-store');
  }
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

export function isReleaseHost(url: URL): boolean {
  return url.hostname.toLowerCase() === RELEASE_HOST;
}

export async function handleReleaseHost(req: Request, e: Env): Promise<Response | null> {
  const url = new URL(req.url);
  if (!isReleaseHost(url)) {
    return null;
  }
  const path = url.pathname;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return secureReleaseResponse(new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    }), path);
  }

  // Installers come from R2, not from the GitHub release they were built by.
  // A release asset is only anonymously downloadable while the repository is
  // public, and github.com is not dependably reachable from where most of
  // these users are; neither is true of this bucket. The Sparkle and Tauri
  // signatures cover the bytes, not the address, so serving the same file
  // from here is verified exactly as before.
  const download = /^\/download\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(path);
  if (download) {
    const key = download[1];
    const sizeHint = (await e.RELEASES.head(key))?.size ?? 0;
    const range = parseBytesRange(req.headers.get('range'), sizeHint);
    const object = range
      ? await e.RELEASES.get(key, { range: { offset: range.offset, length: range.length } })
      : await e.RELEASES.get(key);
    if (!object) return secureReleaseResponse(new Response('Not found', { status: 404 }), path);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    headers.set('content-disposition', `attachment; filename="${key}"`);
    if (range) {
      const end = range.offset + range.length - 1;
      headers.set('content-range', `bytes ${range.offset}-${end}/${sizeHint || '*'}`);
      headers.set('content-length', String(range.length));
      if (req.method === 'HEAD') {
        return secureReleaseResponse(new Response(null, { status: 206, headers }), path);
      }
      const bytes = await object.arrayBuffer();
      const start = bytes.byteLength === sizeHint ? range.offset : 0;
      return secureReleaseResponse(new Response(bytes.slice(start, start + range.length), {
        status: 206,
        headers,
      }), path);
    }
    headers.set('content-length', String(object.size));
    return secureReleaseResponse(new Response(req.method === 'HEAD' ? null : object.body, { headers }), path);
  }

  const assetPath = RELEASE_ASSET_MAP.get(path);
  if (!assetPath) {
    return secureReleaseResponse(new Response('Not found', { status: 404 }), path);
  }
  const assetURL = new URL(req.url);
  assetURL.pathname = assetPath;
  assetURL.searchParams.set('tono-release-revision', RELEASE_ASSET_REVISION);
  return secureReleaseResponse(await e.ASSETS.fetch(new Request(assetURL, req)), path);
}
