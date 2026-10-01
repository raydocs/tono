import { EmptyLine } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { getJson } from '@/lib/api';
import { useResource } from '@/lib/use-resource';
import { clusterLine } from './format';
import type { FailureClusterList } from './types';

/**
 * Open failure clusters for the operator console.
 *
 * Isolated from the rest of the shell: it fetches its own read and can move
 * to another console without taking a page, a nav item, or a contract type.
 * The route is `GET /api/v1/ops/failure-clusters` (Access, customers.read).
 */
export function FailureClusters() {
  const resource = useResource('failure-clusters', (signal) =>
    getJson<FailureClusterList>('failure-clusters', signal),
  );
  return (
    <Section title={copy.diagnosticsPanel.clustersTitle}>
      {resource.status === 'ready' && resource.data.clusters.length === 0 ? (
        <EmptyLine message={copy.diagnosticsPanel.clustersNone} />
      ) : null}
      {resource.status === 'ready' && resource.data.clusters.length > 0 ? (
        <ul className="grid gap-2">
          {resource.data.clusters.map((cluster) => (
            <li key={cluster.id} className="text-sm">
              <span className="font-mono">{clusterLine(cluster)}</span>
              <span className="text-[var(--muted-foreground)]">
                {' '}
                {copy.diagnosticsPanel.clusterReach(cluster.users, cluster.devices)} · {cluster.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {resource.status === 'loading' ? <EmptyLine message={copy.diagnosticsPanel.clustersLoading} /> : null}
      {resource.status === 'error' ? (
        <EmptyLine message={copy.diagnosticsPanel.clustersUnavailable} />
      ) : null}
    </Section>
  );
}
