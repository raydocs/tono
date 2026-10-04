import { useMemo } from 'react';
import type { CustomerSummaryDto } from '@contract';
import { aggregateFleetRates, coverageByBucket, fleetByteTransfer, latestValidRate, nodeByteTransfer, seriesRates } from '@legacy-lib/traffic';
import { LineChart } from '@/components/ops/LineChart';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { Segmented } from '@/components/ops/Segmented';
import { measured } from '@/components/ops/measured';
import { MeasuredValue } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { trafficApi, trafficRange, TRAFFIC_RANGES } from '@/lib/api-traffic';
import { formatBytesMeasured, formatClock, formatDay, formatWhen } from '@/lib/display';
import { openCustomer, openNodePage, setTrafficRange } from '@/lib/hash-route';
import { useBeat } from '@/lib/use-poll';
import { usePrivacy } from '@/lib/privacy';
import { useResource, type Resource } from '@/lib/use-resource';

const words = copy.traffic;
function stateOf(resource: Resource<unknown>, empty: boolean): PanelState {
  return resource.status === 'ready' ? (empty ? 'empty' : 'ready') : resource.status;
}

export default function TrafficPage({ range: selected, customers }: {
  range: string | null;
  customers: Resource<CustomerSummaryDto[]>;
}) {
  const range = trafficRange(selected);
  const beat = useBeat(60);
  const privacy = usePrivacy();
  const network = useResource(`traffic-network-${range}`, (signal) => trafficApi.metrics(range, signal), beat);
  const hours = useResource(`traffic-hours-${range}`, (signal) => trafficApi.usage(range, signal), beat);
  // useResource retains a last same-key answer during refresh, but a new range
  // must not render the previous range for even the render before its effect.
  const data = network.status === 'ready' && network.data.range === range ? network.data : null;
  const hourly = hours.status === 'ready' && hours.data.range === range ? hours.data : null;
  const folded = useMemo(() => {
    if (!data) return null;
    const rates = Object.fromEntries(Object.entries(data.series).map(([name, points]) => [name, seriesRates(points, data.resolutionSeconds)]));
    const fleet = aggregateFleetRates(rates, null);
    return { fleet, latest: latestValidRate(fleet), coverage: coverageByBucket(fleet), transfer: fleetByteTransfer(data.series, data.resolutionSeconds),
      top: Object.entries(data.series).map(([name, points]) => ({ name, ...nodeByteTransfer(points, data.resolutionSeconds),
        peakIn: peak(rates[name]?.map((point) => point.inBps) ?? []), peakOut: peak(rates[name]?.map((point) => point.outBps) ?? []) }))
        .filter((row) => row.inBytes !== null || row.outBytes !== null)
        .sort((a, b) => (b.inBytes ?? 0) + (b.outBytes ?? 0) - (a.inBytes ?? 0) - (a.outBytes ?? 0)).slice(0, 8),
      at: fleet.filter((point) => point.inBps !== null || point.outBps !== null).at(-1)?.t ?? null };
  }, [data]);
  const tick = range === '24h' ? formatClock : formatDay;
  const networkState = network.status === 'ready' && !data ? 'loading' : stateOf(network, !folded?.top.length);
  const hoursState = hours.status === 'ready' && !hourly ? 'loading' : stateOf(hours, !hourly?.fleet.some((point) => point.bytes !== null));
  const people = customers.status === 'ready' ? [...customers.data].sort((a, b) => (b.usageBytes.value ?? -1) - (a.usageBytes.value ?? -1)).slice(0, 12) : [];

  return (
    <div className="page-wrap flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-fine">{words.lead}</p>
        <Segmented label={words.rangeLabel} value={range} options={TRAFFIC_RANGES.map((value) => ({ value, label: words.range[value] }))} onChange={setTrafficRange} />
      </header>
      <Panel title={words.network} description={words.networkLead} state={networkState} onRetry={network.reload}
        emptyText={words.empty} source={words.source} asOfSec={folded?.at ?? null} staleAfterSec={data ? data.resolutionSeconds * 3 : undefined}>
        {folded ? <>
          <p className="flex flex-wrap gap-3 text-body"><span>{words.down} <MeasuredValue measured={measured(folded.transfer.inBytes, folded.at, words.source)} format={formatBytesMeasured} mono /></span>
            <span>{words.up} <MeasuredValue measured={measured(folded.transfer.outBytes, folded.at, words.source)} format={formatBytesMeasured} mono /></span></p>
          <p className="text-fine">{words.coverage(folded.coverage.inPresent, folded.coverage.outPresent)}</p>
          <p className="flex flex-wrap gap-3 text-fine">{words.latest}
            <span>{words.down} <MeasuredValue measured={measured(folded.latest?.inBps ?? null, folded.at, words.source)} format={(value) => words.rate(formatBytesMeasured(value))} mono tier="fine" /></span>
            <span>{words.up} <MeasuredValue measured={measured(folded.latest?.outBps ?? null, folded.at, words.source)} format={(value) => words.rate(formatBytesMeasured(value))} mono tier="fine" /></span>
          </p>
          <LineChart label={words.network} format={(value) => words.rate(formatBytesMeasured(value))} when={formatWhen} tick={tick} scale="bytes"
            series={[{ key: 'in', name: words.down, points: folded.fleet.map((point) => ({ t: point.t, v: point.inBps })) },
              { key: 'out', name: words.up, points: folded.fleet.map((point) => ({ t: point.t, v: point.outBps })) }]} />
        </> : null}
      </Panel>
      <Panel title={words.top} description={words.topLead} state={networkState} onRetry={network.reload} emptyText={words.empty}
        source={words.source} asOfSec={folded?.at ?? null}>
        {folded?.top.map((row) => <button key={row.name} type="button" onClick={() => openNodePage(row.name)}
          className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] py-3 text-left">
          <span className="text-body">{row.name}</span>
          <span className="flex flex-wrap gap-3 text-fine"><span>{words.down} <MeasuredValue measured={measured(row.inBytes, folded.at, words.source)} format={formatBytesMeasured} mono tier="fine" /></span>
            <span>{words.up} <MeasuredValue measured={measured(row.outBytes, folded.at, words.source)} format={formatBytesMeasured} mono tier="fine" /></span></span>
          <span className="flex w-full flex-wrap gap-3 text-fine">{words.peak}
            <span>{words.down} <MeasuredValue measured={measured(row.peakIn, folded.at, words.source)} format={(value) => words.rate(formatBytesMeasured(value))} mono tier="fine" /></span>
            <span>{words.up} <MeasuredValue measured={measured(row.peakOut, folded.at, words.source)} format={(value) => words.rate(formatBytesMeasured(value))} mono tier="fine" /></span>
          </span>
        </button>)}
      </Panel>
      <Panel title={words.customer} description={words.customerLead} state={stateOf(customers, people.length === 0)} emptyText={words.customersEmpty}>
        {people.map((person) => <button key={person.userId} type="button" onClick={() => openCustomer(person.userId)}
          className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] py-3 text-left">
          <span className="text-body">{privacy.email(person.email)}</span>
          <MeasuredValue measured={person.usageBytes} tier="fine" mono format={(value) => words.quota(formatBytesMeasured(value), person.quotaBytes === null ? copy.noQuota : formatBytesMeasured(person.quotaBytes))} />
        </button>)}
      </Panel>
      <Panel title={words.hours} description={words.hoursLead} state={hoursState} onRetry={hours.reload} emptyText={words.empty}
        source={words.usageSource} asOfSec={hourly?.fleet.filter((point) => point.bytes !== null).at(-1)?.t ?? null} staleAfterSec={hours.status === 'ready' ? hours.data.resolutionSeconds * 3 : undefined}>
        {hourly ? <LineChart label={words.hours} format={formatBytesMeasured} when={formatWhen} tick={tick} scale="bytes"
          series={[{ key: 'bytes', name: words.hours, points: hourly.fleet.map((point) => ({ t: point.t, v: point.bytes })) }]} /> : null}
      </Panel>
    </div>
  );
}

function peak(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.max(...known) : null;
}
