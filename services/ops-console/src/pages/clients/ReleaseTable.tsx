import { useState } from 'react';
import type { Platform, ReleaseDto, UpdateChannelDto } from '@contract';
import { Action, ActionRow } from '@/components/ops/Action';
import { ConfirmDialog } from '@/components/ops/ConfirmDialog';
import { DataTable, type DataColumn } from '@/components/ops/DataTable';
import { LifecycleTag } from '@/components/ops/Chip';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { opsApi } from '@/lib/api';
import { compareVersions, publishBlockReason } from '@/lib/releases';
import { formatBytesMeasured, formatDate, formatWhen } from '@/lib/display';
import { useIsPhone } from '@/lib/use-phone';

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
  channel,
  onChanged,
}: {
  platform: Platform;
  releases: readonly ReleaseDto[];
  /** This platform's update channel; null while it is still being fetched. */
  channel: UpdateChannelDto | null;
  onChanged: () => void;
}) {
  const phone = useIsPhone();
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
        columns={releaseColumns(ask, channel, phone)}
        getRowId={(row) => row.id}
        state={rows.length === 0 ? 'empty' : 'ready'}
        className="clients-release-table"
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending ? copy.releaseActions[pending.kind] : ''}
        consequence={consequence(pending, minVersion)}
        confirm={pending ? copy.releaseActions[pending.kind] : ''}
        danger={pending?.kind === 'withdraw'}
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

/**
 * What has been checked about the file behind a row.
 *
 * The digest and the size are the two things an operator can compare against
 * the build they uploaded, so the checked word carries both rather than being a
 * tick. Unchecked and unsigned are states of a row that exists, not
 * measurements that are missing, so they are words rather than the em dash
 * `Value` would render.
 */
function verification(row: ReleaseDto, channel: UpdateChannelDto | null): string {
  if (row.verifiedAt == null) return copy.releaseVerified.unverified;
  if (channel?.wired === true && row.signed !== true) return copy.releaseVerified.unsigned;
  return copy.releaseVerified.checked(
    (row.sha256 ?? '').slice(0, 8) || copy.missing,
    formatBytesMeasured(row.sizeBytes),
  );
}

/**
 * On a phone the actions are the point of the row, and in the last column of
 * a 1104 px table they are off screen. The checks and notes columns go, and
 * the rest are reordered so the actions land inside the first 390 px; the
 * fixed widths then add up to the 592 px floor in clients.css.
 */
const PHONE_ORDER = ['channel', 'version', 'action', 'published', 'minSupported'] as const;

function releaseColumns(
  ask: (next: Pending) => void,
  channel: UpdateChannelDto | null,
  phone: boolean,
): DataColumn<ReleaseDto>[] {
  const all = allReleaseColumns(ask, channel, phone);
  if (!phone) return all;
  return PHONE_ORDER.flatMap((id) => all.filter((column) => column.id === id)).map((column) => {
    if (column.id === 'channel') return { ...column, width: '56px' };
    if (column.id === 'version') return { ...column, width: '112px' };
    if (column.id === 'action') return { ...column, width: '188px', align: 'left' as const };
    return column;
  });
}

function allReleaseColumns(
  ask: (next: Pending) => void,
  channel: UpdateChannelDto | null,
  phone: boolean,
): DataColumn<ReleaseDto>[] {
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
      width: '156px',
      mono: true,
      sortValue: (row) => row.version,
      cell: (row) => (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-row">{row.version}</span>
          {row.withdrawnAt !== null ? <LifecycleTag>{copy.releaseState.withdrawn}</LifecycleTag> : null}
          {row.publishedAt === null ? <LifecycleTag>{copy.releaseState.draft}</LifecycleTag> : null}
        </span>
      ),
    },
    {
      id: 'published',
      header: copy.releaseColumns.published,
      // Date and time like the catalog history; the phone's 592 px floor has
      // 112 px for this column, so there it keeps the date alone.
      width: phone ? '112px' : '168px',
      mono: true,
      sortValue: (row) => row.publishedAt ?? 0,
      cell: (row) => (
        <Value
          value={row.publishedAt === null ? null : (phone ? formatDate : formatWhen)(row.publishedAt)}
          source={copy.sourceWord.catalog}
          tier="body"
          mono
        />
      ),
    },
    {
      id: 'verified',
      header: copy.releaseColumns.verified,
      width: '228px',
      mono: true,
      sortValue: (row) => row.verifiedAt ?? 0,
      cell: (row) => (
        <span
          className={row.verifiedAt == null ? 'text-body text-[var(--muted-foreground)]' : 'text-body'}
        >
          {verification(row, channel)}
        </span>
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
      width: '228px',
      align: 'right',
      cell: (row) => (
        <ActionRow className="justify-end gap-1.5 max-[640px]:justify-start">
          {row.publishedAt === null ? (
            <Action
              reason={publishBlockReason(row, channel, copy)}
              onClick={() => ask({ kind: 'publish', row })}
            >
              {copy.releaseActions.publish}
            </Action>
          ) : null}
          {row.publishedAt !== null && row.withdrawnAt === null ? (
            <Action danger onClick={() => ask({ kind: 'withdraw', row })}>
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
