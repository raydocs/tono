import { EmptyLine, ErrorLine } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { getJson } from '@/lib/api';
import { sortClusters } from '@/lib/failure-clusters';
import { useResource } from '@/lib/use-resource';
import '@/styles/today-clusters.css';
import { ClusterRow } from './ClusterRow';
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
  const hasSevere = resource.data.clusters.some((cluster) => cluster.severity === 'p0');
  return (
    <Section
      title={
        <>
          {copy.diagnosticsPanel.clustersTitle}
          {/* Sized for reading, in the Today tab chips' muted colour and gap. */}
          <span className="cluster-count">{resource.data.clusters.length}</span>
        </>
      }
    >
      <ul className="cluster-list" data-severity={hasSevere ? 'some' : 'none'}>
        {sortClusters(resource.data.clusters).map((cluster) => (
          <ClusterRow key={cluster.id} cluster={cluster} showSeverity={hasSevere} />
        ))}
      </ul>
    </Section>
  );
}
