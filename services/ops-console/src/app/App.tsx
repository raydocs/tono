import { useEffect, useState } from 'react';
import { Empty } from '@/components/ops/Empty';
import { copy, type PageId } from '@/copy/copy';
import { readRoute, type OpsRoute } from '@/lib/hash-route';
import { useFleet } from '@/lib/use-fleet';
import { NodesPage } from '@/pages/Nodes';
import { Shell } from './Shell';

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
      {route.page === 'nodes' ? (
        <NodesPage fleet={fleet} selected={route.node} />
      ) : (
        <div className="page-wrap">
          <Empty message={copy.emptyMigrated} />
        </div>
      )}
    </Shell>
  );
}
