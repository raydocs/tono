import { copy, type PageId } from '@/copy/copy';

const PAGES = Object.keys(copy.pages) as PageId[];

export type OpsRoute = {
  page: PageId;
  /** `#/nodes` opens its detail in a drawer, so the node travels beside the page. */
  node: string | null;
  /** `#/customers/:id` is a full page, so the id is a path segment, not a parameter. */
  customerId: string | null;
  /** `#/today?incident=` — the drawer has to survive a reload and a pasted link. */
  incident: string | null;
  /** `#/settings/alerts` — the six 设置 sections are pages, not tabs, so each has a link. */
  section: string | null;
};

/** What the route is before a window exists, and the base every jump starts from. */
export const BLANK_ROUTE: OpsRoute = {
  page: 'today', node: null, customerId: null, incident: null, section: null,
};
const EMPTY = BLANK_ROUTE;

function pageFromPath(path: string): PageId {
  const id = path.replace(/^\//, '').split('/')[0] || 'today';
  return (PAGES as string[]).includes(id) ? id as PageId : 'today';
}

export function readRoute(): OpsRoute {
  const hash = window.location.hash.replace(/^#/, '');
  const [path] = hash.split('?');
  const segments = (path || '/today').replace(/^\//, '').split('/');
  const page = pageFromPath(path || '/today');
  const search = new URLSearchParams(window.location.search);
  const hashQuery = hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)) : null;
  const read = (key: string) => search.get(key) || hashQuery?.get(key) || null;
  return {
    page,
    node: read('node'),
    customerId: page === 'customers' && segments[1] ? decodeURIComponent(segments[1]) : null,
    incident: read('incident'),
    section: page === 'settings' && segments[1] ? decodeURIComponent(segments[1]) : null,
  };
}

export function writeRoute(next: OpsRoute, replace = false) {
  const url = new URL(window.location.href);
  const segment = next.customerId ?? (next.page === 'settings' ? next.section : null);
  url.hash = segment
    ? `#/${next.page}/${encodeURIComponent(segment)}`
    : `#/${next.page}`;
  for (const [key, value] of [['node', next.node], ['incident', next.incident]] as const) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Moving between pages drops the other page's selection. Carrying `node` on to
 * 今天 left the fleet drawer's id in the URL, where the next `⌘K` jump would
 * reopen a drawer nobody asked for.
 */
export function goPage(page: PageId) {
  const current = readRoute();
  writeRoute({
    ...EMPTY,
    page,
    node: page === 'nodes' ? current.node : null,
    incident: page === 'today' ? current.incident : null,
  });
}

/** The rail inside 设置; the page falls back to 告警 when the hash names none. */
export function openSettings(section: string) {
  writeRoute({ ...EMPTY, page: 'settings', section });
}

export function openNode(name: string) {
  writeRoute({ ...EMPTY, page: 'nodes', node: name });
}

export function closeNode() {
  const current = readRoute();
  writeRoute({ ...current, node: null }, true);
}

export function openCustomer(userId: string) {
  writeRoute({ ...EMPTY, page: 'customers', customerId: userId });
}

export function closeCustomer() {
  writeRoute({ ...EMPTY, page: 'customers' });
}

export function openIncident(id: string) {
  const current = readRoute();
  writeRoute({ ...EMPTY, page: 'today', incident: id, node: current.node });
}

export function closeIncident() {
  const current = readRoute();
  writeRoute({ ...current, incident: null }, true);
}
