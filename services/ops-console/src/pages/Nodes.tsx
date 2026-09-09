import { useMemo, useState } from 'react';
import { LayoutGrid, Table as TableIcon } from 'lucide-react';
import { CountText } from '@/components/ops/CountText';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { DetailDrawer, Fact } from '@/components/ops/DetailDrawer';
import { Empty } from '@/components/ops/Empty';
import { QuotaBar } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, formatDate, formatPercent, splitBytes } from '@/lib/display';
import { closeNode, openNode, openNodePage } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { useIsPhone } from '@/lib/use-phone';
import { countLine, NODE_FILTERS, selectNodes, type NodeFilter, type NodeFilterId } from '@/lib/selectors';
import { cn } from '@/lib/utils';
import type { Tone } from '@/components/ops/StatusWord';
import type { FleetState } from '@/lib/use-fleet';
import { NodeCardGrid } from './NodeCardGrid';
import { toNodeView, type NodeView } from './node-metrics';

export default function NodesPage({ fleet, selected }: { fleet: FleetState; selected: string | null }) {
  const privacy = usePrivacy();
  const phone = useIsPhone();
  const [filter, setFilter] = useState<NodeFilter>(null);
  const [chosen, setChosen] = useState<'cards' | 'table'>('cards');
  /**
   * One card per screen at 390 px is a scroll through forty-five screens to
   * find the one that is broken. Three columns of the table — the word, the
   * name, the quota — fit and answer the same question in one screen, so the
   * phone gets the table whatever the toggle says, and the toggle goes.
   */
  const view = phone ? 'table' : chosen;

  const liveAgents = fleet.status === 'ready' ? fleet.live?.agents ?? null : null;
  const all = useMemo(
    () => (fleet.status === 'ready' ? fleet.fleet.nodes : []),
    [fleet],
  );
  const counts = useMemo(() => countLine(all), [all]);
  const allViews = useMemo(
    () => all.map((node) => toNodeView(node, liveAgents)),
    [all, liveAgents],
  );
  const kept = useMemo(
    () => new Set(selectNodes(all, filter).map((node) => node.name)),
    [all, filter],
  );
  const views = useMemo(() => allViews.filter((row) => kept.has(row.node.name)), [allViews, kept]);
  /**
   * The client-side leg of the path has no collector behind it yet, so every
   * node answers "not wired" and the column is forty-five identical em dashes
   * wide enough to push the mainland return leg off the card. It comes back on
   * its own the moment one node has a measurement — the condition is the data,
   * not a flag somebody has to remember to flip.
   */
  const pathWired = useMemo(() => allViews.some((row) => row.path.value !== null), [allViews]);
  const selectedView = allViews.find((row) => row.node.name === selected) ?? null;

  const tableState: TableState = fleet.status === 'loading'
    ? 'loading'
    : fleet.status === 'error'
      ? 'error'
      : views.length === 0
        ? 'empty'
        : 'ready';

  const columns = useMemo(() => nodeColumns(pathWired, phone), [pathWired, phone]);

  return (
    <div className="page-wrap">
      <div className="page-head">
        {/* R2 reaches the headline too: a fleet that failed to load has no counts,
            and a zero count would be a measurement the console never took. */}
        {fleet.status === 'ready' ? (
          <p className="text-verdict">
            {NODE_FILTERS.map((id, index) => (
              <span key={id}>
                {index === 0 ? null : <span className="mx-2 text-[var(--muted-foreground)]">·</span>}
                <CountBit
                  id={id}
                  active={filter === id}
                  count={counts[id]}
                  render={(values) => copy.count[id](values[0])}
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

        {fleet.status === 'ready' && all.length > 0 && !pathWired ? (
          <p className="text-body text-[var(--muted-foreground)]">{copy.pathNotWired}</p>
        ) : null}

        {phone ? null : (
          <div className="toolbar-row">
            <button
              type="button"
              aria-pressed={view === 'cards'}
              className={cn(
                'flex h-8 items-center gap-1 rounded-[999px] border border-[var(--hairline)] px-3 text-micro',
                view === 'cards' && 'bg-[var(--accent)] text-white',
              )}
              onClick={() => setChosen('cards')}
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
              onClick={() => setChosen('table')}
            >
              <TableIcon size={12} />
              {copy.viewTable}
            </button>
          </div>
        )}
      </div>

      {fleet.status === 'error' && !fleet.sessionExpired ? (
        <Empty message={fleet.message || copy.loadError} />
      ) : view === 'cards' ? (
        fleet.status === 'loading' ? (
          <Empty message={copy.loading} />
        ) : views.length === 0 ? (
          <Empty message={copy.emptyList} />
        ) : (
          <NodeCardGrid views={views} selected={selected} showPath={pathWired} onOpen={openNode} />
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
        action={selectedView ? (
          <button
            type="button"
            className="text-micro text-[var(--accent)] hover:underline"
            onClick={() => openNodePage(selectedView.node.name)}
          >
            {copy.nodeOpenPage}
          </button>
        ) : null}
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
  count,
  render,
  onClick,
}: {
  id: NodeFilterId;
  active: boolean;
  count: number;
  render: (values: number[]) => string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn('count-bit', `tone-${FRAGMENT_TONE[id]}`)}
      onClick={onClick}
    >
      <CountText values={[count]} render={render} />
    </button>
  );
}

function nodeColumns(showPath: boolean, phone: boolean): DataColumn<NodeView>[] {
  if (phone) return phoneColumns();
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
    ...(showPath ? [{
      id: 'path',
      header: copy.customerPath,
      width: '96px',
      cell: (row: NodeView) => <Value value={row.path.value} source={row.path.source} />,
    }] : []),
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

/** The three the fleet is judged on, at 390 px: the word, the name, the quota. */
function phoneColumns(): DataColumn<NodeView>[] {
  return [
    {
      id: 'status',
      header: copy.status,
      width: '68px',
      sortValue: (row) => row.health,
      cell: (row) => <StatusWord word={row.health} />,
    },
    {
      id: 'name',
      header: copy.node,
      sortValue: (row) => row.node.name,
      cell: (row) => <span className="block truncate text-body">{row.node.name}</span>,
    },
    {
      id: 'traffic',
      header: copy.periodTraffic,
      width: '104px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.used.value ?? -1,
      cell: (row) => <CompactTrafficCell row={row} />,
    },
  ];
}

/**
 * Used and the bar, with the arithmetic in the title.
 *
 * Used, the cap and the remaining share spelled out needs about 200 px and a phone column
 * has a hundred; right-aligned, the overflow is clipped from the left, which
 * turns the used figure — the only part anybody reads — into "· TB". The bar
 * already carries the ratio.
 */
function CompactTrafficCell({ row }: { row: NodeView }) {
  if (row.used.value == null) return <Value value={null} source={row.used.source} mono />;
  const used = splitBytes(row.used.value);
  const quota = row.quota;
  const full = quota == null
    ? copy.usageNoQuota(`${used.number} ${used.unit}`)
    : copy.usageTitle(
      `${used.number} ${used.unit}`,
      `${splitBytes(quota).number} ${splitBytes(quota).unit}`,
      formatPercent((quota - row.used.value) / quota),
    );
  return (
    <span className="inline-flex w-full flex-col items-end gap-1" title={full}>
      <span className="truncate">{used.number} {used.unit}</span>
      {quota == null ? null : <QuotaBar used={row.used.value} quota={quota} />}
    </span>
  );
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
