import type { FailureCluster } from '@/pages/diagnostics/types';

/**
 * The order the operator reads failure clusters in: a p0 before anything else,
 * then the ones still going before the ones that went quiet, then the wider
 * reach (people, then devices), and the machine code last so two clusters that
 * tie on everything always land in the same place. Returns a new array.
 */
export function sortClusters(clusters: readonly FailureCluster[]): FailureCluster[] {
  return [...clusters].sort((a, b) =>
    Number(b.severity === 'p0') - Number(a.severity === 'p0')
    || Number(a.status === 'quiet') - Number(b.status === 'quiet')
    || b.users - a.users
    || b.devices - a.devices
    || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
