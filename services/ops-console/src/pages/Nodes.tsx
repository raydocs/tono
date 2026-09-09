import { useMemo, useState } from 'react';
import { LayoutGrid, Table as TableIcon } from 'lucide-react';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { QuotaBar } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, formatDate, formatPercent, splitBytes } from '@/lib/display';
import { closeNode, openNode } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { countLine, NODE_FILTERS, selectNodes, type NodeFilter, type NodeFilterId } from '@/lib/selectors';
import { cn } from '@/lib/utils';
import type { Tone } from '@/components/ops/StatusWord';
import type { FleetState } from '@/lib/use-fleet';
import { NodeCardGrid } from './NodeCardGrid';
import { toNodeView, type NodeView } from './node-metrics';

export default function NodesPage({ fleet, selected }: { fleet: FleetState; selected: string | null }) {
  const privacy = usePrivacy();
  const [filter, setFilter] = useState<NodeFilter>(null);
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const liveAgents = fleet.status === 'ready' ? fleet.live?.agents ?? null : null;
  const all = useMemo(
    () => (fleet.status === 'ready' ? fleet.fleet.nodes : []),
    [fleet],
  );
  const counts = useMemo(() => countLine(all), [all]);
  const filtered = useMemo(() => selectNodes(all, filter), [all, filter]);
  const views = useMemo(
    () => filtered.map((node) => toNodeView(node, liveAgents)),
    [filtered, liveAgents],
  );
  const selectedView = views.find((row) => row.node.name === selected)
    ?? all.map((node) => toNodeView(node, liveAgents)).find((row) => row.node.name === selected)
    ?? null;

  const tableState: TableState = fleet.status === 'loading'
    ? 'loading'
    : fleet.status === 'error'
      ? 'error'
      : views.length === 0
        ? 'empty'
        : 'ready';

  const columns = useMemo(() => nodeColumns(), []);

  return (
    <div className="page-wrap">
      {/* R2 reaches the headline too: a fleet that failed to load has no counts,
          and "0 台在售" would be a measurement the console never took. */}
      {fleet.status === 'ready' ? (
        <p className="text-verdict">
          {NODE_FILTERS.map((id, index) => (
            <span key={id}>
              {index === 0 ? null : <span className="mx-2 text-[var(--muted-foreground)]">·</span>}
              <CountBit
                id={id}
                active={filter === id}
                label={copy.count[id](counts[id])}
                onClick={() => setFilter((current) => (current === id ? null : id))}
              />
            </span>
          ))}
        </p>
      ) : (
        <p className="text-verdict text-[var(--muted-foreground)]">
          {fleet.status === 'loading' ? copy.loading : copy.loadError}
        </p>
      )}

      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          aria-pressed={view === 'cards'}
          className={cn(
            'flex h-8 items-center gap-1 rounded-[999px] border border-[var(--hairline)] px-3 text-micro',
            view === 'cards' && 'bg-[var(--accent)] text-white',
          )}
          onClick={() => setView('cards')}
        >
          <LayoutGrid size={12} />
          {copy.viewCards}
        </button>
        <button
          type="button"
          aria-pressed={view === 'table'}
          className={cn(
            'flex h-8 items-center gap-1 rounded-[999px] border border-[var(--hairline)] px-3 text-micro',
            view === 'table' && 'bg-[var(--accent)] text-white',
          )}
          onClick={() => setView('table')}
        >
          <TableIcon size={12} />
          {copy.viewTable}
        </button>
      </div>

      {fleet.status === 'error' && !fleet.sessionExpired ? (
        <Empty message={fleet.message || copy.loadError} />
      ) : view === 'cards' ? (
        fleet.status === 'loading' ? (
          <Empty message={copy.loading} />
        ) : views.length === 0 ? (
          <Empty message={copy.emptyList} />
        ) : (
          <NodeCardGrid views={views} selected={selected} onOpen={openNode} />
        )
      ) : (
        <DataTable
          rows={views}
          columns={columns}
          getRowId={(row) => row.node.name}
          selectedId={selected}
          onRowClick={(row) => openNode(row.node.name)}
          state={tableState}
          errorMessage={fleet.status === 'error' ? fleet.message : undefined}
        />
      )}

      <DetailDrawer
        open={Boolean(selectedView)}
        title={selectedView?.node.name ?? ''}
        onClose={closeNode}
      >
        {selectedView ? (
          <>
            <StatusWord word={selectedView.health} className="self-start" />
            <Fact label={copy.facts.ip} measured={selectedView.ip} render={privacy.ip} />
            <Fact label={copy.facts.os} measured={selectedView.os} />
            <Fact label={copy.facts.provider} measured={selectedView.provider} />
            <Fact label={copy.facts.tags} measured={selectedView.tags} />
            <Fact label={copy.facts.ports} measured={selectedView.ports} />
          </>
        ) : null}
      </DetailDrawer>
    </div>
  );
}

