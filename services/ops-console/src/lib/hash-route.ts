import { copy, type PageId } from '@/copy/copy';

const PAGES = Object.keys(copy.pages) as PageId[];

export type OpsRoute = {
  page: PageId;
  node: string | null;
};

function pageFromPath(path: string): PageId {
  const id = path.replace(/^\//, '').split('/')[0] || 'today';
  return (PAGES as string[]).includes(id) ? id as PageId : 'today';
}

export function readRoute(): OpsRoute {
  const hash = window.location.hash.replace(/^#/, '');
  const [path] = hash.split('?');
  const page = pageFromPath(path || '/today');
  const search = new URLSearchParams(window.location.search);
  const hashQuery = hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)) : null;
  const node = search.get('node') || hashQuery?.get('node') || null;
  return { page, node };
}

export function writeRoute(next: OpsRoute, replace = false) {
  const url = new URL(window.location.href);
  url.hash = `#/${next.page}`;
  if (next.node) url.searchParams.set('node', next.node);
  else url.searchParams.delete('node');
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function goPage(page: PageId) {
  const current = readRoute();
  writeRoute({ page, node: current.node && page === 'nodes' ? current.node : null });
}

export function openNode(name: string) {
  writeRoute({ page: 'nodes', node: name });
}

export function closeNode() {
  const current = readRoute();
  writeRoute({ page: current.page, node: null }, true);
}
