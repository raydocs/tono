import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type Page = 'dashboard' | 'failures' | 'users' | 'monitor' | 'traffic' | 'control';
export type Resource<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: T };

export const pages: Array<{ id: Page; label: string; group: string }> = [
  { id: 'dashboard', label: '总览', group: '日常' },
  { id: 'failures', label: '故障', group: '日常' },
  { id: 'monitor', label: '服务器', group: '日常' },
  { id: 'users', label: '客户', group: '日常' },
  { id: 'traffic', label: '流量', group: '日常' },
  { id: 'control', label: '目录和规则', group: '配置' },
];

function currentPage(): Page {
  const value = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  if (value === 'homes') return 'users';
  if (value === 'servers' || value === 'nodes' || value === 'catalog') return 'control';
  return pages.some((page) => page.id === value) ? value as Page : 'dashboard';
}

export function usePage() {
  const [page, setPage] = useState(currentPage);
  useEffect(() => {
    const update = () => setPage(currentPage());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return page;
}

/**
 * A resource plus the two facts about it that are not in the data: when it was
 * last successfully read, and why the most recent background refresh failed.
 * Both exist because a failing refresh deliberately keeps showing the last good
 * snapshot rather than blanking the page — which is only honest if the page
 * says so. See `DataHealth` in ui.tsx, which is what says so.
 */
export type Live<T> = Resource<T> & {
  reload: () => void;
  reloadNow: () => Promise<T>;
  refreshedAt: number;
  stale: string | null;
  refreshing: boolean;
};

export function useResource<T>(
  load: () => Promise<T>,
  deps: unknown[] = [],
  refreshMs = 0,
  enabled = true,
): Live<T> {
  const [tick, setTick] = useState(0);
  const [resource, setResource] = useState<Resource<T>>({ state: 'loading' });
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [stale, setStale] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const snapshot = useRef<Resource<T>>({ state: 'loading' });
  snapshot.current = resource;
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const run = () => {
      const id = ++generation.current;
      if (snapshot.current.state === 'ready') setRefreshing(true);
      else if (snapshot.current.state !== 'error') setResource({ state: 'loading' });
      loadRef.current().then(
        (data) => {
          if (!active || id !== generation.current) return;
          setResource({ state: 'ready', data });
          setRefreshedAt(Date.now());
          setStale(null);
          setRefreshing(false);
        },
        (error: unknown) => {
          if (!active || id !== generation.current) return;
          const message = error instanceof Error ? error.message : '数据加载失败';
          setRefreshing(false);
          if (snapshot.current.state === 'ready') {
            setStale(message);
            return;
          }
          setResource({ state: 'error', message });
        },
      );
    };

    run();

    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) run();
    };
    document.addEventListener('visibilitychange', onVisible);

    let timer: ReturnType<typeof setInterval> | undefined;
    if (refreshMs) {
      timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        run();
      }, refreshMs);
    }

    return () => {
      active = false;
      generation.current += 1;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, refreshMs, enabled, ...deps]);

  return {
    ...resource,
    reload: () => setTick((value) => value + 1),
    reloadNow: async () => {
      const id = ++generation.current;
      if (snapshot.current.state === 'ready') setRefreshing(true);
      try {
        const data = await loadRef.current();
        if (id !== generation.current) throw new Error('已被更新的请求取代');
        setResource({ state: 'ready', data });
        setRefreshedAt(Date.now());
        setStale(null);
        setRefreshing(false);
        return data;
      } catch (error) {
        // A timer, key change, unmount, or newer manual request owns the state.
        // Let the caller know this request did not win, but never let its late
        // completion overwrite a newer successful snapshot with a false stale
        // banner.
        if (id !== generation.current) throw error;
        const message = error instanceof Error ? error.message : '数据加载失败';
        setRefreshing(false);
        if (snapshot.current.state !== 'ready') setResource({ state: 'error', message });
        else setStale(message);
        throw error;
      }
    },
    refreshedAt,
    stale,
    refreshing,
  };
}

export const REFRESH_CHOICES = [
  { label: '关闭', ms: 0 },
  { label: '15 秒', ms: 15_000 },
  { label: '30 秒', ms: 30_000 },
  { label: '60 秒', ms: 60_000 },
];
const REFRESH_KEY = 'tono-ops-refresh-ms';

