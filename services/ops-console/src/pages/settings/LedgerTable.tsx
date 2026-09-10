import { useMemo, useState } from 'react';
import { Action } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { refusalCode } from '@/lib/api-customer-actions';
import { MONTH_CLOSED, ledgerApi, type LedgerEntryDto } from '@/lib/api-ledger';
import { formatDate } from '@/lib/display';
import { entryWords, formatAmount, formatCny, formatRate, monthWords, sortedEntries } from '@/lib/ledger';
import { TextField } from './form';
import { useWrite } from './use-write';

const words = copy.ledger;

/**
 * The month's entries, one row per thing that was paid or taken.
 *
 * Two of the eight columns are the same money twice — what was actually paid,
 * and what it came to in yuan — because those are the two numbers an operator
 * reconciles: the first against the invoice, the second against the month's
 * total. The conversion carries the day and the rate it used in its hover, so
 * a figure that looks wrong can be checked rather than argued with.
 *
 * Nothing here is ever deleted or corrected in place. An entry that was wrong
 * is reversed — a second entry, in the month the reversal is made, with the
 * original left standing and marked — because a ledger you can edit is a
 * ledger nobody can reconcile a bank statement against.
 */
export function LedgerTable({
  rows,
  state,
  message,
  locked,
  currentMonth,
  currentLocked,
  nameOf,
  onChanged,
}: {
  rows: readonly LedgerEntryDto[];
  state: TableState;
  message?: string;
  /** A closed month takes no edits at all; only a reversal may still be added. */
  locked: boolean;
  /** Where a reversal lands — today's month, whichever month is on screen. */
  currentMonth: string;
  /**
   * Whether that month is locked, when the page can tell — it can only tell
   * while it is looking at it. Reversing into a month that was locked out from
   * under the page is refused by the hub, and the refusal has its own sentence.
   */
  currentLocked: boolean;
  nameOf: (row: LedgerEntryDto) => string;
  onChanged: () => void;
}) {
  const write = useWrite(onChanged);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<LedgerEntryDto | null>(null);
  const [note, setNote] = useState('');
  const [reversing, setReversing] = useState<LedgerEntryDto | null>(null);

  const sorted = useMemo(() => sortedEntries(rows), [rows]);
  const here = useMemo(() => new Set(sorted.map((row) => row.id)), [sorted]);
  const columns = useMemo(() => entryColumns({
    nameOf,
    locked,
    currentLocked,
    inMonth: (id) => here.has(id),
    onJump: setSelected,
    onEditNote: (row) => {
      setNote(row.note ?? '');
      setEditing(row);
    },
    onReverse: setReversing,
  }), [nameOf, locked, currentLocked, here]);

  return (
    <div className="flex flex-col gap-3">
      {write.error ? (
        <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
      ) : null}
      <DataTable
        rows={sorted}
        columns={columns}
        getRowId={(row) => row.id}
        selectedId={selected}
        state={state}
        emptyMessage={words.empty}
        errorMessage={message}
      />

      <ConfirmDialog
        open={editing !== null}
        title={words.editNoteTitle}
        consequence={words.editNoteBody}
        confirm={copy.settings.save}
        pending={write.pending}
        failure={write.error}
        onCancel={() => setEditing(null)}
        onConfirm={() => {
          const row = editing;
          if (!row) return;
          void write.run(() => ledgerApi.editNote(row.id, note.trim())).then((ok) => {
            if (ok) setEditing(null);
          });
        }}
      >
        <TextField label={words.fieldNote} value={note} onChange={setNote} />
      </ConfirmDialog>

      <ConfirmDialog
        open={reversing !== null}
        title={words.reverseTitle}
        consequence={reversing
          ? words.reverseBody(entryWords(reversing), monthWords(currentMonth))
          : ''}
        confirm={words.reverseConfirm}
        pending={write.pending}
        failure={write.error}
        onCancel={() => setReversing(null)}
        onConfirm={() => {
          const row = reversing;
          if (!row) return;
          void write.run(() => ledgerApi.reverse(row.id).catch((error: unknown) => {
            // The month the reversal lands in is not the month on screen, so
            // this refusal has to say which month it is about.
            if (refusalCode(error) === MONTH_CLOSED) throw new Error(words.reverseRefused);
            throw error;
          })).then((ok) => {
            if (ok) setReversing(null);
          });
        }}
      />
    </div>
  );
}

type Hooks = {
  nameOf: (row: LedgerEntryDto) => string;
  locked: boolean;
  currentLocked: boolean;
  inMonth: (id: string) => boolean;
  onJump: (id: string) => void;
  onEditNote: (row: LedgerEntryDto) => void;
  onReverse: (row: LedgerEntryDto) => void;
};

