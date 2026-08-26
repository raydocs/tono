export type Page =
  | 'dashboard'
  | 'failures'
  | 'users'
  | 'monitor'
  | 'traffic'
  | 'control';

export const PAGE_IDS: Page[] = [
  'dashboard', 'failures', 'users', 'monitor', 'traffic', 'control',
];

const PAGE_ALIASES: Record<string, Page> = {
  homes: 'users',
  servers: 'control',
  nodes: 'control',
  catalog: 'control',
};

export type OpsHash = {
  page: Page;
  focus: string | null;
  node: string | null;
  user: string | null;
  q: string | null;
  range: string | null;
};

export const TRAFFIC_RANGES = ['24h', '7d', '90d'] as const;
export type TrafficRange = typeof TRAFFIC_RANGES[number];

export function parseTrafficRange(value: string | null | undefined): TrafficRange {
  return TRAFFIC_RANGES.includes(value as TrafficRange) ? value as TrafficRange : '24h';
}

export function emptyHash(page: Page = 'dashboard'): OpsHash {
  return { page, focus: null, node: null, user: null, q: null, range: null };
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

export function parseOpsHash(hash: string): OpsHash {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const slug = path.replace(/\/+$/, '');
  const aliased = PAGE_ALIASES[slug];
  const page = aliased
    ?? (PAGE_IDS.includes(slug as Page) ? slug as Page : 'dashboard');
  const params = new URLSearchParams(query);
  const pick = (key: string) => {
    const value = params.get(key);
    return value == null || value === '' ? null : decode(value);
  };
  return {
    page,
    focus: pick('focus'),
    node: pick('node'),
    user: pick('user'),
    q: pick('q'),
    range: pick('range'),
  };
}

export function formatOpsHash(state: OpsHash): string {
  const params = new URLSearchParams();
  if (state.focus) params.set('focus', state.focus);
  if (state.node) params.set('node', state.node);
  if (state.user) params.set('user', state.user);
  if (state.q) params.set('q', state.q);
  if (state.page === 'traffic' && state.range) params.set('range', parseTrafficRange(state.range));
  const query = params.toString();
  return query ? `#/${state.page}?${query}` : `#/${state.page}`;
}

/** Close the drawer but keep page and filters. */
export function hashWithoutDrawer(state: OpsHash): OpsHash {
  return { ...state, node: null, user: null };
}

export function nextRouteForOpenUser(current: OpsHash, userId: string, extra: Partial<OpsHash> = {}): OpsHash {
  const page = extra.page ?? 'users';
  const keepFocus = current.page === 'users' && page === 'users';
  return {
    page,
    focus: extra.focus !== undefined ? extra.focus : (keepFocus ? current.focus : null),
    node: null,
    user: userId,
    q: extra.q !== undefined ? extra.q : null,
    range: null,
  };
}

export function nextRouteForOpenNode(current: OpsHash, name: string, extra: Partial<OpsHash> = {}): OpsHash {
  const page = extra.page ?? 'monitor';
  const keepFocus = current.page === 'monitor' && page === 'monitor';
  return {
    page,
    focus: extra.focus !== undefined ? extra.focus : (keepFocus ? current.focus : null),
    node: name,
    user: null,
    q: extra.q !== undefined ? extra.q : (keepFocus ? current.q : null),
    range: extra.range !== undefined ? extra.range : (page === 'traffic' ? current.range : null),
  };
}
