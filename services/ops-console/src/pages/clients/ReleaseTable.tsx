import { useState } from 'react';
import type { Platform, ReleaseDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { DataTable, type DataColumn } from '@/components/ops/DataTable';
import { LifecycleTag } from '@/components/ops/Chip';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { compareVersions } from '@/lib/releases';
import { formatDate } from '@/lib/display';

type Pending =
  | { kind: 'publish'; row: ReleaseDto }
  | { kind: 'withdraw'; row: ReleaseDto }
  | { kind: 'setMin'; row: ReleaseDto };

/**
 * What has shipped for one platform, newest first, and the three things that
 * can be done to a row that already exists.
 *
 * None of the three is applied to the console's own copy: the Worker owns the
 * state machine, so every one of them refetches and shows what actually
 * happened. Publishing an already published build is a no-op there, and the
 * page should say so rather than tick.
 */
export function ReleaseTable({
  platform,
  releases,
  onChanged,
}: {
  platform: Platform;
  releases: readonly ReleaseDto[];
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [minVersion, setMinVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = [...releases]
    .filter((row) => row.platform === platform)
    .sort((a, b) => compareVersions(b.version, a.version));

  function ask(next: Pending) {
    setPending(next);
    setMinVersion(next.row.minSupportedVersion ?? '');
    setFailure(null);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setFailure(null);
    try {
      if (pending.kind === 'publish') await opsApi.publishRelease(pending.row.id);
      else if (pending.kind === 'withdraw') await opsApi.withdrawRelease(pending.row.id);
      else await opsApi.setMinSupported(pending.row.id, minVersion.trim());
      setPending(null);
      onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DataTable
        rows={rows}
        columns={releaseColumns(ask)}
        getRowId={(row) => row.id}
        state={rows.length === 0 ? 'empty' : 'ready'}
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending ? copy.releaseActions[pending.kind] : ''}
        consequence={consequence(pending, minVersion)}
        confirm={pending ? copy.releaseActions[pending.kind] : ''}
        pending={busy || (pending?.kind === 'setMin' && minVersion.trim() === '')}
        failure={failure}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      >
        {pending?.kind === 'setMin' ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-micro text-[var(--muted-foreground)]">
              {copy.releaseConfirm.minPrompt}
            </span>
            <input
              className="h-8 rounded-[10px] border border-[var(--hairline)] bg-[var(--background)] px-3 font-mono text-body outline-none"
              value={minVersion}
              onChange={(event) => setMinVersion(event.target.value)}
            />
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

/** The consequence, in the words of whichever action is being confirmed. */
function consequence(pending: Pending | null, minVersion: string): string {
  if (!pending) return '';
  if (pending.kind === 'publish') {
    return copy.releaseConfirm.publish(copy.platform[pending.row.platform], pending.row.version);
  }
  if (pending.kind === 'withdraw') return copy.releaseConfirm.withdraw(pending.row.version);
  return copy.releaseConfirm.setMin(minVersion.trim() || copy.missing);
}

function releaseColumns(ask: (next: Pending) => void): DataColumn<ReleaseDto>[] {
  return [
    {
      id: 'channel',
      header: copy.releaseColumns.channel,
      width: '72px',
      sortValue: (row) => row.channel,
      cell: (row) => copy.channel[row.channel],
    },
    {
      id: 'version',
      header: copy.releaseColumns.version,
      width: '176px',
      mono: true,
      sortValue: (row) => row.version,
      cell: (row) => (
        <span className="flex items-baseline gap-2">
          <span className="text-row">{row.version}</span>
          {row.withdrawnAt !== null ? <LifecycleTag>{copy.releaseState.withdrawn}</LifecycleTag> : null}
          {row.publishedAt === null ? <LifecycleTag>{copy.releaseState.draft}</LifecycleTag> : null}
        </span>
      ),
    },
    {
      id: 'published',
      header: copy.releaseColumns.published,
      width: '112px',
      mono: true,
      sortValue: (row) => row.publishedAt ?? 0,
      cell: (row) => (
        <Value
          value={row.publishedAt === null ? null : formatDate(row.publishedAt)}
          source={copy.sourceWord.catalog}
          tier="body"
          mono
        />
      ),
    },
    {
      id: 'minSupported',
      header: copy.releaseColumns.minSupported,
      width: '124px',
      mono: true,
      sortValue: (row) => row.minSupportedVersion ?? '',
      cell: (row) => (
        <Value
          value={row.minSupportedVersion}
          source={copy.sourceWord.manual}
          tier="body"
          mono
        />
      ),
    },
    {
      id: 'notes',
      header: copy.releaseColumns.notes,
      cell: (row) => (
        <span className="block truncate" title={row.notes ?? undefined}>
          <Value value={row.notes} source={copy.sourceWord.manual} tier="body" />
        </span>
      ),
    },
    {
      id: 'action',
      header: copy.releaseColumns.action,
      width: '250px',
      align: 'right',
      cell: (row) => (
        <ActionRow className="justify-end gap-1.5">
          {row.publishedAt === null ? (
            <Action onClick={() => ask({ kind: 'publish', row })}>
              {copy.releaseActions.publish}
            </Action>
          ) : null}
          {row.publishedAt !== null && row.withdrawnAt === null ? (
            <Action onClick={() => ask({ kind: 'withdraw', row })}>
              {copy.releaseActions.withdraw}
            </Action>
          ) : null}
          <Action onClick={() => ask({ kind: 'setMin', row })}>
            {copy.releaseActions.setMin}
          </Action>
        </ActionRow>
      ),
    },
  ];
}
