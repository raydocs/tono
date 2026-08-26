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
  { id: 'users', label: '客户', group: '日常' },
  { id: 'monitor', label: '服务器', group: '日常' },
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

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let generation = 0;
    const run = () => {
      const id = ++generation;
      if (snapshot.current.state === 'ready') setRefreshing(true);
      else if (snapshot.current.state !== 'error') setResource({ state: 'loading' });
      load().then(
        (data) => {
          if (!active || id !== generation) return;
          setResource({ state: 'ready', data });
          setRefreshedAt(Date.now());
          setStale(null);
          setRefreshing(false);
        },
        (error: unknown) => {
          if (!active || id !== generation) return;
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
      generation += 1;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, refreshMs, enabled, ...deps]);

  return {
    ...resource,
    reload: () => setTick((value) => value + 1),
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
