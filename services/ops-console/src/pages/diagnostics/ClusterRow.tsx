import { copy } from '@/copy/copy';
import { clusterCode, clusterNode, clusterStage, clusterStatus } from '@/copy/diagnostics';
import { splitNodeName } from '@/lib/node-name';
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
export function ClusterRow({ cluster, showSeverity = true }: { cluster: FailureCluster; showSeverity?: boolean }) {
  const stage = clusterStage(cluster.stage);
  const platform = `${cluster.platform} ${cluster.appVersion}`;
  const node = clusterNode(cluster.node);
  const { prefix: city, main: site } = splitNodeName(node);
  return (
    <li className={cluster.status === 'quiet' ? 'cluster-row is-quiet' : 'cluster-row'}>
      {/* Rendered on every row while the list has any p0, so the sentences share
          one x; empty unless this row is p0. A list with no p0 drops the cell
          (and its column) so the sentences start at the heading's edge. The
          label is the one the incident card puts before its subject. */}
      {showSeverity ? (
        <span className="cluster-severity">{cluster.severity === 'p0' ? copy.severity.severe : null}</span>
      ) : null}
      <span className="cluster-sentence" title={cluster.code}>{clusterCode(cluster.code)}</span>
      {/* Three flex items; the dots between them are CSS (`::before` on items
          two and up), hidden on a phone where the items wrap, so no line starts
          or ends on a dot. Only the node can be long: it alone gives way. Inside
          it the city is cut first, then the site, each with an ellipsis; the
          full name is on the node's title. */}
      <span className="cluster-detail" title={`${stage} · ${platform} · ${node}`}>
        <span className="cluster-seg cluster-stage">{stage}</span>
        <span className="cluster-seg cluster-platform">{platform}</span>
        <span className="cluster-seg cluster-node" title={node}>
          <span className="cluster-node-city">{city ?? site}</span>
          {city ? <span className="cluster-node-site">{site}</span> : null}
        </span>
      </span>
      <span className="cluster-counts">{copy.diagnosticsPanel.clusterReach(cluster.users, cluster.devices)}</span>
      <span className="ops-tag cluster-status">{clusterStatus(cluster.status)}</span>
    </li>
  );
}
