import { useMemo, useState } from 'react';
import type { HomeLineDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn } from '@/components/ops/DataTable';
import { Meter } from '@/components/ops/Meter';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { Segmented } from '@/components/ops/Segmented';
import type { Tone } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { settingsApi } from '@/lib/api-settings';
import { nowSec } from '@/lib/clock';
import { formatBytesMeasured, formatDate } from '@/lib/display';
import { renewsSoon } from '@/lib/residential';
import { cycleWord } from '@/lib/settings';
import { shown as shownMeasured } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';
import '@/styles/residential.css';
import '@/styles/settings-assets.css';
import { HomeLineDrawer } from './HomeLineDrawer';
import { LinesBand } from './home/LinesBand';
import { LinesCharts } from './home/LinesCharts';
import { ConfirmDialog } from './form';
import { useWrite } from './use-write';

const words = copy.settings.homelines;
const board = copy.residential.lines;

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
  const [filter, setFilter] = useState<Filter>('all');
  const write = useWrite(lines.reload);

  const ready = lines.status === 'ready';
  const rows = useMemo(() => (lines.status === 'ready' ? lines.data.items : []), [lines]);
  const columns = useMemo(() => lineColumns(), []);
  const now = nowSec();
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: rows.length, soon: 0, unmetered: 0, retired: 0 };
    for (const row of rows) for (const key of FILTERS) if (matches(row, key, now)) out[key] += 1;
    return out;
  }, [rows, now]);
  const shown = useMemo(
    () => rows
      .filter((row) => filter === 'all' || matches(row, filter, now))
      .sort(byUrgency),
    [rows, filter, now],
  );
  const asOfSec = rows.reduce<number | null>((top, row) => [row.usage.asOfSec, row.probe.asOfSec].reduce<number | null>(
    (best, at) => (at === null ? best : Math.max(best ?? 0, at)),
    top,
  ), null);

  const state: PanelState = lines.status === 'loading'
    ? 'loading'
    : lines.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="settings-homelines home-board">
      <LinesBand rows={ready ? rows : null} />

      {write.error ? (
        <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
      ) : null}

      <LinesCharts rows={rows} state={state} asOfSec={asOfSec} onRetry={lines.reload} />

      <Panel
        title={board.table}
        description={board.tableLead}
        actions={<Action primary onClick={() => setEditing('new')}>{words.newLine}</Action>}
        source={board.source}
        asOfSec={asOfSec}
        state={state}
        emptyText={words.empty}
        onRetry={lines.reload}
        bodyHeight={160}
      >
        <Segmented
          label={board.filterLabel}
          value={filter}
          options={[
            { value: 'all', label: board.filter.all, count: counts.all },
            ...FILTERS.filter((key) => counts[key] > 0).map((key) => ({
              value: key,
              label: board.filter[key],
              count: counts[key],
            })),
          ]}
          onChange={setFilter}
          className="home-filter"
        />
        <DataTable
          rows={shown}
          columns={columns}
          getRowId={(row) => row.id}
          onRowClick={(row) => setEditing(row)}
          state={shown.length === 0 ? 'empty' : 'ready'}
          emptyMessage={board.noMatch}
          className="settings-homelines-table"
        />
      </Panel>

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

type Filter = 'all' | 'soon' | 'unmetered' | 'retired';
const FILTERS = ['soon', 'unmetered', 'retired'] as const;

function matches(row: HomeLineDto, filter: Exclude<Filter, 'all'>, now: number): boolean {
  if (filter === 'soon') return renewsSoon(row, now);
  if (filter === 'unmetered') return row.status === 'active' && row.usage.value === null;
  return row.status !== 'active';
}

/** Lines still in use first, the one that lapses soonest on top; undated lines after dated ones. */
function byUrgency(a: HomeLineDto, b: HomeLineDto): number {
  const live = Number(b.status === 'active') - Number(a.status === 'active');
  if (live !== 0) return live;
  const at = (a.expiresAt ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt ?? Number.MAX_SAFE_INTEGER);
  return at !== 0 ? at : a.displayName.localeCompare(b.displayName);
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
      width: '112px',
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
      width: '188px',
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

/** Against the bundle when there is one, so a line about to run dry shows it. */
function UsageCell({ row }: { row: HomeLineDto }) {
  const usage = shownMeasured(row.usage);
  if (usage.value === null) return <Value value={null} source={usage.source} mono />;
  const used = usage.value.bytesUp + usage.value.bytesDown;
  const text = formatBytesMeasured(used);
  if (row.bundleBytes === null || row.bundleBytes <= 0) return <span className="truncate">{text}</span>;
  const ratio = used / row.bundleBytes;
  const tone: Tone = ratio >= 0.9 ? 'sev' : ratio >= 0.75 ? 'warn' : 'ok';
  return (
    <span className="home-usage">
      <Meter ratio={ratio} tone={tone} />
      <span className="truncate">{board.quotaOf(text, formatBytesMeasured(row.bundleBytes))}</span>
    </span>
  );
}

function ProbeCell({ row }: { row: HomeLineDto }) {
  const probe = shownMeasured(row.probe);
  if (probe.value === null) return <Value value={null} source={probe.source} mono />;
  return (
    <span className="truncate" title={probe.value.status ?? undefined}>
      {words.probeAlive(probe.value.alive, probe.value.total)}
    </span>
  );
}
