import { useCallback, useEffect, useState } from 'react';
import { emptyHash, formatOpsHash, nextRouteForOpenNode, nextRouteForOpenUser, parseOpsHash, type OpsHash, type Page } from './hash';

function readHash(): OpsHash {
  if (typeof window === 'undefined') return emptyHash();
  return parseOpsHash(window.location.hash);
}

export function useOpsRoute(): {
  route: OpsHash;
  page: Page;
  setRoute: (next: OpsHash | ((current: OpsHash) => OpsHash)) => void;
  openNode: (name: string, extra?: Partial<OpsHash>) => void;
  openUser: (userId: string, extra?: Partial<OpsHash>) => void;
  closeDrawer: () => void;
} {
  const [route, setRouteState] = useState<OpsHash>(readHash);

  useEffect(() => {
    const sync = () => setRouteState(readHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const setRoute = useCallback((next: OpsHash | ((current: OpsHash) => OpsHash)) => {
    const resolved = typeof next === 'function' ? next(parseOpsHash(window.location.hash)) : next;
    const hash = formatOpsHash(resolved);
    if (window.location.hash !== hash) window.location.hash = hash;
    else setRouteState(resolved);
  }, []);

  const openNode = useCallback((name: string, extra: Partial<OpsHash> = {}) => {
    setRoute((current) => nextRouteForOpenNode(current, name, extra));
  }, [setRoute]);
  const openUser = useCallback((userId: string, extra: Partial<OpsHash> = {}) => {
    setRoute((current) => nextRouteForOpenUser(current, userId, extra));
  }, [setRoute]);
  const closeDrawer = useCallback(() => {
    setRoute((current) => ({ ...current, node: null, user: null }));
  }, [setRoute]);

  return {
    route,
    page: route.page,
    setRoute,
    openNode,
    openUser,
    closeDrawer,
  };
}
