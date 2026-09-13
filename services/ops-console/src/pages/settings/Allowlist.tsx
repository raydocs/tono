import { useState } from 'react';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { allowlistApi, isEmailAddress, type AllowedEmail } from '@/lib/allowlist-legacy';
import { formatDate } from '@/lib/display';
import { usePrivacy } from '@/lib/privacy';
import { useResource } from '@/lib/use-resource';
import { ConfirmDialog, TextField, Toolbar } from './form';
import { useWrite } from './use-write';

const words = copy.settings.allowlist;

/**
 * The signup allowlist: who may open an account without being onboarded.
 *
 * The list is not the main way addresses get on it — opening a customer
 * writes one in — so the note above the table says so, and this section is
 * for the handful an operator adds ahead of time and the ones they take off
 * again. Behind that plainness it is the gate on self-service signup, which
 * is why the delete asks first and the add refuses anything that is not an
 * address rather than letting the hub answer with a 400.
 *
 * The addresses are real customer emails, so they mask with the rest of the
 * console when the privacy switch is on: the masked page is the one that is
 * safe to leave open on a second monitor.
 */
export function Allowlist() {
  const privacy = usePrivacy();
  const entries = useResource('signup-allowlist', (signal) => allowlistApi.entries(signal));
  const [typed, setTyped] = useState('');
  const [removing, setRemoving] = useState<AllowedEmail | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const write = useWrite(entries.reload);

  const rows = entries.status === 'ready' ? entries.data : [];
  const state: TableState = entries.status === 'loading'
    ? 'loading'
    : entries.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  async function add() {
    if (!isEmailAddress(typed)) {
      setSaid(null);
      write.setError(words.invalid);
      return;
    }
    const address = typed.trim();
    setSaid(null);
    const ok = await write.run(async () => {
      const answer = await allowlistApi.add(address);
      setSaid(answer.created ? words.added(answer.email) : words.already(answer.email));
    });
    if (ok) setTyped('');
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Toolbar>
          {entries.status === 'ready' ? <span>{words.count(rows.length)}</span> : null}
          <span>{words.note}</span>
        </Toolbar>

        {/* A form, so the address can be typed and entered without reaching
            for the mouse — adding several before a launch is the one thing
            this section is used for in bulk. */}
        <form
          className="flex flex-col gap-1"
          onSubmit={(event) => { event.preventDefault(); void add(); }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 sm:max-w-[320px]">
              {/* The help sits under the row rather than under the box, so the
                  box and the button share one bottom edge. */}
              <TextField label={words.field} value={typed} mono onChange={setTyped} />
            </div>
            <Action primary pending={write.pending} onClick={() => { void add(); }}>
              {words.add}
            </Action>
          </div>
          <span className="text-micro text-[var(--muted-foreground)]">{words.fieldHint}</span>
        </form>

        {write.error ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
        ) : null}
        {said ? (
          <p className="text-body text-[var(--muted-foreground)]" role="status">{said}</p>
        ) : null}

        <DataTable
          rows={rows}
          columns={columns(privacy.email, (row) => setRemoving(row))}
          getRowId={(row) => row.email}
          state={state}
          emptyMessage={words.empty}
          errorMessage={entries.status === 'error' ? entries.message : undefined}
        />
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={words.deleteTitle}
        body={removing ? words.deleteBody(privacy.email(removing.email)) : ''}
        confirm={copy.settings.remove}
        pending={write.pending}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const row = removing;
          if (!row) return;
          setSaid(null);
          void write.run(() => allowlistApi.remove(row.email)).then(() => setRemoving(null));
        }}
      />
    </div>
  );
}

function columns(
  mask: (value: string) => string,
  remove: (row: AllowedEmail) => void,
): DataColumn<AllowedEmail>[] {
  return [
    {
      id: 'email',
      header: words.columns.email,
      sortValue: (row) => row.email,
      cell: (row) => <span className="truncate font-mono text-row">{mask(row.email)}</span>,
    },
    {
      id: 'createdAt',
      header: words.columns.createdAt,
      width: '132px',
      mono: true,
      sortValue: (row) => row.createdAt,
      cell: (row) => <Value value={formatDate(row.createdAt)} source={copy.sourceWord.manual} mono />,
    },
    {
      id: 'action',
      header: words.columns.action,
      width: '84px',
      align: 'right',
      cell: (row) => (
        <Action onClick={() => remove(row)}>{copy.settings.remove}</Action>
      ),
    },
  ];
}
