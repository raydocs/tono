import { copy } from '@/copy/copy';
import { clusterCode, clusterNode, clusterStage, clusterStatus } from '@/copy/diagnostics';
import type { FailureCluster } from './types';

/**
 * One cluster, said in Chinese, in five columns that line up across rows:
 * severity, sentence, where it failed, who it reached, and whether it is still going.
 * The machine code stays one hover away on the sentence; a value nobody has a
 * word for prints as it came, so nothing hides.
 *
 * A row does not open anything: the console has no cluster page yet, so the
 * row carries no hover state or pointer on purpose. Do not add one until it
 * drills down.
 */
export function ClusterRow({ cluster }: { cluster: FailureCluster }) {
  const stage = clusterStage(cluster.stage);
  const platform = `${cluster.platform} ${cluster.appVersion}`;
  const node = clusterNode(cluster.node);
  return (
    <li className={cluster.status === 'quiet' ? 'cluster-row is-quiet' : 'cluster-row'}>
      {/* Always rendered so the sentences share one x; empty unless p0. The
          label is the one the incident card puts before its subject. */}
      <span className="cluster-severity">{cluster.severity === 'p0' ? copy.severity.severe : null}</span>
      <span className="cluster-sentence" title={cluster.code}>{clusterCode(cluster.code)}</span>
      {/* Three flex items; the dots between them are CSS (`::before` on items
          two and up), hidden on a phone where the items wrap, so no line starts
          or ends on a dot. Only the node can be long: it alone gives way. */}
      <span className="cluster-detail" title={`${stage} · ${platform} · ${node}`}>
        <span className="cluster-seg cluster-stage">{stage}</span>
        <span className="cluster-seg cluster-platform">{platform}</span>
        <span className="cluster-seg cluster-node">{node}</span>
      </span>
      <span className="cluster-counts">{copy.diagnosticsPanel.clusterReach(cluster.users, cluster.devices)}</span>
      <span className="ops-tag cluster-status">{clusterStatus(cluster.status)}</span>
    </li>
  );
}
