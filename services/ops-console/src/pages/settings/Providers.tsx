import { useEffect, useMemo, useState } from 'react';
import type { ProviderAccountDto } from '@contract';
import { CLOUD_KINDS } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { DetailDrawer } from '@/components/ops/DetailDrawer';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { settingsApi, type ProviderAccountInput } from '@/lib/api-settings';
import { formatCount } from '@/lib/display';
import { useResource } from '@/lib/use-resource';
import { ConfirmDialog, FieldGrid, FormFooter, SelectField, TextField, Toolbar } from './form';
import { useWrite } from './use-write';

const words = copy.settings.providers;

/**
 * The email box holds text, not a nullable address, because what it shows on
 * an existing account is the mask the database already stores. Sending an
 * untouched mask back would ask the Worker to mask a mask, so the save below
 * only includes the field when the text has actually changed.
 */
type ProviderForm = Omit<ProviderAccountInput, 'loginEmail'> & { loginEmail: string };

const BLANK: ProviderForm = {
  provider: '',
  label: '',
  cloudKind: 'vps',
  loginEmail: '',
  billingUrl: null,
  balanceHint: null,
  renewNotes: null,
  secretRef: null,
};

function orNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * Vendor accounts: who the bill goes to.
 *
 * The login address is stored already masked and the credential is a name
 * rather than a secret, so this table is safe to leave open on a second
 * monitor: it can tell you which account a node is on, and it cannot tell
 * anyone how to log into it.
 */
export function Providers() {
  const accounts = useResource('provider-accounts', (signal) => settingsApi.providerAccounts(signal));
  const [editing, setEditing] = useState<ProviderAccountDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<ProviderAccountDto | null>(null);
  const write = useWrite(accounts.reload);

  const rows = accounts.status === 'ready' ? accounts.data.items : [];
  const columns = useMemo(() => providerColumns(), []);
  const state: TableState = accounts.status === 'loading'
    ? 'loading'
    : accounts.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Toolbar aside={<Action primary onClick={() => setEditing('new')}>{words.newAccount}</Action>}>
          {accounts.status === 'ready' ? <span>{words.count(rows.length)}</span> : null}
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
          errorMessage={accounts.status === 'error' ? accounts.message : undefined}
        />
      </div>

      <ProviderDrawer
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={accounts.reload}
        onRemove={(row) => { setEditing(null); setRemoving(row); }}
      />

      <ConfirmDialog
        open={removing !== null}
        title={words.deleteTitle}
        body={removing ? words.deleteBody(removing.label) : ''}
        confirm={copy.settings.remove}
        pending={write.pending}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const row = removing;
          if (!row) return;
          void write.run(() => settingsApi.deleteProviderAccount(row.id)).then(() => setRemoving(null));
        }}
      />
    </div>
  );
}

function providerColumns(): DataColumn<ProviderAccountDto>[] {
  return [
    {
      id: 'provider',
      header: words.columns.provider,
      width: '132px',
      sortValue: (row) => row.provider,
      cell: (row) => <span className="truncate text-row">{row.provider}</span>,
    },
    {
      id: 'label',
      header: words.columns.label,
      sortValue: (row) => row.label,
      cell: (row) => <span className="truncate">{row.label}</span>,
    },
    {
      id: 'kind',
      header: words.columns.cloudKind,
      width: '96px',
      sortValue: (row) => row.cloudKind,
      cell: (row) => <span className="ops-tag">{words.cloudKind[row.cloudKind]}</span>,
    },
    {
      id: 'email',
      header: words.columns.loginEmail,
      width: '168px',
      sortValue: (row) => row.loginEmailMasked ?? '',
      cell: (row) => <Value value={row.loginEmailMasked} source={copy.sourceWord.manual} mono />,
    },
    {
      id: 'billing',
      header: words.columns.billingUrl,
      width: '92px',
      cell: (row) => (row.billingUrl === null
        ? <Value value={null} source={copy.sourceWord.manual} />
        : (
          <a
            href={row.billingUrl}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="text-[var(--accent)]">{copy.settings.openLink}</span>
          </a>
        )),
    },
    {
      id: 'nodes',
      header: words.columns.nodeCount,
      width: '76px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.nodeCount,
      cell: (row) => formatCount(row.nodeCount),
    },
  ];
}

function ProviderDrawer({
  account,
  onClose,
  onSaved,
  onRemove,
}: {
  account: ProviderAccountDto | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
  onRemove: (account: ProviderAccountDto) => void;
}) {
  const existing = account === null || account === 'new' ? null : account;
  const [form, setForm] = useState<ProviderForm>(BLANK);
  const write = useWrite(onSaved);
  const seed = existing?.loginEmailMasked ?? '';
  const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (account === null) return;
    setForm(account === 'new' ? BLANK : {
      provider: account.provider,
      label: account.label,
      cloudKind: account.cloudKind,
      loginEmail: account.loginEmailMasked ?? '',
      billingUrl: account.billingUrl,
      balanceHint: account.balanceHint,
      renewNotes: account.renewNotes,
      secretRef: account.secretRef,
    });
  }, [account]);

  async function save() {
    if (form.provider.trim() === '' || form.label.trim() === '') {
      write.setError(copy.settings.required);
      return;
    }
    const { loginEmail, ...rest } = form;
    const ok = await write.run(() => (
      existing
        ? settingsApi.updateProviderAccount(
          existing.id,
          loginEmail === seed ? rest : { ...rest, loginEmail: orNull(loginEmail) },
        )
        : settingsApi.createProviderAccount({ ...rest, loginEmail: orNull(loginEmail) })
    ));
    if (ok) onClose();
  }

  return (
    <DetailDrawer
      open={account !== null}
      title={existing ? words.editAccount : words.newAccount}
      onClose={onClose}
    >
      <FieldGrid>
        <TextField
          label={words.fields.provider}
          value={form.provider}
          onChange={(value) => set('provider', value)}
        />
        <TextField
          label={words.fields.label}
          hint={words.hints.label}
          value={form.label}
          onChange={(value) => set('label', value)}
        />
        <SelectField
          label={words.fields.cloudKind}
          value={form.cloudKind}
          options={CLOUD_KINDS}
          word={(option) => words.cloudKind[option]}
          onChange={(value) => set('cloudKind', value)}
        />
        <TextField
          label={words.fields.loginEmail}
          hint={words.hints.loginEmail}
          value={form.loginEmail}
          mono
          onChange={(value) => set('loginEmail', value)}
        />
        <TextField
          label={words.fields.billingUrl}
          hint={words.hints.billingUrl}
          type="url"
          value={form.billingUrl ?? ''}
          mono
          onChange={(value) => set('billingUrl', orNull(value))}
        />
        <TextField
          label={words.fields.balanceHint}
          value={form.balanceHint ?? ''}
          onChange={(value) => set('balanceHint', orNull(value))}
        />
        <TextField
          label={words.fields.renewNotes}
          value={form.renewNotes ?? ''}
          onChange={(value) => set('renewNotes', orNull(value))}
        />
        <TextField
          label={words.fields.secretRef}
          hint={words.hints.secretRef}
          value={form.secretRef ?? ''}
          mono
          onChange={(value) => set('secretRef', orNull(value))}
        />
      </FieldGrid>

      <FormFooter
        pending={write.pending}
        error={write.error}
        onSave={() => { void save(); }}
        onCancel={onClose}
        onRemove={existing ? () => onRemove(existing) : undefined}
      />
    </DetailDrawer>
  );
}
