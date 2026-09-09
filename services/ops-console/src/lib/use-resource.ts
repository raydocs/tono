import { useEffect, useRef, useState } from 'react';
import { SessionExpiredError } from './api';

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; sessionExpired: boolean }
  | { status: 'ready'; data: T };

/**
 * One fetch, three states, and a `reload` the write actions call after a POST.
 *
 * `key` is what identifies the request — a customer id, an incident id — and
 * is the only thing the effect depends on. The loader itself lives in a ref:
 * every page would otherwise have to `useCallback` its closure, and the one
 * that forgot would refetch on every render, which on the 客户 detail page is
 * five requests a keystroke.
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> & { reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    if (key === null) return undefined;
    const ac = new AbortController();
    let cancelled = false;
    setState({ status: 'loading' });
    loader.current(ac.signal).then(
      (data) => { if (!cancelled) setState({ status: 'ready', data }); },
      (error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          sessionExpired: error instanceof SessionExpiredError,
        });
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [key, tick]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}
