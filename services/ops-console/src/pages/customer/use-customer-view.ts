import { useLayoutEffect, useRef, useState } from 'react';
import type { FunnelStage } from '@contract';
import type { TableSort } from '@/components/ops/DataTable';
import type { CustomerFilter } from '@/lib/customers';

type View = { filter: CustomerFilter; stage: FunnelStage | null; sort: TableSort; top: number; left: number };
// Only view preferences, in tab memory. No selection or confirmation intent.
const views = new Map<string, View>();
const initial = (): View => ({ filter: null, stage: null, sort: { id: null, direction: 'asc' }, top: 0, left: 0 });

/** The caller is keyed by platform/bucket so each URL context is independent. */
export function useCustomerView(key: string, ready: boolean) {
  const [view, setView] = useState(() => views.get(key) ?? initial());
  const latest = useRef(view);
  const container = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  function change(patch: Partial<View>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    views.set(key, next);
    setView(next);
    if (patch.top !== undefined) window.scrollTo({ top: patch.top, behavior: 'instant' });
    if (patch.left !== undefined) {
      const scroller = container.current?.querySelector<HTMLElement>('.customer-list-table');
      if (scroller) scroller.scrollLeft = patch.left;
    }
  }

  useLayoutEffect(() => {
    if (!ready) return;
    const scroller = container.current?.querySelector<HTMLElement>('.customer-list-table');
    if (!restored.current) {
      restored.current = true;
      window.scrollTo({ top: latest.current.top, behavior: 'instant' });
      if (scroller) scroller.scrollLeft = latest.current.left;
    }
    const remember = () => {
      const next = { ...latest.current, top: window.scrollY, left: scroller?.scrollLeft ?? 0 };
      latest.current = next;
      views.set(key, next);
    };
    window.addEventListener('scroll', remember, { passive: true });
    scroller?.addEventListener('scroll', remember, { passive: true });
    return () => {
      window.removeEventListener('scroll', remember);
      scroller?.removeEventListener('scroll', remember);
      // Do not copy the next page's scroll position during teardown.
    };
  }, [key, ready, view.filter, view.stage]);

  return { view, change, container };
}
