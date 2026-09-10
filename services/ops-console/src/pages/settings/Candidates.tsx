import { useMemo, useState } from 'react';
import type { DirectCandidateDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { Chip } from '@/components/ops/Chip';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { settingsApi } from '@/lib/api-settings';
import { formatBytesMeasured, formatWhen, formatWhenAgo } from '@/lib/display';
import {
  CANDIDATE_FILTERS,
  candidateCounts,
  candidateStatusWord,
  draftText,
  selectCandidates,
  type CandidateFilter,
} from '@/lib/settings';
import { useResource } from '@/lib/use-resource';
import { DraftDialog } from './DraftDialog';
import { Toolbar } from './form';
import { useWrite } from './use-write';

const words = copy.settings.candidates;

/**
 * Direct candidates: domains the console suspects should not be tunnelled.
 *
 * It is an inbox, not a switch: accepting a domain records a decision, and the
 * routing rules only change when the operator takes the draft below and
 * publishes it themselves. Nothing on this page edits live traffic policy,
 * which is why accepting one is safe to press on a hunch.
 */
export function Candidates() {
  const candidates = useResource('direct-candidates', (signal) => settingsApi.directCandidates(signal));
  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [draft, setDraft] = useState<string | null>(null);
  const write = useWrite(candidates.reload);

  const all = useMemo(
    () => (candidates.status === 'ready' ? candidates.data.items : []),
    [candidates],
  );
  const counts = useMemo(() => candidateCounts(all), [all]);
  const rows = useMemo(() => selectCandidates(all, filter), [all, filter]);
  const columns = useMemo(
    () => candidateColumns(
      (row) => { void write.run(() => settingsApi.acceptCandidate(row.etld1)); },
      (row) => { void write.run(() => settingsApi.rejectCandidate(row.etld1)); },
    ),
    [write],
  );
  const state: TableState = candidates.status === 'loading'
    ? 'loading'
    : candidates.status === 'error'
      ? 'error'
      : rows.length === 0 ? 'empty' : 'ready';

  async function makeDraft() {
    await write.run(async () => {
      const made = await settingsApi.candidateDraft();
      setDraft(draftText(made.draft) ?? '');
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Toolbar
          aside={(
            <Action primary pending={write.pending} onClick={() => { void makeDraft(); }}>
              {words.draft}
            </Action>
          )}
        >
          {CANDIDATE_FILTERS.map((id) => (
            <Chip
              key={id}
              active={filter === id}
              count={counts[id]}
              onClick={() => setFilter(id)}
            >
              {id === 'all' ? words.all : words.status[id]}
            </Chip>
          ))}
        </Toolbar>
        {write.error ? (
          <p className="panel-error rounded-[8px] px-3 py-2 text-body" role="alert">{write.error}</p>
        ) : null}
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.etld1}
          state={state}
          emptyMessage={words.empty}
          errorMessage={candidates.status === 'error' ? candidates.message : undefined}
        />
      </div>

      <DraftDialog text={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function candidateColumns(
  onAccept: (row: DirectCandidateDto) => void,
  onReject: (row: DirectCandidateDto) => void,
): DataColumn<DirectCandidateDto>[] {
  return [
    {
      id: 'etld1',
      header: words.columns.etld1,
      sortValue: (row) => row.etld1,
      cell: (row) => <span className="truncate font-mono text-row">{row.etld1}</span>,
    },
    {
      id: 'country',
      header: words.columns.country,
      width: '80px',
      sortValue: (row) => row.countryHint ?? '',
      cell: (row) => (
        <Value value={row.countryHint} source={copy.sourceWord.engine} mono />
      ),
    },
    {
      id: 'users',
      header: words.columns.users,
      width: '92px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.users,
      cell: (row) => words.userUnit(row.users),
    },
    {
      id: 'bytes',
      header: words.columns.bytes,
      width: '100px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.bytes30d,
      cell: (row) => formatBytesMeasured(row.bytes30d),
    },
    {
      id: 'firstSeen',
      header: words.columns.firstSeen,
      width: '96px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.firstSeen,
      cell: (row) => <span title={formatWhen(row.firstSeen)}>{formatWhenAgo(row.firstSeen)}</span>,
    },
    {
      id: 'decision',
      header: words.columns.action,
      width: '160px',
      align: 'right',
      cell: (row) => (row.status === 'new' ? (
        <ActionRow className="justify-end">
          <Action onClick={() => onAccept(row)}>{words.accept}</Action>
          <Action onClick={() => onReject(row)}>{words.reject}</Action>
        </ActionRow>
      ) : (
        <span className="flex min-w-0 flex-col items-end leading-tight">
          <span className="ops-tag">{candidateStatusWord(row.status)}</span>
          {row.decidedBy ? (
            <span className="truncate font-mono text-[11px] leading-tight text-[var(--muted-foreground)]">
              {row.decidedBy}
            </span>
          ) : null}
        </span>
      )),
    },
  ];
}