function entryColumns(hooks: Hooks): DataColumn<LedgerEntryDto>[] {
  return [
    {
      id: 'day',
      header: words.columns.day,
      width: '104px',
      mono: true,
      sortValue: (row) => row.paidAt ?? row.createdAt,
      cell: (row) => (
        <Value
          value={row.paidAt === null ? null : formatDate(row.paidAt)}
          source={words.source}
          mono
        />
      ),
    },
    {
      id: 'kind',
      header: words.columns.kind,
      width: '84px',
      sortValue: (row) => row.kind,
      cell: (row) => <KindCell row={row} hooks={hooks} />,
    },
    {
      id: 'category',
      header: words.columns.category,
      width: '92px',
      sortValue: (row) => row.category,
      cell: (row) => <span className="truncate">{words.category[row.category]}</span>,
    },
    {
      id: 'subject',
      header: words.columns.subject,
      sortValue: (row) => hooks.nameOf(row),
      cell: (row) => (
        <span className="truncate" title={hooks.nameOf(row)}>{hooks.nameOf(row)}</span>
      ),
    },
    {
      id: 'amount',
      header: words.columns.amount,
      width: '108px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.amountMinor,
      cell: (row) => (
        <Value value={formatAmount(row.amountMinor, row.currency)} source={words.source} mono />
      ),
    },
    {
      id: 'cny',
      header: words.columns.cny,
      width: '104px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.cnyMinor,
      cell: (row) => <CnyCell row={row} />,
    },
    {
      id: 'note',
      header: words.columns.note,
      width: '120px',
      sortValue: (row) => row.note ?? '',
      cell: (row) => (
        <span className="truncate" title={row.note ?? undefined}>{row.note ?? copy.missing}</span>
      ),
    },
    {
      id: 'action',
      header: words.columns.action,
      width: '146px',
      align: 'right',
      cell: (row) => <ActionCell row={row} hooks={hooks} />,
    },
  ];
}

/**
 * The kind, and — on an entry that has been reversed or is itself a reversal —
 * the way to the other half of the pair. The link only appears when the other
 * half is in the month on screen: a reversal made in September against an
 * August entry is a real pair, and pretending it is one click away would take
 * the operator to a row that is not there.
 */
function KindCell({ row, hooks }: { row: LedgerEntryDto; hooks: Hooks }) {
  const partner = row.reversedBy ?? row.reverses;
  const label = row.reversedBy === null ? words.reverses : words.reversed;
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="truncate">{words.kind[row.kind]}</span>
      {partner === null ? null : hooks.inMonth(partner) ? (
        <button
          type="button"
          className="truncate text-left text-[11px] leading-tight text-[var(--muted-foreground)] underline decoration-[var(--hairline)] underline-offset-4"
          onClick={() => hooks.onJump(partner)}
        >
          {label}
        </button>
      ) : (
        <span className="truncate text-[11px] leading-tight text-[var(--muted-foreground)]">
          {label}
        </span>
      )}
    </span>
  );
}

/** The yuan figure, with the day and the rate that produced it on hover. */
function CnyCell({ row }: { row: LedgerEntryDto }) {
  const converted = row.currency.toUpperCase() !== 'CNY' && row.fxDate !== null;
  const title = converted
    ? words.fxLine(row.fxDate ?? '', formatRate(row.fxRateToCny), formatCny(row.cnyMinor) ?? '')
    : undefined;
  return (
    <span className="truncate" title={title}>
      <Value value={formatCny(row.cnyMinor)} source={words.source} mono />
    </span>
  );
}

/**
 * The two things that can still be done to a written entry, and the reason
 * whichever of them cannot.
 *
 * They are stopped by different months. The note edit is refused by the month
 * the entry is in — the one on screen. A reversal writes a new entry into the
 * current month, so it is refused by that one, which on a past month's page is
 * not the month being looked at at all.
 */
function ActionCell({ row, hooks }: { row: LedgerEntryDto; hooks: Hooks }) {
  const reversed = row.reversedBy !== null;
  const noReverse = reversed ? words.reversed : hooks.currentLocked ? words.reverseLocked : null;
  return (
    <span className="flex items-center justify-end gap-1.5">
      <Action
        reason={hooks.locked ? words.lockedNote : null}
        onClick={() => hooks.onEditNote(row)}
      >
        {words.editNote}
      </Action>
      <Action reason={noReverse} onClick={() => hooks.onReverse(row)}>
        {words.reverse}
      </Action>
    </span>
  );
}
