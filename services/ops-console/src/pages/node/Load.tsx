import { useId, useMemo, useState } from 'react';
import { LineChart, type LineSeries } from '@/components/ops/LineChart';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { Segmented } from '@/components/ops/Segmented';
import { copy } from '@/copy/copy';
import { formatBytesMeasured, formatClock, formatCount, formatDate, formatDay, formatPercent } from '@/lib/display';
import { foldLoad, hasLoad, nodeLegacyApi, NODE_LOAD_RANGES, type NodeLoadRange } from '@/lib/node-legacy';
import { useResource } from '@/lib/use-resource';

const words = copy.nodeBoard.load;
/** The agent reports every few minutes; a quarter of an hour without a sample is late. */
const STALE_AFTER_SEC = 15 * 60;
const HEIGHT = 150;

const share = (value: number) => formatPercent(value / 100);
const rate = (value: number) => copy.nodeLoadRate(formatBytesMeasured(value));
const count = (value: number) => words.count(formatCount(Math.round(value)));

/**
 * How hard the box itself is working: four panels over one read of the
 * agent's samples, so the four charts always cover the same window. Drawn
 * open, because a node page is opened when something about the node is in
 * question and the machine's own load is the first thing ruled in or out.
 */
export function NodeLoad({ name }: { name: string }) {
  const headingId = useId();
  const [range, setRange] = useState<NodeLoadRange>('24h');
  const taken = useResource(`${name}#${range}`, (signal) => nodeLegacyApi.load(name, range, signal));
  const charts = useMemo(() => (taken.status === 'ready' ? foldLoad(taken.data) : null), [taken]);
  const state: PanelState = taken.status === 'loading'
    ? 'loading'
    : taken.status === 'error' ? 'error' : charts && hasLoad(charts) ? 'ready' : 'empty';
  const rangeWord = copy.nodeLoadRange[range];
  const tick = range === '24h' ? formatClock : formatDay;
  const when = (at: number) => copy.nodeWhenBoth(formatDate(at), formatClock(at));
  const panel = {
    state,
    source: copy.nodesBoard.load.source,
    asOfSec: charts?.asOfSec ?? null,
    staleAfterSec: STALE_AFTER_SEC,
    emptyText: words.empty,
    onRetry: taken.reload,
    bodyHeight: HEIGHT,
  };
  const chart = { when, tick, height: HEIGHT };
  const line = (key: string, name: string, points: LineSeries['points']): LineSeries[] => [{ key, name, points }];

  return (
    <section className="quality-band" aria-labelledby={headingId}>
      <header className="quality-head">
        <div className="min-w-0">
          <h2 id={headingId} className="text-section">{copy.nodeSections.load}</h2>
          <p className="text-fine">{words.lead}</p>
        </div>
        <Segmented
          label={words.rangeLabel}
          value={range}
          options={NODE_LOAD_RANGES.map((key) => ({ value: key, label: copy.nodeLoadRange[key] }))}
          onChange={setRange}
        />
      </header>

      {state === 'ready' && charts ? (
        <div className="node-load-grid">
          <Panel title={words.cpu} description={words.cpuLead} {...panel}>
            <LineChart
              series={line('cpu', words.used, charts.cpu)}
              domain={[0, 100]}
              format={share}
              label={words.chartLabel(words.cpu, rangeWord)}
              {...chart}
            />
          </Panel>
          <Panel title={words.memory} description={words.memoryLead} {...panel}>
            <LineChart
              series={line('memory', words.used, charts.memory)}
              domain={[0, 100]}
              format={share}
              label={words.chartLabel(words.memory, rangeWord)}
              {...chart}
            />
          </Panel>
          <Panel
            title={words.traffic}
            description={words.trafficLead(charts.bandwidth95 === null ? copy.missing : rate(charts.bandwidth95))}
            {...panel}
          >
            <LineChart
              series={[
                { key: 'in', name: words.in, points: charts.netIn },
                { key: 'out', name: words.out, points: charts.netOut },
              ]}
              format={rate}
              scale="bytes"
              label={words.chartLabel(words.traffic, rangeWord)}
              {...chart}
            />
          </Panel>
          <Panel
            title={words.connections}
            description={words.connectionsLead(charts.peakConnections === null ? copy.missing : count(charts.peakConnections))}
            {...panel}
          >
            <LineChart
              series={line('connections', words.open, charts.connections)}
              format={count}
              label={words.chartLabel(words.connections, rangeWord)}
              {...chart}
            />
          </Panel>
        </div>
      ) : (
        <Panel title={copy.nodeSections.load} {...panel} />
      )}
    </section>
  );
}
