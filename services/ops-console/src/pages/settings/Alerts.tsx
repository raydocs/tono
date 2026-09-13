import { useMemo, useState } from 'react';
import type { AlertRuleDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { settingsApi } from '@/lib/api-settings';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { deliveryLine, durationWord, recentDeliveries } from '@/lib/settings';
import { useResource } from '@/lib/use-resource';
import { AlertRuleDrawer } from './AlertRuleDrawer';
import { ConfirmDialog } from './form';
import { useWrite } from './use-write';

const words = copy.settings.alerts;

/**
 * Alert rules: what is allowed to wake the operator up.
 *
 * The table answers the question an operator actually arrives with, which is
 * never "what rules exist" but "why did / didn't this page me": the delay and
 * the cooldown are columns rather than drawer fields for exactly that reason,
 * and the deliveries block underneath is the receipt.
 */
export function Alerts() {
  const rules = useResource('alert-rules', (signal) => settingsApi.alertRules(signal));
  const deliveries = useResource('alert-deliveries', (signal) => settingsApi.alertDeliveries(signal));
  const [editing, setEditing] = useState<AlertRuleDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<AlertRuleDto | null>(null);
  const [tested, setTested] = useState<string | null>(null);

  const reload = () => {
    rules.reload();
    deliveries.reload();
  };
  const write = useWrite(reload);

  const rows = rules.status === 'ready' ? rules.data.items : [];
  const columns = useMemo(
    () => ruleColumns((row) => {
      setTested(row.id);
      void write.run(() => settingsApi.testAlertRule(row.id));
    }),
    [write],
  );
  const state: TableState = rules.status === 'loading'
    ? 'loading'
    : rules.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex flex-col gap-8">
      <Section
        title={words.rules}
        aside={(
          <>
            {rules.status === 'ready' ? (
              <span className="text-micro text-[var(--muted-foreground)]">
                {words.ruleCount(rows.length)}
              </span>
            ) : null}
            <Action primary onClick={() => setEditing('new')}>{words.newRule}</Action>
          </>
        )}
      >
        {write.error ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
        ) : null}
        {tested && !write.error && !write.pending ? (
          <p className="text-micro text-[var(--muted-foreground)]" role="status">{words.tested}</p>
        ) : null}
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          onRowClick={(row) => setEditing(row)}
          state={state}
          emptyMessage={words.empty}
          errorMessage={rules.status === 'error' ? rules.message : undefined}
        />
      </Section>

      <Section title={words.deliveries}>
        <Deliveries
          rows={deliveries.status === 'ready' ? recentDeliveries(deliveries.data.items) : []}
          state={deliveries.status}
        />
      </Section>

      <AlertRuleDrawer
        rule={editing}
        onClose={() => setEditing(null)}
        onSaved={reload}
        onRemove={(row) => { setEditing(null); setRemoving(row); }}
      />

      <ConfirmDialog
        open={removing !== null}
        title={words.deleteTitle}
        body={removing ? words.deleteBody(removing.name) : ''}
        confirm={copy.settings.remove}
        pending={write.pending}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const row = removing;
          if (!row) return;
          void write.run(() => settingsApi.deleteAlertRule(row.id)).then(() => setRemoving(null));
        }}
      />
    </div>
  );
}

function ruleColumns(onTest: (row: AlertRuleDto) => void): DataColumn<AlertRuleDto>[] {
  return [
    {
      id: 'name',
      header: words.columns.name,
      sortValue: (row) => row.name,
      cell: (row) => <span className="min-w-0 truncate text-row">{row.name}</span>,
    },
    {
      id: 'enabled',
      header: words.columns.enabled,
      width: '52px',
      sortValue: (row) => (row.enabled ? 1 : 0),
      cell: (row) => (
        <span className={row.enabled ? undefined : 'text-[var(--muted-foreground)]'}>
          {row.enabled ? words.on : words.off}
        </span>
      ),
    },
    {
      id: 'severity',
      header: words.columns.minSeverity,
      width: '86px',
      sortValue: (row) => row.minSeverity,
      cell: (row) => copy.severity[row.minSeverity],
    },
    {
      id: 'delay',
      header: words.columns.delay,
      width: '72px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.delaySeconds,
      cell: (row) => durationWord(row.delaySeconds),
    },
    {
      id: 'cooldown',
      header: words.columns.cooldown,
      width: '72px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.cooldownSeconds,
      cell: (row) => durationWord(row.cooldownSeconds),
    },
    {
      id: 'channel',
      header: words.columns.channel,
      width: '150px',
      sortValue: (row) => row.channel,
      cell: (row) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate">
            {words.channel[row.channel]} · {words.template[row.template]}
          </span>
          <span className="truncate font-mono text-[11px] leading-tight text-[var(--muted-foreground)]">
            {row.target}
          </span>
        </span>
      ),
    },
    {
      id: 'lastFired',
      header: words.columns.lastFired,
      width: '104px',
      align: 'right',
      sortValue: (row) => row.lastFiredAt ?? 0,
      cell: (row) => (
        <span title={row.lastFiredAt === null ? undefined : formatWhen(row.lastFiredAt)}>
          <Value
            value={row.lastFiredAt === null ? null : formatWhenAgo(row.lastFiredAt)}
            source={copy.sourceWord.jobs}
            mono
          />
        </span>
      ),
    },
    {
      id: 'test',
      header: words.columns.action,
      width: '104px',
      align: 'right',
      cell: (row) => (
        <span
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          <Action onClick={() => onTest(row)}>{words.test}</Action>
        </span>
      ),
    },
  ];
}

/**
 * The last few pushes, as words.
 *
 * The cooled-down line is the one that has to be explained rather than shown:
 * silence because of a cooldown is the alerting working as configured, and an
 * operator who reads it as a failure spends ten minutes on a healthy webhook.
 */
function Deliveries({
  rows,
  state,
}: {
  rows: ReturnType<typeof recentDeliveries>;
  state: 'loading' | 'error' | 'ready';
}) {
  if (state !== 'ready') {
    return (
      <p className="text-body text-[var(--muted-foreground)]" role="status">
        {state === 'loading' ? copy.loading : copy.loadError}
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-body text-[var(--muted-foreground)]" role="status">{words.deliveriesEmpty}</p>;
  }
  return (
    <ul className="flex flex-col">
      {rows.map((row) => {
        const line = deliveryLine(row.status);
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--hairline)] py-2 last:border-b-0"
          >
            <span className="w-16 shrink-0 text-body">{line.word}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-body text-[var(--muted-foreground)]">
              {row.target}
            </span>
            <span className="shrink-0 text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
              {words.transition[row.transition]} · {line.why}
            </span>
            <span
              className="w-20 shrink-0 text-right font-mono text-micro text-[var(--muted-foreground)]"
              title={formatWhen(row.at)}
            >
              {formatWhenAgo(row.at)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
