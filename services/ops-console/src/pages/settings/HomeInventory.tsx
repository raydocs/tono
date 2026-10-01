import { useCallback, useMemo, useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { DataTable, type DataColumn } from '@/components/ops/DataTable';
import { Panel, type PanelState } from '@/components/ops/Panel';
import { Meter } from '@/components/ops/Meter';
import { Segmented } from '@/components/ops/Segmented';
import type { Tone } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { usePrivacy } from '@/lib/privacy';
import { EXIT_STATES, exitState, type ExitState } from '@/lib/residential';
import { hubApi, type HomeExit } from '@/lib/settings-legacy';
import { useResource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';
import '@/styles/residential.css';
import '@/styles/settings-assets.css';
import { HomeExitDrawer } from './HomeExitDrawer';
import { ImportDialog } from './ImportDialog';
import { InventoryBand } from './home/InventoryBand';
import { useWrite } from './use-write';

const words = copy.settings.homeinventory;
const board = copy.residential.inventory;
/** The prober runs every few minutes; half an hour without a round is late. */
const STALE_AFTER_SEC = 30 * 60;
/** What needs a hand first: a line nobody can reach, then one nobody is using. */
const RANK: Record<ExitState, number> = { dead: 0, idle: 1, bound: 2, off: 3 };
type Filter = ExitState | 'all';

/**
 * The residential lines themselves: what is in stock and whether it can be
 * handed to a customer.
 *
 * Deliberately not the same table as the home-line assets section. That one
 * edits the bill — what the line costs, when it renews, how much of the
 * allowance is gone — and it writes to a different endpoint that has no
 * credentials and no bindings. This
 * one is the line as a routable thing: its address, whether the prober can
 * reach it, how many customers it is carrying, and whether it exists at all.
 * Merging the two would put a delete that unroutes three customers next to a
 * field for the monthly price.
 *
 * The socks5 password is write-only end to end: no read here returns it, this
 * page never holds a copy after the form closes, and changing one means typing
 * it again. That is the hub's rule, not a choice made here.
 */
export function HomeInventory() {
  const privacy = usePrivacy();
  const exits = useResource('home-exits', (signal) => hubApi.homeExits(signal));
  const bindings = useResource('home-bindings', (signal) => hubApi.homeBindings(signal));
  const reload = useCallback(() => {
    exits.reload();
    bindings.reload();
  }, [exits, bindings]);
  const write = useWrite(reload);

  const [registering, setRegistering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<HomeExit | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => (exits.status === 'ready' ? exits.data : []), [exits]);

  /**
   * How many customers each line is carrying, counted from the bindings rather
   * than trusted from the row: `bindCount` is a subquery on the same read, and
   * the bindings list is the table the customer pages act on, so when the two
   * disagree the one an operator can go and look at is the honest number.
   */
  const { bound, who } = useMemo(() => {
    const counts = new Map<string, number>();
    const emails = new Map<string, string[]>();
    if (bindings.status !== 'ready') return { bound: counts, who: emails };
    for (const row of bindings.data) {
      counts.set(row.homeExitId, (counts.get(row.homeExitId) ?? 0) + 1);
      if (row.email) emails.set(row.homeExitId, [...(emails.get(row.homeExitId) ?? []), row.email]);
    }
    return { bound: counts, who: emails };
  }, [bindings]);
  const carrying = useCallback((row: HomeExit) => bound.get(row.id) ?? row.bindCount ?? 0, [bound]);
  const stateOf = useCallback((row: HomeExit) => exitState(row, carrying(row)), [carrying]);
  const counts = useMemo(() => {
    const out: Record<ExitState, number> = { bound: 0, idle: 0, dead: 0, off: 0 };
    for (const row of rows) out[stateOf(row)] += 1;
    return out;
  }, [rows, stateOf]);
  const shown = useMemo(
    () => rows
      .filter((row) => filter === 'all' || stateOf(row) === filter)
      .sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)] || a.displayName.localeCompare(b.displayName)),
    [rows, filter, stateOf],
  );
  const probedAt = rows.reduce<number | null>((top, row) => (
    row.lastProbedAt === null ? top : Math.max(top ?? 0, row.lastProbedAt)
  ), null);

  const columns = useMemo(
    () => inventoryColumns({
      ip: privacy.ip,
      email: privacy.email,
      boundOf: (row) => bound.get(row.id) ?? row.bindCount,
      whoOf: (row) => who.get(row.id) ?? [],
      stateOf,
      onToggle: (row) => {
        void write.run(() => hubApi.setHomeExitStatus(
          row.id,
          row.status === 'active' ? 'disabled' : 'active',
        ));
      },
      onRemove: (row) => setRemoving(row),
      pending: write.pending,
    }),
    [privacy.ip, privacy.email, bound, who, stateOf, write],
  );

  const state: PanelState = exits.status === 'loading'
    ? 'loading'
    : exits.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  const removingBound = removing === null ? 0 : bound.get(removing.id) ?? removing.bindCount ?? 0;

  return (
    <div className="settings-homeinventory home-board">
      <InventoryBand rows={exits.status === 'ready' ? rows : null} stateOf={stateOf} boundOf={carrying} />

      {write.error ? (
        <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
      ) : null}

      <Panel
        title={board.table}
        description={board.tableLead}
        actions={(
          <>
            <Action onClick={() => setImporting(true)}>{words.importLines}</Action>
            <Action primary onClick={() => setRegistering(true)}>{words.register}</Action>
          </>
        )}
        source={board.source}
        asOfSec={probedAt}
        staleAfterSec={STALE_AFTER_SEC}
        state={state}
        emptyText={words.empty}
        onRetry={reload}
        bodyHeight={160}
      >
        <Segmented
          label={board.filterLabel}
          value={filter}
          options={[
            { value: 'all', label: board.all, count: rows.length },
            ...EXIT_STATES.filter((key) => counts[key] > 0).map((key) => ({
              value: key,
              label: board.state[key],
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
          state={shown.length === 0 ? 'empty' : 'ready'}
          emptyMessage={board.noMatch}
          className="settings-inventory-table"
        />
      </Panel>

      <HomeExitDrawer open={registering} onClose={() => setRegistering(false)} onSaved={reload} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onSaved={reload} />

      <ConfirmDialog
        open={removing !== null}
        title={words.removeTitle}
        consequence={removing ? words.removeBody(removing.displayName) : ''}
        confirm={words.remove}
        pending={write.pending}
        failure={removingBound > 0 ? words.boundBlocks(removingBound) : write.error}
        onConfirm={() => {
          const row = removing;
          if (!row) return;
          void write.run(() => hubApi.deleteHomeExit(row.id)).then((done) => {
            if (done) setRemoving(null);
          });
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

const STATE_TONE: Record<ExitState, Tone> = { dead: 'sev', idle: 'warn', bound: 'ok', off: 'unk' };

function inventoryColumns({
  ip,
  email,
  boundOf,
  whoOf,
  stateOf,
  onToggle,
  onRemove,
  pending,
}: {
  ip: (value: string | null) => string;
  email: (value: string) => string;
  boundOf: (row: HomeExit) => number | null;
  whoOf: (row: HomeExit) => readonly string[];
  stateOf: (row: HomeExit) => ExitState;
  onToggle: (row: HomeExit) => void;
  onRemove: (row: HomeExit) => void;
  pending: boolean;
}): DataColumn<HomeExit>[] {
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
      id: 'address',
      header: words.columns.address,
      width: '196px',
      sortValue: (row) => row.socks5Host ?? row.egressIpv4 ?? '',
      cell: (row) => <AddressCell row={row} ip={ip} />,
    },
    {
      id: 'status',
      header: words.columns.status,
      width: '84px',
      sortValue: (row) => RANK[stateOf(row)],
      cell: (row) => <StateCell state={stateOf(row)} status={row.status} />,
    },
    {
      id: 'probe',
      header: words.columns.probe,
      width: '132px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.probeTotal,
      cell: (row) => <ProbeCell row={row} />,
    },
    {
      id: 'bound',
      header: words.columns.bound,
      width: '188px',
      align: 'right',
      sortValue: (row) => boundOf(row),
      cell: (row) => <BoundCell count={boundOf(row)} who={whoOf(row).map(email)} />,
    },
    {
      id: 'action',
      header: words.columns.action,
      width: '148px',
      align: 'right',
      cell: (row) => {
        const carrying = boundOf(row) ?? 0;
        return (
          <ActionRow className="justify-end">
            <Action pending={pending} onClick={() => onToggle(row)}>
              {row.status === 'active' ? words.disable : words.enable}
            </Action>
            <Action
              reason={carrying > 0 ? words.boundBlocks(carrying) : null}
              onClick={() => onRemove(row)}
            >
              {words.remove}
            </Action>
          </ActionRow>
        );
      },
    },
  ];
}

/** A line's status word; anything the hub invents falls through as itself. */
function statusWord(status: string): string {
  const known = words.status as Record<string, string | undefined>;
  return known[status] ?? status;
}

/** The derived state with its dot; the hub's own word stays in the tooltip. */
function StateCell({ state, status }: { state: ExitState; status: string }) {
  const tone = STATE_TONE[state];
  return (
    <span className="home-state" title={statusWord(status)}>
      <span aria-hidden className={cn('stat-dot', `tone-${tone}`)} />
      <span className={cn((tone === 'sev' || tone === 'warn') && `tone-${tone} tone-fg`)}>{board.state[state]}</span>
    </span>
  );
}

function AddressCell({ row, ip }: { row: HomeExit; ip: (value: string | null) => string }) {
  const host = row.socks5Host ?? row.egressIpv4;
  if (host === null) return <Value value={null} source={copy.sourceWord.manual} mono />;
  const kind = words.kind as Record<string, string | undefined>;
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="truncate font-mono">{ip(host)}{row.socks5Port === null ? '' : portWord(row.socks5Port)}</span>
      <span className="truncate text-[11px] leading-tight text-[var(--muted-foreground)]">
        {kind[row.kind] ?? row.kind}
      </span>
    </span>
  );
}

/** The port hangs off the host as one token; it is an address, not a number. */
function portWord(port: number): string {
  return `:${String(port)}`;
}

/** A line nobody has probed says so, rather than reading as a line at 0/0. */
function ProbeCell({ row }: { row: HomeExit }) {
  if (row.probeAlive === null || row.probeTotal === null) {
    return <Value value={null} source={copy.sourceWord.collector} mono />;
  }
  const ratio = row.probeTotal > 0 ? row.probeAlive / row.probeTotal : null;
  const tone: Tone | null = ratio === null ? null : ratio === 0 ? 'sev' : ratio < 0.9 ? 'warn' : 'ok';
  return (
    <span className="home-probe" title={row.probeStatus ?? undefined}>
      <Meter ratio={ratio} tone={tone} />
      <span className="truncate">{words.probeAlive(row.probeAlive, row.probeTotal)}</span>
    </span>
  );
}

function BoundCell({ count, who }: { count: number | null; who: readonly string[] }) {
  if (count === null) return <Value value={null} source={copy.sourceWord.engine} mono />;
  if (count === 0) return <span className="text-[var(--muted-foreground)]">{words.idle}</span>;
  const first = who[0];
  if (first === undefined) return <span className="font-mono">{words.boundUnit(count)}</span>;
  const text = who.length === 1 && count === 1 ? first : board.whoMore(first, count - 1);
  return (
    <span className="flex min-w-0 flex-col items-end leading-tight" title={who.join('\n')}>
      <span className="font-mono">{words.boundUnit(count)}</span>
      <span className="max-w-full truncate text-[11px] text-[var(--muted-foreground)]">{text}</span>
    </span>
  );
}
