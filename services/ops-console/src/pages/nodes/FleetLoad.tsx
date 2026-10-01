import { useId, useMemo } from 'react';
import { LineChart, type LineSeries } from '@/components/ops/LineChart';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { Segmented } from '@/components/ops/Segmented';
import { copy } from '@/copy/copy';
import { formatBytesMeasured, formatClock, formatDate, formatDay, formatLoadAverage, formatPercent } from '@/lib/display';
import { foldFleetLoad, hasFleetLoad, type FleetLoad as Folded } from '@/lib/fleet-load';
import { NODE_LOAD_RANGES, type FleetLoadWindow, type LoadPoint, type NodeLoadRange } from '@/lib/node-legacy';
import type { Resource } from '@/lib/use-resource';

const words = copy.nodesBoard.load;
/** The collector reports every few minutes; a quarter of an hour without a sample is late. */
const STALE_AFTER_SEC = 15 * 60;
const HEIGHT = 150;

const share = (value: number) => formatPercent(value / 100);
const rate = (value: number) => words.rate(formatBytesMeasured(value));
/**
 * The fleet's own load, four panels over one read of the collector, so the
 * four charts always cover the same window and the same machines.
 */
export function FleetLoad({
  load,
  range,
  onRange,
}: {
  load: Resource<FleetLoadWindow> & { reload: () => void };
  range: NodeLoadRange;
  onRange: (range: NodeLoadRange) => void;
}) {
  const headingId = useId();
  const folded = useMemo(() => (load.status === 'ready' ? foldFleetLoad(load.data) : null), [load]);
  const state: PanelState = load.status === 'loading'
    ? 'loading'
    : load.status === 'error' ? 'error' : folded && hasFleetLoad(folded) ? 'ready' : 'empty';
  const rangeWord = words.range[range];
  const tick = range === '24h' ? formatClock : formatDay;
  const when = (at: number) => copy.nodeWhenBoth(formatDate(at), formatClock(at));
  const panel = {
    state,
    source: words.source,
    asOfSec: folded?.asOfSec ?? null,
    staleAfterSec: STALE_AFTER_SEC,
    emptyText: words.empty,
    onRetry: load.reload,
    bodyHeight: HEIGHT,
  };

  return (
    <section className="quality-band" aria-labelledby={headingId}>
      <header className="quality-head">
        <div className="min-w-0">
          <h2 id={headingId} className="text-section">{words.title}</h2>
          <p className="text-fine">
            {words.lead}
            {folded && folded.reporting > 0 ? <span className="font-mono"> {words.reporting(folded.reporting)}</span> : null}
          </p>
        </div>
        <Segmented
          label={words.rangeLabel}
          value={range}
          options={NODE_LOAD_RANGES.map((key) => ({ value: key, label: words.range[key] }))}
          onChange={onRange}
        />
      </header>

      {state === 'ready' && folded ? (
        <div className="nodes-load-grid">
          <Panel title={words.cpu} description={words.cpuLead} {...panel}>
            <LineChart
              series={meanMax(folded.cpu)}
              domain={[0, 100]}
              format={share}
              when={when}
              tick={tick}
              label={words.chartLabel(words.cpu, rangeWord)}
              height={HEIGHT}
            />
          </Panel>
          <Panel title={words.memory} description={words.memoryLead} {...panel}>
            <LineChart
              series={meanMax(folded.memory)}
              domain={[0, 100]}
              format={share}
              when={when}
              tick={tick}
              label={words.chartLabel(words.memory, rangeWord)}
              height={HEIGHT}
            />
          </Panel>
          <Panel title={words.load1} description={words.load1Lead} {...panel}>
            <LineChart
              series={meanMax(folded.load1)}
              format={formatLoadAverage}
              when={when}
              tick={tick}
              label={words.chartLabel(words.load1, rangeWord)}
              height={HEIGHT}
            />
          </Panel>
          <Panel title={words.traffic} description={words.trafficLead} {...panel}>
            <LineChart
              series={[
                { key: 'in', name: words.in, points: folded.netIn },
                { key: 'out', name: words.out, points: folded.netOut },
              ]}
              format={rate}
              scale="bytes"
              when={when}
              tick={tick}
              label={words.chartLabel(words.traffic, rangeWord)}
              height={HEIGHT}
            />
          </Panel>
        </div>
      ) : (
        <Panel title={words.title} {...panel} />
      )}
    </section>
  );
}

function meanMax(pair: Folded['cpu']): LineSeries[] {
  return [
    { key: 'mean', name: words.mean, points: pair.mean as LoadPoint[] },
    { key: 'max', name: words.max, points: pair.max as LoadPoint[] },
  ];
}
