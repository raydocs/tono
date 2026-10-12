import { copy } from '@/copy/copy';
import { clusterCode, clusterNode, clusterStage, clusterStatus } from '@/copy/diagnostics';
import type { FailureCluster } from './types';

/**
 * One cluster, said in Chinese, in four columns that line up across rows:
 * sentence, where it failed, who it reached, and whether it is still going.
 * The machine code stays one hover away on the sentence; a value nobody has a
 * word for prints as it came, so nothing hides.
 *
 * A row does not open anything: the console has no cluster page yet, so the
 * row carries no hover state or pointer on purpose. Do not add one until it
 * drills down.
 */
export function ClusterRow({ cluster }: { cluster: FailureCluster }) {
  return (
    <li className="cluster-row">
      <span className="cluster-sentence">
        {cluster.severity === 'p0' ? (
          // The same label the incident card puts before its subject.
          <span className="text-micro text-[var(--muted-foreground)]">{copy.severity.severe}</span>
        ) : null}
        <span title={cluster.code}>{clusterCode(cluster.code)}</span>
      </span>
      <span className="cluster-detail">
        {clusterStage(cluster.stage)}
        {' · '}{cluster.platform} {cluster.appVersion}
        {' · '}{clusterNode(cluster.node)}
      </span>
      <span className="cluster-counts">{copy.diagnosticsPanel.clusterReach(cluster.users, cluster.devices)}</span>
      <span className="ops-tag cluster-status">{clusterStatus(cluster.status)}</span>
    </li>
  );
}
