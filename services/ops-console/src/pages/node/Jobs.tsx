import { useMemo, useState } from 'react';
import type { JobDto } from '@contract';
import { Action } from '@/components/ops/Action';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { nodeApi } from '@/lib/api-node';
import { formatWhenAgo } from '@/lib/display';
import { canCancelJob } from '@/lib/node-detail';
import { usePrivacy } from '@/lib/privacy';

/**
 * What has been asked of this machine, newest first.
 *
 * The rail enqueues, this block is where the answer comes back — so it
 * refetches after every write rather than appending a hopeful row. A job that
 * is still queued or still running can be called off; one that already
 * finished says so instead of offering a button that would 409.
 */
export function NodeJobs({
  rows,
  state,
  message,
  onChanged,
}: {
  rows: readonly JobDto[];
  state: 'loading' | 'error' | 'ready';
  message?: string;
  onChanged: () => void;
}) {
  const privacy = usePrivacy();
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function cancel(job: JobDto) {
    setPending(job.id);
    setFailure(null);
    try {
      await nodeApi.cancelJob(job.id);
      onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setPending(null);
    }
  }

  // Not memoised: the cancel handler closes over this render's state, and a
  // stale column set is a button that cancels the job that was there before.
  const columns = jobColumns(privacy.email, pending, cancel);
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.createdAt - a.createdAt),
    [rows],
  );
  const tableState: TableState = state === 'ready' ? 'ready' : state;

  return (
    <Section title={copy.nodeSections.jobs}>
      {state === 'ready' && sorted.length === 0 ? (
        <Empty message={copy.nodeNoJobs} />
      ) : (
        <DataTable
          rows={sorted}
          columns={columns}
          getRowId={(row) => row.id}
          state={tableState}
          errorMessage={message}
          className="[&>table]:min-w-[720px]"
        />
      )}
      {failure ? <p className="panel-error rounded-[10px] px-3 py-2 text-body">{failure}</p> : null}
    </Section>
  );
}

function jobColumns(
  mask: (email: string) => string,
  pending: string | null,
  cancel: (job: JobDto) => void,
): DataColumn<JobDto>[] {
  return [
    {
      id: 'type',
      header: copy.nodeJobColumns.type,
      width: '150px',
      sortValue: (row) => row.type,
      cell: (row) => <span className="text-row">{copy.nodeJobType[row.type]}</span>,
    },
    {
      id: 'status',
      header: copy.nodeJobColumns.status,
      width: '86px',
      sortValue: (row) => row.status,
      cell: (row) => <span className="ops-tag">{copy.jobStatus[row.status]}</span>,
    },
    {
      id: 'who',
      header: copy.nodeJobColumns.who,
      width: '170px',
      sortValue: (row) => row.requestedBy ?? '',
      cell: (row) => (
        <span className="truncate text-body text-[var(--muted-foreground)]">
          {row.requestedBy === null ? copy.missing : mask(row.requestedBy)}
        </span>
      ),
    },
    {
      id: 'created',
      header: copy.nodeJobColumns.created,
      width: '104px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.createdAt,
      cell: (row) => formatWhenAgo(row.createdAt),
    },
    {
      id: 'result',
      header: copy.nodeJobColumns.result,
      sortValue: (row) => row.resultSummary ?? '',
      cell: (row) => (
        row.resultSummary === null
          ? <Value value={null} source={copy.sourceWord.jobs} />
          : (
            <span className="block truncate font-mono text-body" title={row.resultSummary}>
              {row.resultSummary}
            </span>
          )
      ),
    },
    {
      id: 'cancel',
      header: copy.nodeJobColumns.action,
      width: '84px',
      align: 'right',
      cell: (row) => (
        <Action
          reason={canCancelJob(row.status) ? null : copy.nodeJobCancelBlocked}
          pending={pending === row.id}
          onClick={() => cancel(row)}
        >
          {copy.nodeJobCancel}
        </Action>
      ),
    },
  ];
}
