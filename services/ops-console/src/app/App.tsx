import { lazy, Suspense, useEffect, useState } from 'react';
import { Empty } from '@/components/ops/Empty';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { BLANK_ROUTE, readRoute, type OpsRoute } from '@/lib/hash-route';
import { useBeat } from '@/lib/use-poll';
import { useFleet } from '@/lib/use-fleet';
import { newestFetch, useResource } from '@/lib/use-resource';
import { Shell } from './Shell';

/**
 * One chunk per page. The nodes page alone pulls Recharts; loading that on
 * the way to settings is how a console ends up over its size budget three
 * pages from now.
 */
const NodesPage = lazy(() => import('@/pages/Nodes'));
const NodeDetailPage = lazy(() => import('@/pages/NodeDetail'));
const TodayPage = lazy(() => import('@/pages/Today'));
const CustomersPage = lazy(() => import('@/pages/Customers'));
const CustomerDetailPage = lazy(() => import('@/pages/CustomerDetail'));
const ClientsPage = lazy(() => import('@/pages/Clients'));
const SettingsPage = lazy(() => import('@/pages/Settings'));

/**
 * How often the whole shell re-reads the world.
 *
 * A minute is short enough that an operator who leaves the console open on a
 * second screen is looking at the fleet rather than at a memory of it, and long
 * enough that five shared reads cost nothing. Every read hangs off this one
 * beat: pages do not poll, so changing this number changes the console's
 * refresh rate, and nothing else.
 */
const BEAT_SECONDS = 60;

export function App() {
  const beat = useBeat(BEAT_SECONDS);
  const fleet = useFleet(beat);
  /**
   * The fleet as the engine judges it. This is the nodes page's list and the
   * only thing ⌘K searches for machines: one verdict per node, computed once,
   * server-side, so this page and the daily page cannot disagree about who is
   * broken.
   */
  const nodes = useResource('nodes', async (signal) => (await opsApi.nodes(signal)).items, beat);
  /**
   * Both lists are fetched once for the whole shell rather than per page:
   * the incident page needs the customer list to name the people behind a
   * node fault, and Command-K searches both from anywhere. Two requests
   * on load beats four requests every time someone changes page.
   */
  const customers = useResource('customers', async (signal) => (await opsApi.customers(signal)).items, beat);
  const incidents = useResource('incidents', async (signal) => (await opsApi.incidents(signal)).items, beat);
  /**
   * The release list is the third thing the whole console shares: the daily
   * page needs it to know which clients are below the floor, the customer
   * table to know what "behind one version" means, and the clients page to
   * list what has shipped. One read here beats three definitions of "the
   * current version".
   */
  const releases = useResource('releases', async (signal) => (await opsApi.releases(signal)).items, beat);
  /**
   * Which source is behind, and how much of the backfill is left. The header
   * pill and the grey line under a page sentence are both this read; nothing
   * else in the console asks a second time.
   */
  const health = useResource('system-health', (signal) => opsApi.systemHealth(signal), beat);
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

  const machines = nodes.status === 'ready' ? nodes.data : [];
  const legacyNodes = fleet.status === 'ready' ? fleet.fleet.nodes : [];
  const people = customers.status === 'ready' ? customers.data : [];
  const open = incidents.status === 'ready' ? incidents.data : [];

  return (
    <Shell
      fleet={fleet}
      health={health}
      fetchedAt={newestFetch(nodes, customers, incidents, health, fleet)}
      nodes={machines}
      customers={people}
      incidents={open}
    >
      <Suspense fallback={<div className="page-wrap"><Empty message={copy.loading} /></div>}>
        {route.page === 'nodes' ? (
          route.nodeName
            ? <NodeDetailPage name={route.nodeName} customers={people} />
            : <NodesPage nodes={nodes} health={health} fleet={fleet} selected={route.node} />
        )
          : route.page === 'customers' ? (
            route.customerId
              ? <CustomerDetailPage userId={route.customerId} />
              : (
                <CustomersPage
                  customers={customers}
                  releases={releases}
                  platform={route.platform}
                  bucket={route.bucket}
                />
              )
          )
            : route.page === 'clients'
              ? <ClientsPage releases={releases} onChanged={releases.reload} />
              : route.page === 'settings' ? <SettingsPage section={route.section} />
                : (
                  <TodayPage
                    incidents={incidents}
                    customers={customers}
                    releases={releases}
                    nodes={legacyNodes}
                    selected={route.incident}
                    onChanged={incidents.reload}
                  />
                )}
      </Suspense>
    </Shell>
  );
}
