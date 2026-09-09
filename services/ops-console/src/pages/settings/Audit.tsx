import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditEntryDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { settingsApi } from '@/lib/api-settings';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { actorWord } from '@/lib/settings';
import { usePrivacy } from '@/lib/privacy';
import { Toolbar } from './form';

const words = copy.settings.audit;

type Cursor = { before: number; beforeId: string } | null;

/**
 * The audit log: who moved what.
 *
 * It pages on `(at, id)` rather than an offset because two writes inside one
 * second are ordinary here (a patch that resets a quota and changes a field
 * writes both), and an offset would drop whichever of them fell across the
 * page break. Clicking a row narrows the log to that one object, which is how
 * an operator follows a customer or a node back past the first page.
 */
export function Audit() {
  const privacy = usePrivacy();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(async (from: Cursor, append: boolean) => {
    if (!append) setState('loading');
    setMore(true);
    try {
      const page = await settingsApi.audit({
        targetId,
        before: from?.before ?? null,
        beforeId: from?.beforeId ?? null,
      });
      setEntries((current) => (append ? [...current, ...page.entries] : page.entries));
      setCursor(page.hasMore && page.nextBefore !== null && page.nextBeforeId !== null
        ? { before: page.nextBefore, beforeId: page.nextBeforeId }
        : null);
      setState('ready');
      setMessage(null);
    } catch (failure) {
      setState('error');
      setMessage(failure instanceof Error ? failure.message : copy.loadError);
    } finally {
      setMore(false);
    }
  }, [targetId]);

  useEffect(() => {
    void load(null, false);
  }, [load]);

  const columns = useMemo(() => auditColumns(privacy.email), [privacy.email]);
  const tableState: TableState = state === 'ready'
    ? (entries.length === 0 ? 'empty' : 'ready')
    : state;

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        aside={targetId ? <Action onClick={() => setTargetId(null)}>{words.clearFilter}</Action> : null}
      >
        {targetId ? (
          <>
            <span>{words.filterTarget}</span>
            <span className="min-w-0 truncate font-mono text-[11px] normal-case">{targetId}</span>
          </>
        ) : (
          <span className="normal-case tracking-normal">{words.filterTargetHint}</span>
        )}
      </Toolbar>
      <DataTable
        rows={entries}
        columns={columns}
        getRowId={(row) => row.id}
        onRowClick={(row) => { if (row.targetId) setTargetId(row.targetId); }}
        state={tableState}
        emptyMessage={words.empty}
        errorMessage={message ?? undefined}
      />
      {cursor === null ? null : (
        <div className="flex justify-center">
          <Action pending={more} onClick={() => { void load(cursor, true); }}>
            {more ? words.loadingMore : words.more}
          </Action>
        </div>
      )}
    </div>
  );
}

function auditColumns(mask: (email: string) => string): DataColumn<AuditEntryDto>[] {
  return [
    {
      id: 'at',
      header: words.columns.at,
      width: '104px',
      mono: true,
      sortValue: (row) => row.at,
      cell: (row) => <span title={formatWhen(row.at)}>{formatWhenAgo(row.at)}</span>,
    },
    {
      id: 'actor',
      header: words.columns.actor,
      width: '176px',
      sortValue: (row) => row.actorEmail ?? '',
      cell: (row) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate">
            {row.actorEmail === null ? words.actorUnknown : mask(row.actorEmail)}
          </span>
          <span className="truncate text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
            {actorWord(row.actorType)}
          </span>
        </span>
      ),
    },
    {
      id: 'action',
      header: words.columns.action,
      width: '188px',
      mono: true,
      sortValue: (row) => row.action,
      cell: (row) => <span className="truncate">{row.action}</span>,
    },
    {
      id: 'target',
      header: words.columns.target,
      width: '176px',
      sortValue: (row) => row.targetId ?? '',
      cell: (row) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-mono">
            <Value value={row.targetId} source={copy.sourceWord.manual} mono />
          </span>
          <span className="truncate font-mono text-[11px] leading-tight text-[var(--muted-foreground)]">
            {row.targetType}
          </span>
        </span>
      ),
    },
    {
      id: 'summary',
      header: words.columns.summary,
      sortValue: (row) => row.summary ?? '',
      cell: (row) => (
        <span className="truncate text-[var(--muted-foreground)]">{row.summary ?? copy.missing}</span>
      ),
    },
  ];
}
