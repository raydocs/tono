import { useEffect, useState } from 'react';
import { opsApi, SessionExpiredError } from './api';
import type { FleetDto, LiveDto } from './types';

export type FleetState =
  | { status: 'loading' }
  | { status: 'error'; message: string; sessionExpired: boolean }
  | { status: 'ready'; fleet: FleetDto; live: LiveDto | null };

export function useFleet(): FleetState & { reload: () => void } {
  const [state, setState] = useState<FleetState>({ status: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const fleet = await opsApi.fleetNodes(ac.signal);
        let live: LiveDto | null = null;
        try {
          live = await opsApi.live(ac.signal);
        } catch (error) {
          if (error instanceof SessionExpiredError) throw error;
          live = null;
        }
        if (!cancelled) setState({ status: 'ready', fleet, live });
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        const sessionExpired = error instanceof SessionExpiredError;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          sessionExpired,
        });
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tick]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}

export function sourceStamp(fleet: FleetDto | null): { ok: boolean; at: number | null } {
  if (!fleet?.sources) return { ok: false, at: null };
  const values = Object.values(fleet.sources);
  if (values.length === 0) return { ok: false, at: null };
  const times = values.map((s) => s.updatedAt).filter((n): n is number => typeof n === 'number');
  const ready = values.some((s) => s.state === 'ready');
  return { ok: ready, at: times.length ? Math.max(...times) : null };
}
