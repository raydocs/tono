import { copy, type PageId } from '@/copy/copy';

const PAGES = Object.keys(copy.pages) as PageId[];

export type OpsRoute = {
  page: PageId;
  /** `#/nodes` opens its detail in a drawer, so the node travels beside the page. */
  node: string | null;
  /** `#/nodes/:name` is the full page behind that drawer, so the name is a segment. */
  nodeName: string | null;
  /** `#/customers/:id` is a full page, so the id is a path segment, not a parameter. */
  customerId: string | null;
  /** `#/today?incident=` — the drawer has to survive a reload and a pasted link. */
  incident: string | null;
};

/** What the route is before a window exists, and the base every jump starts from. */
export const BLANK_ROUTE: OpsRoute = {
  page: 'today',
  node: null,
  nodeName: null,
  customerId: null,
  incident: null,
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
  const segment = segments[1] ? decodeURIComponent(segments[1]) : null;
  return {
    page,
    node: read('node'),
    nodeName: page === 'nodes' ? segment : null,
    customerId: page === 'customers' ? segment : null,
    incident: read('incident'),
  };
}

/** The one path segment a page may carry: a customer id, or a node name. */
function segmentOf(route: OpsRoute): string | null {
  if (route.page === 'customers') return route.customerId;
  if (route.page === 'nodes') return route.nodeName;
  return null;
}

export function writeRoute(next: OpsRoute, replace = false) {
  const url = new URL(window.location.href);
  const segment = segmentOf(next);
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

export function openNode(name: string) {
  writeRoute({ ...EMPTY, page: 'nodes', node: name });
}

/**
 * The drawer answers "which machine is this"; the page answers "what do I do
 * about it". Opening the page drops the drawer selection rather than keeping
 * both, so going back lands on the list instead of on the list plus a sheet.
 */
export function openNodePage(name: string) {
  writeRoute({ ...EMPTY, page: 'nodes', nodeName: name });
}

export function closeNodePage() {
  writeRoute({ ...EMPTY, page: 'nodes' });
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
