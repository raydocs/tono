import type { AdoptionBucket, Platform } from '@contract';
import { copy, type PageId } from '@/copy/copy';

const PAGES = Object.keys(copy.pages) as PageId[];
const PLATFORMS: string[] = ['macos', 'windows', 'linux', 'android', 'ios'];
const BUCKETS: string[] = ['current', 'behind_one', 'behind_more', 'unreported'];

export type OpsRoute = {
  page: PageId;
  /** `#/nodes` opens its detail in a drawer, so the node travels beside the page. */
  node: string | null;
  /** `#/customers/:id` is a full page, so the id is a path segment, not a parameter. */
  customerId: string | null;
  /** `#/today?incident=` — the drawer has to survive a reload and a pasted link. */
  incident: string | null;
  /**
   * `#/customers?platform=&bucket=` — where a cell of the 客户端 matrix lands.
   * The pair is the whole of the link's meaning: a bucket without a platform
   * is "behind one version of what", so an unknown or lone value is dropped
   * rather than half-applied.
   */
  platform: Platform | null;
  bucket: AdoptionBucket | null;
};

/** What the route is before a window exists, and the base every jump starts from. */
export const BLANK_ROUTE: OpsRoute = {
  page: 'today',
  node: null,
  customerId: null,
  incident: null,
  platform: null,
  bucket: null,
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
  const platform = read('platform');
  const bucket = read('bucket');
  const pair = platform !== null && PLATFORMS.includes(platform);
  return {
    page,
    node: read('node'),
    customerId: page === 'customers' && segments[1] ? decodeURIComponent(segments[1]) : null,
    incident: read('incident'),
    platform: pair ? platform as Platform : null,
    bucket: pair && bucket !== null && BUCKETS.includes(bucket) ? bucket as AdoptionBucket : null,
  };
}

export function writeRoute(next: OpsRoute, replace = false) {
  const url = new URL(window.location.href);
  url.hash = next.customerId
    ? `#/${next.page}/${encodeURIComponent(next.customerId)}`
    : `#/${next.page}`;
  const params = [
    ['node', next.node],
    ['incident', next.incident],
    ['platform', next.platform],
    ['bucket', next.bucket],
  ] as const;
  for (const [key, value] of params) {
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

export function closeNode() {
  const current = readRoute();
  writeRoute({ ...current, node: null }, true);
}

export function openCustomer(userId: string) {
  writeRoute({ ...EMPTY, page: 'customers', customerId: userId });
}

export function customersHref(platform: Platform, bucket: AdoptionBucket): string {
  return `#/customers?platform=${platform}&bucket=${bucket}`;
}

/**
 * The 客户 page's platform and version filters live in the URL, because a
 * cell of the 客户端 matrix is a link into them and a link has to be able to
 * say which one. Replacing rather than pushing: a filter is not a place, and
 * six chip clicks should not be six presses of the back button.
 *
 * A bucket without a platform is "behind one version of what", so dropping
 * the platform drops the bucket with it.
 */
export function setCustomerFilter(platform: Platform | null, bucket: AdoptionBucket | null) {
  writeRoute({
    ...EMPTY,
    page: 'customers',
    platform,
    bucket: platform === null ? null : bucket,
  }, true);
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
