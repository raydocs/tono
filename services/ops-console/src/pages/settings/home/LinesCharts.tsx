import type { HomeLineDto } from '@contract';
import { Bars } from '@/components/ops/Bars';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { copy } from '@/copy/copy';
import { nowSec } from '@/lib/clock';
import { formatBytesMeasured, formatDate } from '@/lib/display';
import { formatDeadline } from '@/lib/node-detail';
import { renewsSoon } from '@/lib/residential';
import { cn } from '@/lib/utils';

const words = copy.residential.lines;
const HEIGHT = 200;
const WEEK_SEC = 7 * 86_400;
const RENEWALS = 6;

/**
 * This period's bytes per line, and the lines whose paid time runs out next.
 * Both come off the one list read, so neither costs a request of its own.
 */
export function LinesCharts({
  rows,
  state,
  asOfSec,
  onRetry,
}: {
  rows: readonly HomeLineDto[];
  state: PanelState;
  asOfSec: number | null;
  onRetry: () => void;
}) {
  const now = nowSec();
  const metered = rows
    .filter((row) => row.status === 'active' && row.usage.value !== null)
    .sort((a, b) => total(b) - total(a));
  const soon = rows.filter((row) => renewsSoon(row, now))
    .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0))
    .slice(0, RENEWALS);
  const panel = { source: words.source, asOfSec, onRetry, bodyHeight: HEIGHT };

  return (
    <div className="home-charts">
      <Panel
        title={words.usageChart}
        description={words.usageChartLead}
        state={state === 'ready' && metered.length === 0 ? 'empty' : state}
        emptyText={words.usageEmpty}
        {...panel}
      >
        <Bars
          columns={metered.map((row) => ({
            key: row.id,
            label: row.displayName,
            values: [row.usage.value?.bytesUp ?? null, row.usage.value?.bytesDown ?? null],
          }))}
          stacks={[{ key: 'up', name: words.up }, { key: 'down', name: words.down }]}
          format={formatBytesMeasured}
          scale="bytes"
          label={words.usageChartLabel}
          height={HEIGHT}
        />
      </Panel>
      <Panel
        title={words.renewals}
        description={words.renewalsLead}
        state={state === 'ready' && soon.length === 0 ? 'empty' : state}
        emptyText={words.renewalsEmpty}
        {...panel}
      >
        <ul className="home-renewals">
          {soon.map((row) => {
            const at = row.expiresAt ?? now;
            const urgent = at - now < WEEK_SEC;
            return (
              <li key={row.id}>
                <span className="home-renewal-name text-body">{row.displayName}</span>
                <span className={cn('font-mono text-fine', urgent && 'tone-warn tone-fg')}>
                  {words.renewalWhen(formatDeadline(at) ?? copy.missing, formatDate(at))}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}

function total(row: HomeLineDto): number {
  const usage = row.usage.value;
  return usage === null ? 0 : usage.bytesUp + usage.bytesDown;
}
