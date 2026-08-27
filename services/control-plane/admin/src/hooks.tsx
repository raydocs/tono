import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isAbortError } from './api';
import type { Page } from './lib/hash';

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

/** Consecutive failures double the poll gap, but never beyond this. */
const BACKOFF_CEILING_MS = 300_000;

function backoffDelay(refreshMs: number, failures: number): number {
  return Math.min(refreshMs * 2 ** Math.min(failures, 5), BACKOFF_CEILING_MS);
}

export function useResource<T>(
  load: (signal?: AbortSignal) => Promise<T>,
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
  const abort = useRef<AbortController | null>(null);
  const lastLoadedAt = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let timer: number | undefined;
    let failures = 0;

    // The next poll is armed only after the previous request settles, so a
    // slow Worker never has two of the same request in flight; consecutive
    // failures widen the gap instead of hammering an outage.
    const schedule = () => {
      if (!active || !refreshMs) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!active) return;
        if (document.hidden || navigator.onLine === false) {
          schedule();
          return;
        }
        run();
      }, backoffDelay(refreshMs, failures));
    };

    const run = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      const id = ++generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      if (snapshot.current.state === 'ready') setRefreshing(true);
      else if (snapshot.current.state !== 'error') setResource({ state: 'loading' });
      loadRef.current(controller.signal).then(
        (data) => {
          if (!active) return;
          failures = 0;
          schedule();
          if (id !== generation.current) return;
          lastLoadedAt.current = Date.now();
          setResource({ state: 'ready', data });
          setRefreshedAt(Date.now());
          setStale(null);
          setRefreshing(false);
        },
        (error: unknown) => {
          if (!active) return;
          if (!isAbortError(error)) failures += 1;
          schedule();
          if (id !== generation.current) return;
          // A superseded request was cancelled on purpose; it is neither an
          // error nor a stale banner.
          if (isAbortError(error)) return;
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
      if (document.hidden || !refreshMs) return;
      // A two-second alt-tab must not refire every endpoint.
      if (Date.now() - lastLoadedAt.current < refreshMs / 2) return;
      run();
    };
    const onOnline = () => {
      if (!refreshMs || document.hidden) return;
      run();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      active = false;
      generation.current += 1;
      abort.current?.abort();
      abort.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, refreshMs, enabled, ...deps]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const reloadNow = useCallback(async () => {
    const id = ++generation.current;
    if (snapshot.current.state === 'ready') setRefreshing(true);
    try {
      const data = await loadRef.current();
      if (id !== generation.current) throw new Error('已被更新的请求取代');
      lastLoadedAt.current = Date.now();
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
  }, []);

  return useMemo(() => ({
    ...resource,
    reload,
    reloadNow,
    refreshedAt,
    stale,
    refreshing,
  }), [resource, reload, reloadNow, refreshedAt, stale, refreshing]);
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
    try {
      const stored = Number(localStorage.getItem(REFRESH_KEY));
      return REFRESH_CHOICES.some((choice) => choice.ms === stored) ? stored : 15_000;
    } catch {
      return 15_000;
    }
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
  const value = useMemo(() => ({ refreshMs, setRefreshMs }), [refreshMs, setRefreshMs]);
  return (
    <RefreshContext.Provider value={value}>
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
  load: (key: K, signal?: AbortSignal) => Promise<T>,
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
  const abort = useRef<AbortController | null>(null);
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
    let timer: number | undefined;
    let failures = 0;

    const schedule = () => {
      if (!active || !refreshMs) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!active) return;
        if (document.hidden || navigator.onLine === false) {
          schedule();
          return;
        }
        run(key);
      }, backoffDelay(refreshMs, failures));
    };

    const run = (forKey: K) => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      const id = ++generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const cached = cache.current.get(forKey);
      if (cached) setRefreshing(true);
      loadRef.current(forKey, controller.signal).then(
        (data) => {
          if (!active) return;
          failures = 0;
          schedule();
          if (id !== generation.current) return;
          cache.current.set(forKey, { data, refreshedAt: Date.now() });
          if (forKey !== key) return;
          setResource({ state: 'ready', data });
          setSnapshotKey(forKey);
          setRefreshedAt(Date.now());
          setStale(null);
          setRefreshing(false);
        },
        (error: unknown) => {
          if (!active) return;
          if (!isAbortError(error)) failures += 1;
          schedule();
          if (id !== generation.current) return;
          if (isAbortError(error)) return;
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
      if (document.hidden || !refreshMs) return;
      const at = cache.current.get(key)?.refreshedAt ?? 0;
      if (Date.now() - at < refreshMs / 2) return;
      run(key);
    };
    const onOnline = () => {
      if (!refreshMs || document.hidden) return;
      run(key);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      active = false;
      generation.current += 1;
      abort.current?.abort();
      abort.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [key, refreshMs, enabled, tick]);

  // Keep the key's last snapshot visible while a manual refresh runs. Deleting
  // it here used to blank the chart and, because no effect dependency changed,
  // did not start another request at all.
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const reloadNow = useCallback(async () => {
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
  }, [key]);

  return useMemo(() => ({
    ...resource,
    reload,
    reloadNow,
    refreshedAt,
    stale,
    refreshing,
    requestedKey,
    snapshotKey,
  }), [resource, reload, reloadNow, refreshedAt, stale, refreshing, requestedKey, snapshotKey]);
}
