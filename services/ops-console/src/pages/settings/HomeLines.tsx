import { useMemo, useState } from 'react';
import type { HomeLineDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { settingsApi } from '@/lib/api-settings';
import { formatBytesMeasured, formatDate } from '@/lib/display';
import { cycleWord } from '@/lib/settings';
import { shown } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';
import { HomeLineDrawer } from './HomeLineDrawer';
import { ConfirmDialog, Toolbar } from './form';
import { useWrite } from './use-write';

const words = copy.settings.homelines;

/** A line's status word; anything the hub invents falls through as itself. */
export function statusWord(status: string): string {
  const known = words.status as Record<string, string>;
  return known[status] ?? status;
}

/**
 * Residential lines: the exits that are not in a datacentre.
 *
 * Everything on this table is a bill or a deadline: what it costs, when it
 * renews, how much of the allowance is gone. The two measured columns (usage
 * and probe) go through `Value`, so a line nobody has metered says so instead
 * of reading as a line that used nothing.
 */
export function HomeLines() {
  const lines = useResource('home-lines', (signal) => settingsApi.homeLines(signal));
  const [editing, setEditing] = useState<HomeLineDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<HomeLineDto | null>(null);
  const write = useWrite(lines.reload);

  const rows = lines.status === 'ready' ? lines.data.items : [];
  const columns = useMemo(() => lineColumns(), []);
  const state: TableState = lines.status === 'loading'
    ? 'loading'
    : lines.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Toolbar aside={<Action primary onClick={() => setEditing('new')}>{words.newLine}</Action>}>
          {lines.status === 'ready' ? <span>{words.count(rows.length)}</span> : null}
        </Toolbar>
        {write.error ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
        ) : null}
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          onRowClick={(row) => setEditing(row)}
          state={state}
          emptyMessage={words.empty}
          errorMessage={lines.status === 'error' ? lines.message : undefined}
        />
      </div>

      <HomeLineDrawer
        line={editing}
        onClose={() => setEditing(null)}
        onSaved={lines.reload}
        onRemove={(row) => { setEditing(null); setRemoving(row); }}
      />

      <ConfirmDialog
        open={removing !== null}
        title={words.deleteTitle}
        body={removing ? words.deleteBody(removing.displayName) : ''}
        confirm={copy.settings.remove}
        pending={write.pending}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const row = removing;
          if (!row) return;
          void write.run(() => settingsApi.deleteHomeLine(row.id)).then(() => setRemoving(null));
        }}
      />
    </div>
  );
}

function lineColumns(): DataColumn<HomeLineDto>[] {
  return [
    {
      id: 'line',
      header: words.columns.line,
      sortValue: (row) => row.displayName,
      cell: (row) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-row">{row.displayName}</span>
          <span className="truncate font-mono text-[11px] leading-tight text-[var(--muted-foreground)]">
            {row.proxyName}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: words.columns.status,
      width: '64px',
      sortValue: (row) => row.status,
      cell: (row) => <span className="ops-tag">{statusWord(row.status)}</span>,
    },
    {
      id: 'place',
      header: words.columns.place,
      width: '132px',
      sortValue: (row) => row.isp ?? '',
      cell: (row) => (
        <Value
          value={[row.isp, row.region].filter(Boolean).join(' · ') || null}
          source={copy.sourceWord.manual}
        />
      ),
    },
    {
      id: 'billing',
      header: words.columns.billing,
      width: '124px',
      sortValue: (row) => row.billingKind ?? '',
      cell: (row) => <BillingCell row={row} />,
    },
    {
      id: 'expires',
      header: words.columns.expires,
      width: '100px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.expiresAt ?? 0,
      cell: (row) => (
        <Value
          value={row.expiresAt === null ? null : formatDate(row.expiresAt)}
          source={copy.sourceWord.manual}
          mono
        />
      ),
    },
    {
      id: 'usage',
      header: words.columns.usage,
      width: '110px',
      align: 'right',
      mono: true,
      sortValue: (row) => (row.usage.value === null ? null : row.usage.value.bytesUp + row.usage.value.bytesDown),
      cell: (row) => <UsageCell row={row} />,
    },
    {
      id: 'probe',
      header: words.columns.probe,
      width: '92px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.probe.value?.uptimeRatio ?? null,
      cell: (row) => <ProbeCell row={row} />,
    },
  ];
}

/** How it is billed, and what the allowance is when there is one. */
function BillingCell({ row }: { row: HomeLineDto }) {
  if (row.billingKind === null) {
    return <Value value={null} source={copy.sourceWord.manual} />;
  }
  const bundle = row.bundleBytes === null ? null : formatBytesMeasured(row.bundleBytes);
  const cycle = cycleWord(row.cycleStart, row.cycleEnd);
  return (
    <span className="flex min-w-0 flex-col leading-tight" title={cycle ?? undefined}>
      <span className="truncate">
        {words.billingKind[row.billingKind]}
        {bundle ? <span className="ml-1.5 font-mono text-[var(--muted-foreground)]">{bundle}</span> : null}
      </span>
      {cycle ? (
        <span className="truncate font-mono text-[11px] leading-tight text-[var(--muted-foreground)]">
          {cycle}
        </span>
      ) : null}
    </span>
  );
}

function UsageCell({ row }: { row: HomeLineDto }) {
  const usage = shown(row.usage);
  if (usage.value === null) return <Value value={null} source={usage.source} mono />;
  return <span className="truncate">{formatBytesMeasured(usage.value.bytesUp + usage.value.bytesDown)}</span>;
}

function ProbeCell({ row }: { row: HomeLineDto }) {
  const probe = shown(row.probe);
  if (probe.value === null) return <Value value={null} source={probe.source} mono />;
  return (
    <span className="truncate" title={probe.value.status ?? undefined}>
      {words.probeAlive(probe.value.alive, probe.value.total)}
    </span>
  );
}
