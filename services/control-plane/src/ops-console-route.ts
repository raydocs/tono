/** /ops/ renders the sole console; previous names only redirect to it. */
export function opsConsoleRedirect(url: URL): string | null {
  const path = url.pathname;
  const oldPage = /^\/ops\/(dashboard|failures|users|monitor|traffic|control|homes|servers|nodes|catalog)\/?$/.exec(path);
  const page = /^\/ops2\/(today|nodes|customers|clients|traffic|settings)\/?$/.exec(path);
  const alias = path === '/ops2' || path === '/ops2/' || path === '/ops2/index.html';
  if (path !== '/' && path !== '/ops' && path !== '/ops/index.html' && !oldPage && !alias && !page) return null;
  const target = new URL(url);
  target.pathname = '/ops/';
  if (path === '/' || oldPage) target.searchParams.set('legacy', 'ops1');
  // No fragment on root redirects: browsers retain the incoming fragment.
  const slug = oldPage?.[1] ?? page?.[1];
  if (slug) target.hash = `#/${slug}`;
  return `${target.pathname}${target.search}${target.hash}`;
}
