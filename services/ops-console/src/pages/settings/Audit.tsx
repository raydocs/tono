import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuditEntryDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { auditSearchCopy as searchWords } from '@/copy/audit-search';
import { settingsApi } from '@/lib/api-settings';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { actorWord } from '@/lib/settings';
import { usePrivacy } from '@/lib/privacy';
import { openCustomer, openNodePage } from '@/lib/hash-route';
import { Field, Toolbar } from './form';
import { AuditFilters, EMPTY_AUDIT_FILTERS } from './AuditFilters';

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
  const [filters, setFilters] = useState(EMPTY_AUDIT_FILTERS);
  const { targetId } = filters;
  const [filtering, setFiltering] = useState(false);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState<string | null>(null);
  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async (from: Cursor, append: boolean) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const id = ++request.current;
    if (!append) { setState('loading'); setEntries([]); setCursor(null); }
    setMore(true);
    setMessage(null);
    try {
      const page = await settingsApi.audit({
        ...filters,
        before: from?.before ?? filters.before,
        beforeId: from?.beforeId ?? null,
      }, controller.signal);
      if (id !== request.current || controller.signal.aborted) return;
      setEntries((current) => (append ? [...current, ...page.entries] : page.entries));
      setCursor(page.hasMore && page.nextBefore !== null && page.nextBeforeId !== null
        ? { before: page.nextBefore, beforeId: page.nextBeforeId }
        : null);
      setState('ready');
      setMessage(null);
    } catch (failure) {
      if (id !== request.current || controller.signal.aborted) return;
      if (!append) setState('error');
      setMessage(failure instanceof Error ? failure.message : copy.loadError);
    } finally {
      if (id === request.current && !controller.signal.aborted) setMore(false);
    }
  }, [filters]);

  useEffect(() => {
    void load(null, false);
    const current = abort.current;
    return () => { current?.abort(); };
  }, [load]);

  const columns = useMemo(() => auditColumns(privacy.email), [privacy.email]);
  const shown = entries.filter((row) => row.action.toLowerCase().includes(action.trim().toLowerCase()));
  const hasFilters = Boolean(targetId || filters.actorEmail || filters.before || action);
  const openTarget = !targetId ? null
    : targetType === 'user' || targetType === 'customer' ? () => openCustomer(targetId)
      : targetType === 'node' ? () => openNodePage(targetId) : null;
  const tableState: TableState = state === 'ready'
    ? (shown.length === 0 ? 'empty' : 'ready')
    : state;

  return (
    <div className="settings-audit flex flex-col gap-3">
      <Toolbar
        aside={<>
          <Action className="max-sm:min-h-11" onClick={() => setFiltering(!filtering)}>{searchWords.filters}</Action>
          {openTarget ? <Action className="max-sm:min-h-11" onClick={openTarget}>{searchWords.open}</Action> : null}
          {hasFilters ? <Action className="max-sm:min-h-11" onClick={() => { setFilters(EMPTY_AUDIT_FILTERS); setAction(''); setTargetType(null); }}>{words.clearFilter}</Action> : null}
        </>}
      >
        {targetId ? (
          <>
            <span>{words.filterTarget}</span>
            <span className="min-w-0 truncate font-mono text-[11px] normal-case">{targetId}</span>
          </>
        ) : (
          <span className="normal-case tracking-normal">{words.filterTargetHint}</span>
        )}
        {filters.actorEmail ? <span>{privacy.email(filters.actorEmail)}</span> : null}
        {filters.before ? <span>{searchWords.beforeActive(formatWhen(filters.before))}</span> : null}
      </Toolbar>
      {!filtering ? null : <>
        <AuditFilters key={JSON.stringify(filters)} filters={filters} onApply={(next) => { setFilters(next); setTargetType(null); }} />
        <Field label={searchWords.action}>
          <input className="min-h-11 min-w-0 rounded-[8px] border border-[var(--hairline)] bg-[var(--background)] px-2 text-body" value={action} onChange={(event) => setAction(event.target.value)} />
        </Field>
      </>}
      {action && state === 'ready' ? <p className="text-body text-[var(--muted-foreground)]" role="status">{searchWords.scope(entries.length, shown.length, cursor !== null)}</p> : null}
      <DataTable
        rows={shown}
        columns={columns}
        getRowId={(row) => row.id}
        onRowClick={(row) => { if (row.targetId) { setFilters({ ...filters, targetId: row.targetId }); setTargetType(row.targetType); } }}
        state={tableState}
        emptyMessage={action ? searchWords.noMatches : words.empty}
        errorMessage={message ?? undefined}
        className="settings-audit-table"
      />
      {message && state === 'ready' ? <p role="alert" className="panel-error p-3 text-body">{message}</p> : null}
      {state === 'error' ? <Action pending={more} onClick={() => { void load(null, false); }}>{searchWords.retry}</Action> : null}
      {cursor === null ? null : (
        <div className="flex justify-center">
          <Action pending={more} onClick={() => { void load(cursor, true); }} className="settings-more">
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
