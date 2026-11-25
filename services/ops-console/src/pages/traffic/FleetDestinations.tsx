import { useMemo, useState } from 'react';
import type { FleetDestinationDto, RouteKind } from '@contract';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Meter } from '@/components/ops/Meter';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { Segmented } from '@/components/ops/Segmented';
import { copy } from '@/copy/copy';
import {
  trafficApi,
  type FleetDestinationSort,
  type TrafficRange,
} from '@/lib/api-traffic';
import { formatCount, formatLatency, splitBytes } from '@/lib/display';
import { useResource } from '@/lib/use-resource';

type RouteFilter = 'all' | Extract<RouteKind, 'direct' | 'cloud' | 'residential'>;

const words = copy.traffic.destinations;
const ROUTE_FILTERS: readonly RouteFilter[] = ['all', 'direct', 'cloud', 'residential'];
const SORT_OPTIONS: readonly FleetDestinationSort[] = ['bytes', 'stalls', 'connections'];

export function FleetDestinationsPanel({
  range,
  beat,
}: {
  range: TrafficRange;
  beat: number;
}) {
  const [route, setRoute] = useState<RouteFilter>('all');
  const [sort, setSort] = useState<FleetDestinationSort>('bytes');
  const [search, setSearch] = useState('');
  const trimmed = search.trim().toLowerCase();

  const resource = useResource(
    `traffic-destinations-${range}-${route}-${sort}-${trimmed}`,
    (signal) =>
      trafficApi.destinations(
        { range, route, sort, q: trimmed || undefined, limit: 50 },
        signal,
      ),
    beat,
  );

  const items = resource.status === 'ready' ? resource.data.items : [];
  const panelState: PanelState =
    resource.status === 'ready'
      ? (items.length === 0 ? 'empty' : 'ready')
      : resource.status;

  return (
    <Panel
      title={words.title}
      description={words.lead}
      state={panelState}
      onRetry={resource.reload}
      emptyText={words.empty}
      source={copy.sourceWord.collector}
      asOfSec={resource.status === 'ready' ? resource.data.updatedAt : null}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label={words.routeLabel}
            value={route}
            options={ROUTE_FILTERS.map((value) => ({ value, label: words.routes[value] }))}
            onChange={setRoute}
          />
          <Segmented
            label={words.sortLabel}
            value={sort}
            options={SORT_OPTIONS.map((value) => ({ value, label: words.sorts[value] }))}
            onChange={setSort}
          />
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={words.searchPlaceholder}
          aria-label={words.searchPlaceholder}
          className="h-8 rounded border border-[var(--hairline)] bg-transparent px-2.5 text-fine text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
        />
      </div>
      <FleetDestinationsTable rows={items} state="ready" />
    </Panel>
  );
}

export function FleetDestinationsTable({
  rows,
  state = 'ready',
}: {
  rows: FleetDestinationDto[];
  state?: TableState;
}) {
  const topBytes = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.bytesUp + row.bytesDown), 0),
    [rows],
  );
  const columns = useMemo(() => fleetColumns(topBytes), [topBytes]);

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => `${row.etld1}\t${row.route}`}
      state={rows.length === 0 ? 'empty' : state}
      emptyMessage={words.empty}
    />
  );
}

function fleetColumns(topBytes: number): DataColumn<FleetDestinationDto>[] {
  return [
    {
      id: 'site',
      header: words.columns.site,
      sortValue: (row) => row.etld1,
      cell: (row) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-mono text-body">{row.etld1}</span>
          {row.topProcesses.length === 0 && row.nodes.length === 0 ? null : (
            <span className="truncate text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
              {[...row.topProcesses, ...row.nodes].slice(0, 4).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'route',
      header: words.columns.route,
      width: '76px',
      sortValue: (row) => row.route,
      cell: (row) => <span className="ops-tag">{copy.route[row.route]}</span>,
    },
    {
      id: 'users',
      header: words.columns.users,
      width: '68px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.users,
      cell: (row) => formatCount(row.users),
    },
    {
      id: 'connections',
      header: words.columns.connections,
      width: '80px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.connections,
      cell: (row) => formatCount(row.connections),
    },
    {
      id: 'stalls',
      header: words.columns.stalls,
      width: '124px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.stalledConnections,
      cell: (row) =>
        row.closedConnections > 0 ? (
          <span className={row.stalledConnections > 0 ? 'text-[var(--bad)]' : undefined}>
            {words.stallCell(row.stalledConnections, row.stallRate)}
          </span>
        ) : (
          copy.missing
        ),
    },
    {
      id: 'avgDuration',
      header: words.columns.avgDuration,
      width: '92px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.avgDurationMs,
      cell: (row) =>
        row.closedConnections > 0 ? formatLatency(row.avgDurationMs) : copy.missing,
    },
    {
      id: 'bytes',
      header: words.columns.bytes,
      width: '148px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.bytesUp + row.bytesDown,
      cell: (row) => {
        const total = row.bytesUp + row.bytesDown;
        const split = splitBytes(total);
        return (
          <span className="inline-flex items-center justify-end gap-2">
            <Meter ratio={topBytes > 0 ? total / topBytes : null} />
            <span>
              {split.number}
              <span className="ml-1 text-micro font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
                {split.unit}
              </span>
            </span>
          </span>
        );
      },
    },
  ];
}
