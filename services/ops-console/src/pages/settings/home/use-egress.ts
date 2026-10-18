import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copy } from '@/copy/copy';
import { egressApi, type EgressLookup } from '@/lib/home-egress';
import type { HomeExit } from '@/lib/settings-legacy';
import { useResource } from '@/lib/use-resource';

/**
 * The inventory's egress lookups: the latest one per line, which lines are
 * being dialled right now, and the one-shot lookup of every SOCKS5 line that
 * has never been looked up — a line registered a minute ago gets its address
 * the first time the table is opened, without anybody pressing anything.
 *
 * Lookups run one at a time: each is a tunnel plus nine provider requests, and
 * the free tiers would rather see them spaced than in a burst of twenty.
 */
export function useEgress(rows: readonly HomeExit[] | null, onLooked: () => void) {
  const lookups = useResource('home-exits-egress', (signal) => egressApi.lookups(signal));
  const [looking, setLooking] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(new Set<string>());
  const queue = useRef(Promise.resolve());
  const latest = useRef({ reload: lookups.reload, onLooked });
  latest.current = { reload: lookups.reload, onLooked };

  const byExit = useMemo(() => {
    const out = new Map<string, EgressLookup>();
    if (lookups.status === 'ready') for (const row of lookups.data) out.set(row.homeExitId, row);
    return out;
  }, [lookups]);

  const lookUp = useCallback((homeExitId: string) => {
    tried.current.add(homeExitId);
    setLooking((current) => new Set(current).add(homeExitId));
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        await egressApi.lookUp(homeExitId);
        latest.current.reload();
        latest.current.onLooked();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : copy.actionFailed);
      } finally {
        setLooking((current) => {
          const next = new Set(current);
          next.delete(homeExitId);
          return next;
        });
      }
    });
  }, []);

  useEffect(() => {
    if (rows === null || lookups.status !== 'ready') return;
    for (const row of rows) {
      if (row.kind !== 'socks5' || row.socks5Host === null || byExit.has(row.id) || tried.current.has(row.id)) continue;
      lookUp(row.id);
    }
  }, [rows, lookups.status, byExit, lookUp]);

  return { byExit, looking, lookUp, error };
}
