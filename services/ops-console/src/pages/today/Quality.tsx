import { useId, useMemo, useState } from 'react';
import { Bars } from '@/components/ops/Bars';
import { LineChart, type LineSeries } from '@/components/ops/LineChart';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { StatTile } from '@/components/ops/StatTile';
import { Spark } from '@/components/ops/Spark';
import { copy } from '@/copy/copy';
import { sloApi, type SloResponseDto } from '@/lib/api-slo';
import {
  formatDate,
  formatDay,
  formatLatency,
  formatMinutes,
  formatRate,
  formatTally,
} from '@/lib/display';
import { openNodePage } from '@/lib/hash-route';
import { dailyAttempts, dailyOutage, dailyRate, keysByAttempts, nodeQuality, rateDomain } from '@/lib/slo';
import { useResource, type Resource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';

type Range = '7d' | '30d';
const RANGES: Range[] = ['7d', '30d'];
/** The rollup is written once a day; a day and a half without one is late. */
const STALE_AFTER_SEC = 36 * 3_600;
const WORST_NODES = 5;
const ALL = '__all__';

const words = copy.quality;

function platformName(key: string): string {
  return copy.ledger.sloPlatform[key as keyof typeof copy.ledger.sloPlatform] ?? key;
}

function carrierName(key: string): string {
  return copy.ledger.sloCarrier[key as keyof typeof copy.ledger.sloCarrier] ?? key;
}

function stateOf(slo: Resource<SloResponseDto>): PanelState {
  if (slo.status === 'loading') return 'loading';
  if (slo.status === 'error') return 'error';
  return slo.data.items.length === 0 ? 'empty' : 'ready';
}

/**
 * Connection quality on the overview: did customers get through, where did they not,
 * and how much of the period nobody measured. One read of `/slo`, folded by
 * `lib/slo` so the tiles, the charts and the node list count the same way.
 */
export function QualityBand() {
  const headingId = useId();
  const [range, setRange] = useState<Range>('30d');
  const slo = useResource(`today-slo-${range}`, (signal) => sloApi.get({ range }, signal));
  const data = slo.status === 'ready' ? slo.data : null;
  const items = useMemo(() => data?.items ?? [], [data]);
  const state = stateOf(slo);
  const rangeWord = words.range[range];

  const fleet = useMemo(() => dailyRate(items, () => ALL).get(ALL) ?? [], [items]);
  const series = useMemo<LineSeries[]>(() => {
    const byPlatform = dailyRate(items, (row) => row.platform);
    return [
      { key: ALL, name: words.all, points: fleet },
      ...keysByAttempts(items, (row) => row.platform).map((key) => ({
        key,
        name: platformName(key),
        points: byPlatform.get(key) ?? [],
      })),
    ];
  }, [items, fleet]);
  const domain = useMemo(() => rateDomain(series.map((line) => line.points)), [series]);
  const carriers = useMemo(() => keysByAttempts(items, (row) => row.carrier), [items]);
  const attempts = useMemo(() => dailyAttempts(items, carriers, (row) => row.carrier), [items, carriers]);
  const outage = useMemo(() => dailyOutage(items), [items]);
  const nodes = useMemo(() => nodeQuality(items), [items]);

  const totalAttempts = items.reduce((sum, row) => sum + row.attempts, 0);
  const totalSuccesses = items.reduce((sum, row) => sum + row.successes, 0);
  const summary = data?.summary ?? null;
  const outageNodes = nodes.filter((row) => row.outageMin > 0).length;
  const hasRows = items.length > 0;
  const panel = {
    state,
    source: words.source,
    asOfSec: data?.updatedAt,
    staleAfterSec: STALE_AFTER_SEC,
    emptyText: words.empty,
    onRetry: slo.reload,
  };

  return (
    <section className="quality-band" aria-labelledby={headingId}>
      <header className="quality-head">
        <div className="min-w-0">
          <h2 id={headingId} className="text-section">{words.title}</h2>
          <p className="text-fine">{words.lead}</p>
        </div>
        <div className="quality-range" role="group" aria-label={words.rangeLabel}>
          {RANGES.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={range === key}
              className="quality-range-btn"
              onClick={() => setRange(key)}
            >
              {words.range[key]}
            </button>
          ))}
        </div>
      </header>

      <div className="quality-stats">
        <StatTile
          label={words.stat.rate}
          value={hasRows ? formatRate(summary?.successRate) : null}
          sub={hasRows ? words.failed(formatTally(totalAttempts - totalSuccesses)) : null}
          trend={hasRows ? fleet : undefined}
          trendDomain={domain}
        />
        <StatTile
          label={words.stat.attempts}
          value={hasRows ? formatTally(totalAttempts) : null}
          sub={hasRows ? rangeWord : null}
        />
        <StatTile
          label={words.stat.p50}
          value={hasRows ? formatLatency(summary?.p50Ms) : null}
          sub={hasRows ? words.p50Sub : null}
        />
        <StatTile
          label={words.stat.outage}
          value={hasRows ? formatMinutes(summary?.verifiedOutageMin) : null}
          tone={!hasRows ? 'unk' : outageNodes > 0 ? 'sev' : 'ok'}
          sub={hasRows ? words.outageSub(outageNodes) : null}
        />
        <StatTile
          label={words.stat.coverage}
          value={hasRows ? formatRate(summary?.coverage) : null}
          sub={hasRows ? words.unmeasured(formatMinutes(summary?.unmeasuredMin)) : null}
        />
      </div>

      {state === 'error' || state === 'empty' ? (
        // One read feeds every panel, so one failure is one message, not four.
        <Panel title={words.blockTitle} bodyHeight={140} {...panel} />
      ) : (
        <div className="quality-grid">
          <Panel title={words.rateChart} description={words.rateChartLead} className="quality-wide" bodyHeight={220} {...panel}>
            <LineChart
              series={series}
              domain={domain}
              format={formatRate}
              when={formatDate}
              tick={formatDay}
              label={words.rateChartLabel(rangeWord)}
              height={220}
            />
          </Panel>
          <Panel title={words.attemptsChart} description={words.attemptsChartLead} bodyHeight={220} {...panel}>
            <Bars
              columns={attempts.map((day) => ({ key: String(day.dayAt), label: formatDay(day.dayAt), values: day.values }))}
              stacks={carriers.map((key) => ({ key, name: carrierName(key) }))}
              format={formatTally}
              label={words.attemptsChartLabel(rangeWord)}
              height={220}
            />
          </Panel>
          <Panel title={words.nodes} description={words.nodesLead} className="quality-wide" bodyHeight={200} {...panel}>
            <WorstNodes rows={nodes} domain={domain} />
          </Panel>
          <Panel title={words.outageChart} description={words.outageChartLead} bodyHeight={200} {...panel}>
            <Bars
              columns={outage.map((day) => ({ key: String(day.dayAt), label: formatDay(day.dayAt), values: [day.minutes] }))}
              stacks={[{ key: 'outage', name: words.outageStack, tone: 'sev' }]}
              format={formatMinutes}
              scale="minutes"
              label={words.outageChartLabel(rangeWord)}
              height={200}
            />
          </Panel>
        </div>
      )}
    </section>
  );
}