/**
 * A fragment of the count sentence. It has to read as prose and behave as a
 * control at once: a real button so the keyboard and screen readers get it,
 * `aria-pressed` for the filter state, an underline on hover, and a 2 px rule
 * in the fragment's own tone once it is on.
 */
const FRAGMENT_TONE: Record<NodeFilterId, Tone | 'none'> = {
  listed: 'none',
  blocked: 'sev',
  unmeasured: 'unk',
};

function CountBit({
  id,
  active,
  label,
  onClick,
}: {
  id: NodeFilterId;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn('count-bit', `tone-${FRAGMENT_TONE[id]}`)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function nodeColumns(): DataColumn<NodeView>[] {
  return [
    {
      id: 'status',
      header: copy.status,
      width: '74px',
      sortValue: (row) => row.health,
      cell: (row) => <StatusWord word={row.health} />,
    },
    {
      id: 'name',
      header: copy.node,
      sortValue: (row) => row.node.name,
      cell: (row) => (
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-row">{row.node.name}</span>
          <span className="min-w-0 shrink truncate text-micro text-[var(--muted-foreground)]">{row.region}</span>
        </div>
      ),
    },
    {
      id: 'listed',
      header: copy.listed,
      width: '64px',
      sortValue: (row) => (row.node.catalogListed === true ? 1 : 0),
      cell: (row) => (row.node.catalogListed === true ? copy.listed : copy.unlisted),
    },
    {
      id: 'occupancy',
      header: copy.inUse,
      width: '64px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.occupancy.value,
      cell: (row) => `${formatCount(row.occupancy.value)} ${copy.occupancyUnit}`,
    },
    {
      id: 'traffic',
      header: copy.periodTraffic,
      width: '224px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.used.value ?? -1,
      cell: (row) => <TrafficCell row={row} />,
    },
    {
      id: 'path',
      header: copy.customerPath,
      width: '96px',
      cell: (row) => <Value value={null} source={row.path.source} />,
    },
    {
      id: 'mainland',
      header: copy.mainlandReturn,
      width: '150px',
      mono: true,
      sortValue: (row) => row.mainland.value ?? '',
      cell: (row) => <Value value={row.mainland.value} source={row.mainland.source} mono />,
    },
    {
      id: 'renew',
      header: copy.renew,
      width: '112px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.renew.value ?? 0,
      cell: (row) => (
        <Value
          value={row.renew.value == null ? null : formatDate(row.renew.value)}
          source={row.renew.source}
          mono
        />
      ),
    },
  ];
}

/** Used, quota and the remaining share, over the same 2 px bar the card uses. */
function TrafficCell({ row }: { row: NodeView }) {
  if (row.quota == null) {
    return <span className="text-micro text-[var(--muted-foreground)]">{copy.noQuota}</span>;
  }
  if (row.used.value == null) {
    return <Value value={null} source={row.used.source} mono />;
  }
  const used = splitBytes(row.used.value);
  const cap = splitBytes(row.quota);
  const remain = formatPercent((row.quota - row.used.value) / row.quota);
  return (
    <span className="inline-flex w-full flex-col items-end gap-1">
      <span className="truncate">
        {used.number} {used.unit} / {cap.number} {cap.unit}
        <span className="text-[var(--muted-foreground)]"> · {copy.remaining} {remain}</span>
      </span>
      <QuotaBar used={row.used.value} quota={row.quota} />
    </span>
  );
}
