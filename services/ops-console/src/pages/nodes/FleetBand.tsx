import type { NodeSummaryDto } from '@contract';
import type { MonthSummaryDto } from '@/lib/api-ledger';
import { StatTile } from '@/components/ops/StatTile';
import type { Tone } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import type { SloResponseDto } from '@/lib/api-slo';
import { formatBytesMeasured, formatRate, formatTally } from '@/lib/display';
import { formatCny } from '@/lib/ledger';
import { usePrivacy } from '@/lib/privacy';
import { countLine, lifecycleCounts } from '@/lib/selectors';
import { dailyRate, rateDomain } from '@/lib/slo';
import { shown } from '@/lib/sources';
import type { Resource } from '@/lib/use-resource';

const words = copy.nodesBoard;
const ALL = '__all__';

/**
 * Six numbers over the machines in service, each from the read that owns
 * it: the engine's verdicts, the collector's occupancy and quota, the daily
 * quality rollup and the month's ledger. A read that has not answered is a
 * dash on its own tile, never a zero on all six.
 */
export function FleetBand({
  nodes,
  inService,
  slo,
  month,
}: {
  nodes: Resource<NodeSummaryDto[]>;
  inService: readonly NodeSummaryDto[];
  slo: Resource<SloResponseDto>;
  month: Resource<MonthSummaryDto>;
}) {
  const privacy = usePrivacy();
  const ready = nodes.status === 'ready';
  const all = ready ? nodes.data : [];
  const life = lifecycleCounts(all);
  const counts = countLine(inService);
  const problems = counts.lost + counts.blocked + counts.degraded;
  const problemTone: Tone = counts.lost + counts.blocked > 0 ? 'sev' : counts.degraded > 0 ? 'warn' : 'ok';

  const occupancy = inService.map((node) => shown(node.occupancy).value);
  const online = occupancy.filter((value): value is number => value !== null);
  const quotas = inService.map((node) => shown(node.quota).value);
  const used = quotas.map((row) => row?.used ?? null).filter((value): value is number => value !== null);
  const caps = quotas.map((row) => row?.quota ?? null).filter((value): value is number => value !== null);

  const items = slo.status === 'ready' ? slo.data.items : [];
  const trend = dailyRate(items, () => ALL).get(ALL) ?? [];
  const attempts = items.reduce((sum, row) => sum + row.attempts, 0);
  const successes = items.reduce((sum, row) => sum + row.successes, 0);

  const summary = month.status === 'ready' ? month.data : null;
  const cost = summary === null ? null : summary.nodes.reduce((sum, row) => sum + row.costCnyMinor, 0);
  const pending = summary === null ? 0 : summary.nodes.filter((row) => row.pending).length;
  const costText = formatCny(cost);

  return (
    <div className="nodes-stats">
      <StatTile
        label={words.stat.fleet}
        value={ready ? formatTally(inService.length) : null}
        sub={ready ? words.fleetSub(life.listed, life.unlisted) : null}
      />
      <StatTile
        label={words.stat.problems}
        value={ready ? formatTally(problems) : null}
        tone={ready ? problemTone : undefined}
        sub={ready ? words.problemsSub(counts.lost, counts.blocked, counts.degraded) : null}
      />
      <StatTile
        label={words.stat.online}
        value={ready && online.length > 0 ? formatTally(online.reduce((sum, v) => sum + v, 0)) : null}
        sub={ready ? words.onlineSub(occupancy.length - online.length) : null}
      />
      <StatTile
        label={words.stat.traffic}
        value={ready && used.length > 0 ? formatBytesMeasured(used.reduce((sum, v) => sum + v, 0)) : null}
        sub={ready
          ? caps.length > 0 ? words.trafficSub(formatBytesMeasured(caps.reduce((sum, v) => sum + v, 0))) : words.trafficNoQuota
          : null}
      />
      <StatTile
        label={words.stat.rate}
        value={attempts > 0 ? formatRate(successes / attempts) : null}
        sub={attempts > 0 ? words.rateSub(formatTally(attempts - successes)) : null}
        trend={attempts > 0 ? trend : undefined}
        trendDomain={rateDomain([trend])}
      />
      <StatTile
        label={words.stat.cost}
        value={costText === null ? null : privacy.money(costText)}
        sub={summary === null ? null : words.costSub(pending)}
      />
    </div>
  );
}