function WorstNodes({ rows, domain }: { rows: ReturnType<typeof nodeQuality>; domain: [number, number] }) {
  const shown = rows.slice(0, WORST_NODES);
  const rest = rows.length - shown.length;
  const cols = words.nodeColumns;
  return (
    <div className="flex flex-col gap-2">
      <table className="quality-table">
        <thead>
          <tr>
            <th scope="col">{cols.node}</th>
            <th scope="col" className="num">{cols.rate}</th>
            <th scope="col" className="quality-trend-col">{cols.trend}</th>
            <th scope="col" className="num">{cols.attempts}</th>
            <th scope="col" className="num quality-p50-col">{cols.p50}</th>
            <th scope="col" className="num">{cols.outage}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.node} className="quality-row" onClick={() => openNodePage(row.node)}>
              <td className="quality-node">
                <a href={`#/nodes/${encodeURIComponent(row.node)}`} onClick={(event) => event.stopPropagation()}>
                  {row.node}
                </a>
              </td>
              <td className={cn('num', row.outageMin > 0 && 'tone-sev tone-fg')}>{formatRate(row.rate)}</td>
              <td className="quality-trend-col">
                <Spark points={row.days} domain={domain} height={22} tone={row.outageMin > 0 ? 'sev' : undefined} />
              </td>
              <td className="num">{formatTally(row.attempts)}</td>
              <td className="num quality-p50-col">{formatLatency(row.p50Ms)}</td>
              <td className={cn('num', row.outageMin > 0 && 'tone-sev tone-fg')}>
                {formatMinutes(row.outageMin)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rest > 0 ? (
        <a className="text-fine underline decoration-[var(--hairline)] underline-offset-4" href="#/nodes">
          {words.moreNodes(rest)}
        </a>
      ) : null}
    </div>
  );
}
