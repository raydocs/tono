import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type Page = 'dashboard' | 'users' | 'monitor' | 'control';
export type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

export const pages: Array<{ id: Page; label: string; group: string }> = [
  { id: 'dashboard', label: '今日', group: '日常' },
  { id: 'users', label: '客户', group: '日常' },
  { id: 'monitor', label: '服务器', group: '日常' },
  { id: 'control', label: '目录与策略', group: '配置' },
];

function currentPage(): Page {
  const value = window.location.hash.replace(/^#\/?/, '');
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
};

export function useResource<T>(
  load: () => Promise<T>,
  deps: unknown[] = [],
  refreshMs = 0,
): Live<T> {
  const [tick, setTick] = useState(0);
  const [resource, setResource] = useState<Resource<T>>({ state: 'loading' });
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [stale, setStale] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setResource({ state: 'loading' });
    load().then(
      (data) => {
        if (!active) return;
        setResource({ state: 'ready', data });
        setRefreshedAt(Date.now());
        setStale(null);
      },
      (error: unknown) => active && setResource({
        state: 'error',
        message: error instanceof Error ? error.message : 'Unable to load operations data',
      }),
    );
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    let active = true;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load().then(
        (data) => {
          if (!active) return;
          setResource({ state: 'ready', data });
          setRefreshedAt(Date.now());
          setStale(null);
        },
        (error: unknown) => active && setStale(
          error instanceof Error ? error.message : '刷新失败',
        ),
      );
    }, refreshMs);
    return () => { active = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMs, tick, ...deps]);

  return { ...resource, reload: () => setTick((value) => value + 1), refreshedAt, stale };
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
    if (typeof localStorage === 'undefined') return 30_000;
    const stored = Number(localStorage.getItem(REFRESH_KEY));
    return REFRESH_CHOICES.some((choice) => choice.ms === stored) ? stored : 30_000;
  });
  return [ms, (next: number) => {
    setMs(next);
    try { localStorage.setItem(REFRESH_KEY, String(next)); } catch { /* private mode */ }
  }];
}

const RefreshContext = createContext<{
  refreshMs: number;
  setRefreshMs: (ms: number) => void;
}>({ refreshMs: 30_000, setRefreshMs: () => undefined });

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
