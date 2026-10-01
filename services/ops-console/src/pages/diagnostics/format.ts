import type { FailureCluster } from './types';

/** One line an operator can scan. No email, no address, no raw log. */
export function clusterLine(cluster: FailureCluster): string {
  return `${cluster.code} · ${cluster.stage} · ${cluster.platform} ${cluster.appVersion} · ${cluster.node} · ${cluster.count}`;
}
