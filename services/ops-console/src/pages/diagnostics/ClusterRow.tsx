import { copy } from '@/copy/copy';
import { clusterCode, clusterNode, clusterStage, clusterStatus } from '@/copy/diagnostics';
import { severityTone } from '@/lib/codes';
import { cn } from '@/lib/utils';
import type { FailureCluster } from './types';

/**
 * One cluster, said in Chinese. The machine code stays one hover away on the
 * sentence; a value nobody has a word for prints as it came, so nothing hides.
 */
export function ClusterRow({ cluster }: { cluster: FailureCluster }) {
  return (
    <li className="text-sm">
      {cluster.severity === 'p0' ? (
        <>
          <span className={cn('ops-tag tone-fg', `tone-${severityTone('severe')}`)}>{copy.severity.severe}</span>{' '}
        </>
      ) : null}
      <span title={cluster.code}>{clusterCode(cluster.code)}</span>
      <span className="text-[var(--muted-foreground)]">
        {' · '}{clusterStage(cluster.stage)}
        {' · '}{cluster.platform} {cluster.appVersion}
        {' · '}{clusterNode(cluster.node)}
        {' · '}{copy.diagnosticsPanel.clusterReach(cluster.users, cluster.devices)}
        {' · '}{clusterStatus(cluster.status)}
      </span>
    </li>
  );
}
