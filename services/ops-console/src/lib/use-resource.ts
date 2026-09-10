import { useEffect, useRef, useState } from 'react';
import { SessionExpiredError } from './api';
import { nowSec } from './clock';

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; sessionExpired: boolean }
  /** `fetchedAt` is when this copy arrived, which is what 本页截至 prints. */
  | { status: 'ready'; data: T; fetchedAt: number };

/**
 * One fetch, three states, and a `reload` the write actions call after a POST.
 *
 * `key` is what identifies the request — a customer id, an incident id — and
 * is the only thing the effect depends on besides the beat. The loader itself
 * lives in a ref: every page would otherwise have to `useCallback` its closure,
 * and the one that forgot would refetch on every render, which on the 客户
 * detail page is five requests a keystroke.
 *
 * `beat` is the shell's poll. A beat refetches in place: the rows on screen
 * stay put and are replaced when the answer comes, because blanking a table to
 * 载入中 every minute is how a console becomes something you stop leaving open.
 * A refetch that fails keeps the last answer for the same reason — the page
 * stamp ages and says so, and only an expired session takes the page away,
 * since nothing after that will ever be current again.
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  beat = 0,
): Resource<T> & { reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (key === null) return undefined;
    const ac = new AbortController();
    let cancelled = false;
    // A different subject is a different page: that one does have to blank,
    // or the previous customer's numbers sit under the new customer's name.
    const changed = asked.current !== key;
    asked.current = key;
    setState((current) => (
      !changed && current.status === 'ready' ? current : { status: 'loading' }
    ));
    loader.current(ac.signal).then(
      (data) => { if (!cancelled) setState({ status: 'ready', data, fetchedAt: nowSec() }); },
      (error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        const sessionExpired = error instanceof SessionExpiredError;
        setState((current) => (
          current.status === 'ready' && !sessionExpired ? current : {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
            sessionExpired,
          }
        ));
      },
    );
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [key, tick, beat]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}

/** When each of a page's reads last landed, or null while none has. */
export function newestFetch(...resources: Array<{ status: string; fetchedAt?: number }>): number | null {
  let newest: number | null = null;
  for (const resource of resources) {
    const at = resource.fetchedAt;
    if (at === undefined) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}
