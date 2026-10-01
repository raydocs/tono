import type { NodeDetailDto, QuotaLevel } from '@contract';
import { StatTile } from '@/components/ops/StatTile';
import type { Tone } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import type { MonthSummaryDto } from '@/lib/api-ledger';
import type { SloResponseDto } from '@/lib/api-slo';
import { nowSec } from '@/lib/clock';
import { formatBytesMeasured, formatDate, formatLatency, formatPercent, formatRate, formatTally } from '@/lib/display';
import { formatCny, formatPerGb, nodeRow } from '@/lib/ledger';
import { formatDeadline } from '@/lib/node-detail';
import { usePrivacy } from '@/lib/privacy';
import { dailyRate, rateDomain } from '@/lib/slo';
import type { Resource } from '@/lib/use-resource';

const words = copy.nodeBoard;
const ALL = '__all__';
const QUOTA_TONE: Record<QuotaLevel, Tone | undefined> = { ok: undefined, chore: 'rem', warn: 'warn', severe: 'sev' };
const WEEK_SEC = 7 * 86_400;

/**
 * Six numbers for one machine, each from the read that owns it: the detail's
 * occupancy, quota and typed-in facts, the week of quality rows, and the
 * month's ledger. A read that has not answered leaves its own tile a dash.
 */
export function NodeBand({
  node,
  slo,
  month,
}: {
  node: NodeDetailDto;
  slo: Resource<SloResponseDto>;
  month: Resource<MonthSummaryDto>;
}) {
  const privacy = usePrivacy();
  const capacity = node.facts.capacityUsers;

  const items = slo.status === 'ready' ? slo.data.items : [];
  const attempts = items.reduce((sum, row) => sum + row.attempts, 0);
  const successes = items.reduce((sum, row) => sum + row.successes, 0);
  const trend = dailyRate(items, () => ALL).get(ALL) ?? [];
  const p50 = slo.status === 'ready' ? slo.data.summary.p50Ms : null;

  const quota = node.quota.value;
  const share = quota.used !== null && quota.quota !== null && quota.quota > 0 ? quota.used / quota.quota : null;

  const row = month.status === 'ready' ? nodeRow(month.data, node.name) : null;
  const cost = formatCny(row?.costCnyMinor);
  const perGb = formatPerGb(row?.cnyPerGbMinor);
  const costSub = month.status !== 'ready'
    ? null
    : row === null ? words.costNone : row.pending ? words.costPending : perGb === null ? null : words.costPerGb(privacy.money(perGb));

  const ends = node.facts.expiresAt ?? node.facts.renewsAt;
  const soon = ends !== null && ends - nowSec() < WEEK_SEC;

  return (
    <div className="node-stats">
      <StatTile
        label={words.stat.online}
        value={formatTally(node.occupancy.value.length)}
        sub={capacity === undefined ? words.onlineNoCapacity : words.onlineOf(formatTally(capacity))}
      />
      <StatTile
        label={words.stat.rate}
        value={attempts > 0 ? formatRate(successes / attempts) : null}
        sub={attempts > 0 ? words.rateSub(formatTally(attempts - successes)) : null}
        trend={attempts > 0 ? trend : undefined}
        trendDomain={rateDomain([trend])}
      />
      <StatTile
        label={words.stat.p50}
        value={p50 === null ? null : formatLatency(p50)}
        sub={p50 === null ? null : words.p50Sub}
      />
      <StatTile
        label={words.stat.traffic}
        value={quota.used === null ? null : formatBytesMeasured(quota.used)}
        tone={QUOTA_TONE[quota.level]}
        sub={quota.quota === null
          ? words.trafficNoQuota
          : words.trafficOf(formatBytesMeasured(quota.quota), formatPercent(share))}
      />
      <StatTile
        label={words.stat.cost}
        value={cost === null ? null : privacy.money(cost)}
        sub={costSub}
      />
      <StatTile
        label={words.stat.expires}
        value={formatDeadline(ends)}
        tone={soon ? 'warn' : undefined}
        sub={ends === null ? words.expiresNone : words.expiresOn(formatDate(ends))}
      />
    </div>
  );
}
