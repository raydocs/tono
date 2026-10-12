import { EmptyLine, ErrorLine } from '@/components/ops/Empty';
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
  if (resource.status === 'loading') return <EmptyLine message={copy.loading} />;
  /*
   * Nothing to list is one grey line, not a section: a heading over "none"
   * or "not deployed yet" promises a block that is not there, and the main
   * column paid a heading's height for it on every visit.
   */
  if (resource.status === 'error') {
    return <ErrorLine message={copy.diagnosticsPanel.clustersUnavailable} onRetry={resource.reload} />;
  }
  if (resource.data.clusters.length === 0) {
    return <p className="text-fine" role="status">{copy.diagnosticsPanel.clustersNone}</p>;
  }
  return (
    <Section title={copy.diagnosticsPanel.clustersTitle}>
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
    </Section>
  );
}
