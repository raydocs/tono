import { lazy, Suspense, useEffect, useState } from 'react';
import { Empty } from '@/components/ops/Empty';
import { copy, type PageId } from '@/copy/copy';
import { readRoute, type OpsRoute } from '@/lib/hash-route';
import { useFleet } from '@/lib/use-fleet';
import { Shell } from './Shell';

/**
 * One chunk per page. The nodes page alone pulls Recharts; loading that on
 * the way to settings is how a console ends up over its size budget three
 * pages from now.
 */
const NodesPage = lazy(() => import('@/pages/Nodes'));
const TodayPage = lazy(() => import('@/pages/Today'));
const CustomersPage = lazy(() => import('@/pages/Customers'));
const ClientsPage = lazy(() => import('@/pages/Clients'));
const SettingsPage = lazy(() => import('@/pages/Settings'));

export function App() {
  const fleet = useFleet();
  const [route, setRoute] = useState<OpsRoute>(() => (
    typeof window === 'undefined' ? { page: 'today' as PageId, node: null } : readRoute()
  ));

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    if (!window.location.hash) {
      window.location.hash = '#/today';
    }
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const nodes = fleet.status === 'ready' ? fleet.fleet.nodes : [];

  return (
    <Shell fleet={fleet} nodes={nodes}>
      <Suspense fallback={<div className="page-wrap"><Empty message={copy.loading} /></div>}>
        {route.page === 'nodes' ? <NodesPage fleet={fleet} selected={route.node} />
          : route.page === 'customers' ? <CustomersPage />
            : route.page === 'clients' ? <ClientsPage />
              : route.page === 'settings' ? <SettingsPage />
                : <TodayPage />}
      </Suspense>
    </Shell>
  );
}
