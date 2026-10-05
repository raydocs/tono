/** The only rendered console is /ops2/. Old URLs carry a one-time hash adapter. */
export function opsConsoleRedirect(url: URL): string | null {
  const path = url.pathname;
  const legacy = path === '/' || path === '/ops' || path === '/ops/' || path === '/ops/index.html';
  const oldPage = /^\/ops\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  const page = /^\/ops2\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  if (!legacy && !oldPage && path !== '/ops2' && !page) return null;
  const target = new URL(url);
  target.pathname = '/ops2/';
  if (legacy || oldPage) target.searchParams.set('legacy', 'ops1');
  // No fragment on root redirects: browsers retain the incoming fragment.
  const slug = oldPage?.[1] ?? page?.[1];
  if (slug) target.hash = `#/${slug}`;
  return `${target.pathname}${target.search}${target.hash}`;
}
