import { copy } from '@/copy/copy';
import { absent, measured, type Measured, type MetricSeries } from '@/components/ops/measured';
import { carriersFor, mainlandReturnText } from '@/lib/carriers';
import { mapFleetHealth, type HealthWord } from '@/lib/health';
import { nodeRegion } from '@/lib/selectors';
import type { FleetNodeDto, LiveAgentDto } from '@/lib/types';

export type NodeView = {
  node: FleetNodeDto;
  region: string;
  health: HealthWord;
  occupancy: Measured<number>;
  used: Measured<number | null>;
  trafficSeries: MetricSeries | null;
  quota: number | null;
  cycleStart: number | null;
  path: Measured<string | null>;
  mainland: Measured<string | null>;
  renew: Measured<number | null>;
  last: Measured<number | null>;
  ip: Measured<string | null>;
  os: Measured<string | null>;
  provider: Measured<string | null>;
  tags: Measured<string | null>;
  ports: Measured<string | null>;
};

export function toNodeView(node: FleetNodeDto, liveAgents: LiveAgentDto[] | null | undefined): NodeView {
  const asOf = node.agentObservedAt;
  const usedBytes = node.profile?.trafficUsedBytes ?? null;
  const quota = node.profile?.trafficQuotaBytes ?? null;
  const carriers = carriersFor(node, liveAgents);
  const mainland = mainlandReturnText(carriers);
  const ports = collectPorts(node);
  return {
    node,
    region: nodeRegion(node.name),
    health: mapFleetHealth(node),
    occupancy: measured(node.occupancy, asOf, copy.sources.agent),
    used: usedBytes == null
      ? absent(copy.sources.profile)
      : measured(usedBytes, node.profile?.updatedAt ?? asOf, copy.sources.profile),
    trafficSeries: trafficSeries(node),
    quota,
    cycleStart: node.profile?.trafficCycleStart ?? null,
    path: absent(copy.sources.none),
    mainland: mainland.text === copy.missing
      ? absent(copy.sources.live)
      : measured(mainland.text, asOf, copy.sources.live),
    renew: node.profile?.renewsAt == null
      ? absent(copy.sources.profile)
      : measured(node.profile.renewsAt, node.profile.updatedAt, copy.sources.profile),
    last: asOf == null ? absent(copy.sources.agent) : measured(asOf, asOf, copy.sources.agent),
    ip: fact(node.quality?.publicIp || node.profile?.publicIp, copy.sources.quality),
    os: fact(node.agent?.os, copy.sources.agent),
    provider: fact(node.profile?.provider, copy.sources.profile),
    tags: fact(node.quality?.routeKeywords?.join(SEPARATOR), copy.sources.quality),
    ports: fact(ports.length ? ports.join(SEPARATOR) : null, copy.sources.quality),
  };
}

const SEPARATOR = ' \u00b7 ';

/**
 * R2 for the flat facts in the drawer: an empty string is as absent as a
 * missing key, and both have to say which source came up empty.
 */
function fact(value: string | null | undefined, source: string): Measured<string | null> {
  return value ? measured(value, null, source) : absent(source);
}

/** Seven days of daily bytes, or nothing — an absent trend draws nothing at all. */
function trafficSeries(node: FleetNodeDto): MetricSeries | null {
  const daily = node.profile?.trafficDailyBytes;
  if (!daily || daily.length < 2) return null;
  return {
    points: daily.slice(-7),
    source: copy.sources.profile,
    lastDaySec: node.profile?.updatedAt ?? node.agentObservedAt ?? null,
  };
}

function collectPorts(node: FleetNodeDto): number[] {
  const exposure = node.quality?.exposure;
  if (!exposure) return [];
  const all = [
    ...exposure.sshPorts,
    ...exposure.expected.map((row) => row.port),
    ...exposure.unexpected.map((row) => row.port),
    ...exposure.acknowledged.map((row) => row.port),
  ];
  return [...new Set(all)].sort((a, b) => a - b);
}
