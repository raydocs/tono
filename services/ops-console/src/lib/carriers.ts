import { worstCarrier } from '@legacy-lib/carrier';
import { copy } from '@/copy/copy';
import { formatLatency, formatLoss } from './display';
import type { CarrierPingMapDto, FleetNodeDto, LiveAgentDto } from './types';

export function carriersFor(node: FleetNodeDto, liveAgents: LiveAgentDto[] | null | undefined): CarrierPingMapDto {
  if (node.agent?.carriers) return node.agent.carriers;
  const live = liveAgents?.find((row) => row.name === node.name);
  return live?.carriers ?? null;
}

export function mainlandReturnText(carriers: CarrierPingMapDto): { text: string; source: string } {
  if (!carriers) return { text: copy.missing, source: copy.sources.live };
  const worst = worstCarrier(carriers);
  if (!worst) return { text: copy.missing, source: copy.sources.live };
  return {
    text: `${worst.label} ${formatLoss(worst.lossPct)} · ${formatLatency(worst.latencyMs)}`,
    source: copy.sources.live,
  };
}
