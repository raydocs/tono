import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
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
    <Section title="失败聚类">
      {resource.status === 'ready' && resource.data.clusters.length === 0 ? (
        <Empty message="这段时间没有打开的失败聚类。" />
      ) : null}
      {resource.status === 'ready' && resource.data.clusters.length > 0 ? (
        <ul className="grid gap-2">
          {resource.data.clusters.map((cluster) => (
            <li key={cluster.id} className="text-sm">
              <span className="font-mono">{clusterLine(cluster)}</span>
              <span className="text-[var(--muted-foreground)]">
                {' '}
                {cluster.users} 人 / {cluster.devices} 台 · {cluster.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {resource.status === 'loading' ? <Empty message="正在读取失败聚类…" /> : null}
      {resource.status === 'error' ? (
        <Empty message="失败聚类还读不到。控制面的聚类接口部署之后，这里会列出同一类失败。" />
      ) : null}
    </Section>
  );
}