function useRefreshInterval(): [number, (ms: number) => void] {
  const [ms, setMs] = useState(() => {
    if (typeof localStorage === 'undefined') return 15_000;
    const stored = Number(localStorage.getItem(REFRESH_KEY));
    return REFRESH_CHOICES.some((choice) => choice.ms === stored) ? stored : 15_000;
  });
  return [ms, (next: number) => {
    setMs(next);
    try { localStorage.setItem(REFRESH_KEY, String(next)); } catch { /* private mode */ }
  }];
}

const RefreshContext = createContext<{
  refreshMs: number;
  setRefreshMs: (ms: number) => void;
}>({ refreshMs: 15_000, setRefreshMs: () => undefined });

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshMs, setRefreshMs] = useRefreshInterval();
  return (
    <RefreshContext.Provider value={{ refreshMs, setRefreshMs }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshContext);
}

export type KeyedLive<T, K extends string = string> = Live<T> & {
  requestedKey: K;
  snapshotKey: K | null;
};

export function useKeyedResource<T, K extends string>(
  key: K,
  load: (key: K) => Promise<T>,
  refreshMs = 0,
  enabled = true,
): KeyedLive<T, K> {
  const [tick, setTick] = useState(0);
  const [requestedKey, setRequestedKey] = useState(key);
  const [snapshotKey, setSnapshotKey] = useState<K | null>(null);
  const [resource, setResource] = useState<Resource<T>>({ state: 'loading' });
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [stale, setStale] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cache = useRef(new Map<K, { data: T; refreshedAt: number }>());
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setRequestedKey(key);
    setRefreshing(false);
    const cached = cache.current.get(key);
    if (cached) {
      setResource({ state: 'ready', data: cached.data });
      setSnapshotKey(key);
      setRefreshedAt(cached.refreshedAt);
      setStale(null);
    } else {
      setResource({ state: 'loading' });
      setSnapshotKey(null);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const run = (forKey: K) => {
      const id = ++generation.current;
      const cached = cache.current.get(forKey);
      if (cached) setRefreshing(true);
      loadRef.current(forKey).then(
        (data) => {
          if (!active || id !== generation.current) return;
          cache.current.set(forKey, { data, refreshedAt: Date.now() });
          if (forKey !== key) return;
          setResource({ state: 'ready', data });
          setSnapshotKey(forKey);
          setRefreshedAt(Date.now());
          setStale(null);
          setRefreshing(false);
        },
        (error: unknown) => {
          if (!active || id !== generation.current) return;
          if (forKey !== key) return;
          const message = error instanceof Error ? error.message : '数据加载失败';
          setRefreshing(false);
          if (cache.current.has(forKey)) {
            setStale(message);
            return;
          }
          setSnapshotKey(null);
          setResource({ state: 'error', message });
        },
      );
    };
    run(key);
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) run(key);
    };
    document.addEventListener('visibilitychange', onVisible);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (refreshMs) {
      timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        run(key);
      }, refreshMs);
    }
    return () => {
      active = false;
      generation.current += 1;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
  }, [key, refreshMs, enabled, tick]);

  return {
    ...resource,
    // Keep the key's last snapshot visible while a manual refresh runs. Deleting
    // it here used to blank the chart and, because no effect dependency changed,
    // did not start another request at all.
    reload: () => setTick((value) => value + 1),
    reloadNow: async () => {
      const id = ++generation.current;
      const cached = cache.current.get(key);
      if (cached) setRefreshing(true);
      try {
        const data = await loadRef.current(key);
        if (id !== generation.current) throw new Error('已被更新的请求取代');
        const at = Date.now();
        cache.current.set(key, { data, refreshedAt: at });
        setResource({ state: 'ready', data });
        setSnapshotKey(key);
        setRefreshedAt(at);
        setStale(null);
        setRefreshing(false);
        return data;
      } catch (error) {
        // A key change or newer request owns the visible state now.
        if (id !== generation.current) throw error;
        const message = error instanceof Error ? error.message : '数据加载失败';
        setRefreshing(false);
        if (cache.current.has(key)) setStale(message);
        else {
          setSnapshotKey(null);
          setResource({ state: 'error', message });
        }
        throw error;
      }
    },
    refreshedAt,
    stale,
    refreshing,
    requestedKey,
    snapshotKey,
  };
}
