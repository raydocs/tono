import { useId, useMemo } from 'react';
import { Bars } from '@/components/ops/Bars';
import { LineChart, type LineSeries } from '@/components/ops/LineChart';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { Segmented } from '@/components/ops/Segmented';
import { copy } from '@/copy/copy';
import type { SloResponseDto } from '@/lib/api-slo';
import { formatUtcDate, formatUtcDay, formatRate, formatTally } from '@/lib/display';
import { dailyAttempts, dailyRate, keysByAttempts, rateDomain } from '@/lib/slo';
import type { Resource } from '@/lib/use-resource';

export type QualityRange = '7d' | '30d';
const RANGES: QualityRange[] = ['7d', '30d'];
/** The rollup is written once a day; a day and a half without one is late. */
const STALE_AFTER_SEC = 36 * 3_600;
const HEIGHT = 200;
const ALL = '__all__';

const words = copy.nodeBoard.quality;

function carrierName(key: string): string {
  return copy.ledger.sloCarrier[key as keyof typeof copy.ledger.sloCarrier] ?? key;
}

/**
 * Did customers get through to this machine, day by day and per carrier —
 * the overview's quality band narrowed to one node, folded by the same
 * `lib/slo` so the two pages cannot disagree about a day.
 */
export function NodeQualityBand({
  slo,
  range,
  onRange,
}: {
  slo: Resource<SloResponseDto> & { reload: () => void };
  range: QualityRange;
  onRange: (range: QualityRange) => void;
}) {
  const headingId = useId();
  const data = slo.status === 'ready' ? slo.data : null;
  const items = useMemo(() => data?.items ?? [], [data]);
  const state: PanelState = slo.status === 'loading'
    ? 'loading'
    : slo.status === 'error' ? 'error' : items.length === 0 ? 'empty' : 'ready';
  const rangeWord = copy.quality.range[range];

  const carriers = useMemo(() => keysByAttempts(items, (row) => row.carrier), [items]);
  const series = useMemo<LineSeries[]>(() => {
    const byCarrier = dailyRate(items, (row) => row.carrier);
    return [
      { key: ALL, name: copy.quality.all, points: dailyRate(items, () => ALL).get(ALL) ?? [] },
      ...carriers.map((key) => ({ key, name: carrierName(key), points: byCarrier.get(key) ?? [] })),
    ];
  }, [items, carriers]);
  const domain = useMemo(() => rateDomain(series.map((line) => line.points)), [series]);
  const attempts = useMemo(() => dailyAttempts(items, carriers, (row) => row.carrier), [items, carriers]);
  const panel = {
    state,
    source: copy.quality.source,
    asOfSec: data?.updatedAt,
    staleAfterSec: STALE_AFTER_SEC,
    emptyText: words.empty,
    onRetry: slo.reload,
    bodyHeight: HEIGHT,
  };

  return (
    <section className="quality-band" aria-labelledby={headingId}>
      <header className="quality-head">
        <div className="min-w-0">
          <h2 id={headingId} className="text-section">{copy.quality.title}</h2>
          <p className="text-fine">{words.lead}</p>
        </div>
        <Segmented
          label={copy.quality.rangeLabel}
          value={range}
          options={RANGES.map((key) => ({ value: key, label: copy.quality.range[key] }))}
          onChange={onRange}
        />
      </header>

      {state === 'ready' ? (
        <div className="quality-grid">
          <Panel title={words.rateChart} description={words.rateChartLead} {...panel}>
            <LineChart
              series={series}
              domain={domain}
              format={formatRate}
              when={formatUtcDate}
              tick={formatUtcDay}
              tickOffsetSec={0}
              label={words.rateChartLabel(rangeWord)}
              height={HEIGHT}
            />
          </Panel>
          <Panel title={words.attemptsChart} description={words.attemptsChartLead} {...panel}>
            <Bars
              columns={attempts.map((day) => ({ key: String(day.dayAt), label: formatUtcDay(day.dayAt), values: day.values }))}
              stacks={carriers.map((key) => ({ key, name: carrierName(key) }))}
              format={formatTally}
              label={words.attemptsChartLabel(rangeWord)}
              height={HEIGHT}
            />
          </Panel>
        </div>
      ) : (
        <Panel title={copy.quality.blockTitle} {...panel} />
      )}
    </section>
  );
}
