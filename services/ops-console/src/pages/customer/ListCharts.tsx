import type { CustomerSummaryDto } from '@contract';
import { Bars } from '@/components/ops/Bars';
import { Meter } from '@/components/ops/Meter';
import { Panel, type PanelState } from '@/components/ops/Panel';
import type { Tone } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { expiryWeeks, meteredBytes, NEAR_QUOTA, topUsage } from '@/lib/customer-board';
import { formatBytesMeasured, formatTally } from '@/lib/display';
import { openCustomer } from '@/lib/hash-route';

const words = copy.customerBoard;
const HEIGHT = 200;
const WEEKS = 8;
const TOP = 6;

/**
 * When the paying customers lapse, week by week, and who is using the most.
 * Both fold the list the page already holds, so neither costs a request.
 */
export function ListCharts({
  rows,
  state,
  asOfSec,
  mask,
  onRetry,
}: {
  rows: readonly CustomerSummaryDto[];
  state: PanelState;
  asOfSec: number | null;
  mask: (email: string) => string;
  onRetry: () => void;
}) {
  const weeks = expiryWeeks(rows, nowSec(), WEEKS);
  const heavy = topUsage(rows, TOP);
  const panel = { source: words.source, asOfSec, onRetry, bodyHeight: HEIGHT };

  return (
    <div className="customers-charts">
      <Panel
        title={words.expiry}
        description={words.expiryLead}
        state={state === 'ready' && weeks.every((n) => n === 0) ? 'empty' : state}
        emptyText={words.expiryEmpty}
        {...panel}
      >
        <Bars
          columns={weeks.map((count, index) => ({
            key: String(index),
            label: index === 0 ? words.lapsed : words.weekOf(index - 1),
            values: index === 0 ? [count, null] : [null, count],
          }))}
          stacks={[{ key: 'lapsed', name: words.lapsed, tone: 'sev' }, { key: 'due', name: words.expiryStack }]}
          format={formatTally}
          label={words.expiryLabel}
          height={HEIGHT}
        />
      </Panel>
      <Panel
        title={words.top}
        description={words.topLead}
        state={state === 'ready' && heavy.length === 0 ? 'empty' : state}
        emptyText={words.topEmpty}
        {...panel}
      >
        <ul className="customers-top">
          {heavy.map((row) => <TopRow key={row.userId} row={row} mask={mask} />)}
        </ul>
      </Panel>
    </div>
  );
}

function TopRow({ row, mask }: { row: CustomerSummaryDto; mask: (email: string) => string }) {
  const used = meteredBytes(row) ?? 0;
  const quota = row.quotaBytes !== null && row.quotaBytes > 0 ? row.quotaBytes : null;
  const ratio = quota === null ? null : used / quota;
  const tone: Tone = ratio === null ? 'unk' : ratio >= 0.95 ? 'sev' : ratio >= NEAR_QUOTA ? 'warn' : 'ok';
  const text = formatBytesMeasured(used);
  return (
    <li>
      <button type="button" className="customers-top-name text-body" onClick={() => openCustomer(row.userId)}>
        {mask(row.email)}
      </button>
      <span className="customers-top-use">
        <Meter ratio={ratio} tone={tone} />
        <span className="font-mono text-fine">{quota === null ? text : words.quotaOf(text, formatBytesMeasured(quota))}</span>
      </span>
    </li>
  );
}
