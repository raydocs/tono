import type {
  ForwardPathDto,
  NodeHealthWord,
  NodeLifecycle,
  NodeSummaryDto,
  ReturnPathDto,
  Tone,
} from '@contract';
import { copy } from '@/copy/copy';
import { absent, measured, type Measured } from '@/components/ops/measured';
import { formatLatency, formatLoss, formatPercent } from '@/lib/display';
import { nodeRegion } from '@/lib/selectors';
import { shown, sourceWord } from '@/lib/sources';
import type { FleetNodeDto } from '@/lib/types';

/**
 * One machine, as a card and a row read it.
 *
 * Every judgement here arrives from the engine — the word, the tone, the
 * reason, the lifecycle — and nothing is derived from the raw probe statuses
 * any more. The only thing this file decides is how a measured number is
 * spelled; if it starts deciding what a number means, the 节点 page and 今天
 * can disagree again.
 */
export type NodeView = {
  node: NodeSummaryDto;
  region: string;
  word: NodeHealthWord;
  /**
   * The engine's tone, except on a machine that has been retired: an alarm on
   * a box nobody sells is a red pill with no action behind it, so it goes grey
   * and keeps its word.
   */
  tone: Tone;
  lifecycle: NodeLifecycle;
  retired: boolean;
  reason: string | null;
  occupancy: Measured<number | null>;
  used: Measured<number | null>;
  quota: number | null;
  cycleStart: number | null;
  exhaustAt: number | null;
  forward: Measured<string | null>;
  mainland: Measured<string | null>;
  renew: Measured<number | null>;
  last: Measured<number | null>;
  /** From the legacy fleet read: facts no verdict carries. Absent is normal. */
  ip: Measured<string | null>;
  os: Measured<string | null>;
  provider: Measured<string | null>;
  tags: Measured<string | null>;
  ports: Measured<string | null>;
};

export function toNodeView(node: NodeSummaryDto, facts: FleetNodeDto | undefined): NodeView {
  const retired = node.lifecycle === 'retired';
  const quota = shown(node.quota);
  const cell = quota.value;
  const ports = collectPorts(facts);
  // 续费 and 到期 are the same cell: a machine on auto-renew has the first, one
  // paid to a date has the second, and neither is a thing to hunt for twice.
  const renewAt = node.renewsAt ?? node.expiresAt;
  return {
    node,
    region: node.region ?? nodeRegion(node.name),
    word: node.health,
    tone: retired ? 'unk' : node.tone,
    lifecycle: node.lifecycle,
    retired,
    reason: node.reason,
    occupancy: shown(node.occupancy),
    used: { value: cell?.used ?? null, asOfSec: quota.asOfSec, source: quota.source },
    quota: cell?.quota ?? null,
    cycleStart: cell?.cycleStart ?? null,
    exhaustAt: cell?.projectedExhaustAt ?? null,
    forward: worstPath(shown(node.forwardWorst), forwardText),
    mainland: worstPath(shown(node.returnWorst), returnText),
    renew: renewAt === null
      ? absent(sourceWord('profile'))
      : measured(renewAt, null, sourceWord('profile')),
    last: measured(node.updatedAt, node.updatedAt, sourceWord('engine')),
    ip: fact(facts?.quality?.publicIp || facts?.profile?.publicIp, copy.sources.quality),
    os: fact(facts?.agent?.os, copy.sources.agent),
    provider: fact(node.provider ?? facts?.profile?.provider, sourceWord('profile')),
    tags: fact(facts?.quality?.routeKeywords?.join(SEPARATOR), copy.sources.quality),
    ports: fact(ports.length ? ports.join(SEPARATOR) : null, copy.sources.quality),
  };
}

const SEPARATOR = ' · ';

/**
 * The worst carrier on one leg, spelled out — or the em dash and the word for
 * who should have measured it. A leg with a stamp but no carrier behind it is
 * still absent: nothing was measured, whatever the clock says.
 */
function worstPath<T>(
  row: Measured<T | null>,
  say: (value: T) => string,
): Measured<string | null> {
  if (row.value === null) return absent(row.source);
  return measured(say(row.value), row.asOfSec, row.source);
}

function forwardText(path: ForwardPathDto): string {
  return copy.worstCarrier(
    copy.nodeCarrier[path.carrier],
    formatPercent(path.successRate),
    formatLatency(path.medianTcpMs),
  );
}

function returnText(path: ReturnPathDto): string {
  return copy.worstCarrier(
    copy.nodeCarrier[path.carrier],
    formatLoss(path.lossPct),
    formatLatency(path.latencyMs),
  );
}

/**
 * R2 for the flat facts in the drawer: an empty string is as absent as a
 * missing key, and both have to say which source came up empty.
 */
function fact(value: string | null | undefined, source: string): Measured<string | null> {
  return value ? measured(value, null, source) : absent(source);
}

function collectPorts(node: FleetNodeDto | undefined): number[] {
  const exposure = node?.quality?.exposure;
  if (!exposure) return [];
  const all = [
    ...exposure.sshPorts,
    ...exposure.expected.map((row) => row.port),
    ...exposure.unexpected.map((row) => row.port),
    ...exposure.acknowledged.map((row) => row.port),
  ];
  return [...new Set(all)].sort((a, b) => a - b);
}
