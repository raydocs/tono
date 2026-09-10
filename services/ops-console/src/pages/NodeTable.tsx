import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { QuotaBar } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { formatCount, formatDate, formatPercent, splitBytes } from '@/lib/display';
import { cn } from '@/lib/utils';
import type { NodeView } from './node-metrics';

/**
 * The fleet as eight columns, and the two cells that need more than a value.
 *
 * It sits beside the page rather than inside it because the page is already at
 * its line budget, and because these definitions are read as a set: what the
 * table shows, in what order, at what width.
 */
export function NodeTable({
  views,
  selected,
  showPath,
  phone,
  state,
  errorMessage,
  onOpen,
}: {
  views: NodeView[];
  selected: string | null;
  showPath: boolean;
  phone: boolean;
  state: TableState;
  errorMessage?: string;
  onOpen: (name: string) => void;
}) {
  return (
    <DataTable
      rows={views}
      columns={nodeColumns(showPath, phone)}
      getRowId={(row) => row.node.name}
      selectedId={selected}
      onRowClick={(row) => onOpen(row.node.name)}
      state={state}
      errorMessage={errorMessage}
    />
  );
}

function nodeColumns(showPath: boolean, phone: boolean): DataColumn<NodeView>[] {
  if (phone) return phoneColumns();
  return [
    {
      id: 'status',
      header: copy.status,
      width: '74px',
      sortValue: (row) => row.word,
      cell: (row) => (
        <StatusWord
          word={row.word}
          tone={row.tone}
          reason={row.reason}
          className={cn(row.retired && 'text-[var(--muted-foreground)]')}
        />
      ),
    },
    {
      id: 'name',
      header: copy.node,
      sortValue: (row) => row.node.name,
      cell: (row) => (
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-row">{row.node.name}</span>
          <span className="min-w-0 shrink truncate text-micro text-[var(--muted-foreground)]">{row.region}</span>
          {row.lifecycle === 'listed' ? null : (
            <span className="ops-tag shrink-0">{copy.nodeLifecycle[row.lifecycle]}</span>
          )}
        </div>
      ),
    },
    {
      id: 'occupancy',
      header: copy.inUse,
      width: '64px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.occupancy.value ?? -1,
      cell: (row) => <Value
        value={row.occupancy.value === null ? null : `${formatCount(row.occupancy.value)} ${copy.occupancyUnit}`}
        source={row.occupancy.source}
        mono
      />,
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
      width: '150px',
      mono: true,
      sortValue: (row: NodeView) => row.forward.value ?? '',
      cell: (row: NodeView) => <Value value={row.forward.value} source={row.forward.source} mono />,
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
          value={row.renew.value === null ? null : formatDate(row.renew.value)}
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
      sortValue: (row) => row.word,
      cell: (row) => <StatusWord word={row.word} tone={row.tone} reason={row.reason} />,
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
  if (row.used.value === null) return <Value value={null} source={row.used.source} mono />;
  const used = splitBytes(row.used.value);
  const quota = row.quota;
  const full = quota === null
    ? copy.usageNoQuota(`${used.number} ${used.unit}`)
    : copy.usageTitle(
      `${used.number} ${used.unit}`,
      `${splitBytes(quota).number} ${splitBytes(quota).unit}`,
      formatPercent((quota - row.used.value) / quota),
    );
  return (
    <span className="inline-flex w-full flex-col items-end gap-1" title={full}>
      <span className="truncate">{used.number} {used.unit}</span>
      {quota === null ? null : <QuotaBar used={row.used.value} quota={quota} />}
    </span>
  );
}

/** Used, quota and the remaining share, over the same 2 px bar the card uses. */
function TrafficCell({ row }: { row: NodeView }) {
  if (row.quota === null) {
    return <span className="text-micro text-[var(--muted-foreground)]">{copy.noQuota}</span>;
  }
  if (row.used.value === null) {
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
