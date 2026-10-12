import { useEffect, useState } from 'react';
import { BackendUnreachableError, opsApi, SessionExpiredError } from './api';
import { nowSec } from './clock';
import type { FleetDto, LiveDto } from './types';

export type FleetState =
  | { status: 'loading' }
  | { status: 'error'; message: string; sessionExpired: boolean; unreachable?: BackendUnreachableError }
  /** `unreachable` is set while the latest refetch got no answer; `fleet` is then the last good copy. */
  | { status: 'ready'; fleet: FleetDto; live: LiveDto | null; fetchedAt: number; unreachable?: BackendUnreachableError };

/**
 * The legacy fleet read, kept for the facts no verdict carries — the address,
 * the system, the ports, the hand-confirmed line tags — and for the chores on
 * 今天. Health is not read from here any more: the engine judges, once, and
 * both pages quote it (R4).
 *
 * `beat` is the shell's poll; a beat refreshes in place and a failed refresh
 * keeps the last answer, exactly as `useResource` does, so the two shell reads
 * age the same way.
 */
export function useFleet(beat = 0): FleetState & { reload: () => void } {
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
        if (!cancelled) setState({ status: 'ready', fleet, live, fetchedAt: nowSec() });
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        const sessionExpired = error instanceof SessionExpiredError;
        const unreachable = error instanceof BackendUnreachableError ? error : undefined;
        setState((current) => (
          current.status === 'ready' && !sessionExpired ? { ...current, unreachable } : {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
            sessionExpired,
            unreachable,
          }
        ));
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tick, beat]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}
