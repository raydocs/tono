import { lazy, Suspense, useEffect, useState } from 'react';
import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { BLANK_ROUTE, readRoute, type OpsRoute } from '@/lib/hash-route';
import { useFleet } from '@/lib/use-fleet';
import { useResource } from '@/lib/use-resource';
import { Shell } from './Shell';

/**
 * One chunk per page. The nodes page alone pulls Recharts; loading that on
 * the way to settings is how a console ends up over its size budget three
 * pages from now.
 */
const NodesPage = lazy(() => import('@/pages/Nodes'));
const TodayPage = lazy(() => import('@/pages/Today'));
const CustomersPage = lazy(() => import('@/pages/Customers'));
const CustomerDetailPage = lazy(() => import('@/pages/CustomerDetail'));
const ClientsPage = lazy(() => import('@/pages/Clients'));
const SettingsPage = lazy(() => import('@/pages/Settings'));

export function App() {
  const fleet = useFleet();
  /**
   * Both lists are fetched once for the whole shell rather than per page:
   * the incident page needs the customer list to name the people behind a
   * node fault, and Command-K searches both from anywhere. Two requests
   * on load beats four requests every time someone changes page.
   */
  const customers = useResource('customers', async (signal) => (await opsApi.customers(signal)).items);
  const incidents = useResource('incidents', async (signal) => (await opsApi.incidents(signal)).items);
  const [route, setRoute] = useState<OpsRoute>(() => (
    typeof window === 'undefined' ? BLANK_ROUTE : readRoute()
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
  const people = customers.status === 'ready' ? customers.data : [];
  const open = incidents.status === 'ready' ? incidents.data : [];

  return (
    <Shell fleet={fleet} nodes={nodes} customers={people} incidents={open}>
      <Suspense fallback={<div className="page-wrap"><Empty message={copy.loading} /></div>}>
        {route.page === 'nodes' ? <NodesPage fleet={fleet} selected={route.node} />
          : route.page === 'customers' ? (
            route.customerId
              ? <CustomerDetailPage userId={route.customerId} />
              : <CustomersPage customers={customers} />
          )
            : route.page === 'clients' ? <ClientsPage />
              : route.page === 'settings' ? <SettingsPage section={route.section} />
                : (
                  <TodayPage
                    incidents={incidents}
                    customers={customers}
                    nodes={nodes}
                    selected={route.incident}
                    onChanged={incidents.reload}
                  />
                )}
      </Suspense>
    </Shell>
  );
}
