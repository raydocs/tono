import { useCallback, useMemo, useState } from 'react';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { usePrivacy } from '@/lib/privacy';
import { hubApi, type HomeExit } from '@/lib/settings-legacy';
import { useResource } from '@/lib/use-resource';
import { HomeExitDrawer } from './HomeExitDrawer';
import { ImportDialog } from './ImportDialog';
import { Toolbar } from './form';
import { useWrite } from './use-write';

const words = copy.settings.homeinventory;

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

  const rows = exits.status === 'ready' ? exits.data : [];

  /**
   * How many customers each line is carrying, counted from the bindings rather
   * than trusted from the row: `bindCount` is a subquery on the same read, and
   * the bindings list is the table the customer pages act on, so when the two
   * disagree the one an operator can go and look at is the honest number.
   */
  const bound = useMemo(() => {
    const counts = new Map<string, number>();
    if (bindings.status !== 'ready') return counts;
    for (const row of bindings.data) {
      counts.set(row.homeExitId, (counts.get(row.homeExitId) ?? 0) + 1);
    }
    return counts;
  }, [bindings]);

  const columns = useMemo(
    () => inventoryColumns({
      ip: privacy.ip,
      boundOf: (row) => bound.get(row.id) ?? row.bindCount,
      onToggle: (row) => {
        void write.run(() => hubApi.setHomeExitStatus(
          row.id,
          row.status === 'active' ? 'disabled' : 'active',
        ));
      },
      onRemove: (row) => setRemoving(row),
      pending: write.pending,
    }),
    [privacy.ip, bound, write],
  );

  const state: TableState = exits.status === 'loading'
    ? 'loading'
    : exits.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  const removingBound = removing === null ? 0 : bound.get(removing.id) ?? removing.bindCount ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Toolbar
          aside={(
            <>
              <Action onClick={() => setImporting(true)}>{words.importLines}</Action>
              <Action primary onClick={() => setRegistering(true)}>{words.register}</Action>
            </>
          )}
        >
          {exits.status === 'ready' ? <span>{words.count(rows.length)}</span> : null}
        </Toolbar>

        {write.error ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
        ) : null}

        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          state={state}
          emptyMessage={words.empty}
          errorMessage={exits.status === 'error' ? exits.message : undefined}
        />
      </div>

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

function inventoryColumns({
  ip,
  boundOf,
  onToggle,
  onRemove,
  pending,
}: {
  ip: (value: string | null) => string;
  boundOf: (row: HomeExit) => number | null;
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
      width: '176px',
      sortValue: (row) => row.socks5Host ?? row.egressIpv4 ?? '',
      cell: (row) => <AddressCell row={row} ip={ip} />,
    },
    {
      id: 'status',
      header: words.columns.status,
      width: '72px',
      sortValue: (row) => row.status,
      cell: (row) => <span className="ops-tag">{statusWord(row.status)}</span>,
    },
    {
      id: 'probe',
      header: words.columns.probe,
      width: '96px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.probeTotal,
      cell: (row) => <ProbeCell row={row} />,
    },
    {
      id: 'bound',
      header: words.columns.bound,
      width: '112px',
      align: 'right',
      mono: true,
      sortValue: (row) => boundOf(row),
      cell: (row) => <BoundCell count={boundOf(row)} />,
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
  return <span className="truncate">{words.probeAlive(row.probeAlive, row.probeTotal)}</span>;
}

function BoundCell({ count }: { count: number | null }) {
  if (count === null) return <Value value={null} source={copy.sourceWord.engine} mono />;
  if (count === 0) return <span className="text-[var(--muted-foreground)]">{words.idle}</span>;
  return <span>{words.boundUnit(count)}</span>;
}
