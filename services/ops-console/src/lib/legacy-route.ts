import { parseOpsHash } from '@legacy-lib/hash';

/** Run once before React reads the URL, including fragments inherited by a 302. */
export function migrateLegacyRoute() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('legacy') !== 'ops1') return;
  const old = parseOpsHash(url.hash);
  const read = (key: string, fallback: string | null) => url.searchParams.get(key) || fallback;
  const user = read('user', old.user);
  const node = read('node', old.node);
  const query = read('q', old.q);
  const focus = read('focus', old.focus);
  const range = read('range', old.range);
  const pages = { dashboard: 'today', failures: 'today', monitor: 'nodes',
    users: 'customers', traffic: 'traffic', control: 'settings/catalog' };
  let path = pages[old.page];
  if (user) path = `customers/${encodeURIComponent(user)}`;
  else if (node) path = `nodes/${encodeURIComponent(node)}`;
  else if (old.page === 'control' && focus === 'policy') path = 'settings/policy';
  else if (old.page === 'users' && focus === 'homes') path = 'settings/homeinventory';
  for (const key of ['legacy', 'user', 'node', 'focus', 'q', 'range', 'from']) url.searchParams.delete(key);
  if (query && (old.page === 'users' || old.page === 'monitor')) url.searchParams.set('q', query);
  if (old.page === 'traffic') {
    url.searchParams.set('range', range ?? '24h');
    if (user || node) url.searchParams.set('from', 'traffic');
  }
  // Old cohort predicates differ from the engine's verdicts. Never pretend
  // they are equivalent, and never silently show an unfiltered list.
  const appliedFocus = !user && !node && ((old.page === 'users' && focus === 'homes') || (old.page === 'control' && focus === 'policy'));
  // Search no longer includes every old customer/node field. Keep supported
  // queries, but explain the narrower scope without storing private values twice.
  if ((focus && !appliedFocus) || query) url.searchParams.set('legacyFilter', '1');
  url.hash = `#/${path}`;
  window.history.replaceState({}, '', url);
}
