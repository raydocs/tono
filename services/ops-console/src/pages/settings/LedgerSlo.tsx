import { useMemo, useState } from 'react';
import { DataTable, type DataColumn } from '@/components/ops/DataTable';
import { EmptyLine } from '@/components/ops/Empty';
import { measured } from '@/components/ops/measured';
import { MetricCard } from '@/components/ops/MetricCard';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { sloApi, type SloRowDto, type SloSummaryDto } from '@/lib/api-slo';
import { formatCount, formatDate, splitPercent } from '@/lib/display';
import { useResource } from '@/lib/use-resource';
import { cn } from '@/lib/utils';

const words = copy.ledger;

export function LedgerSlo({
  node,
  carrier,
  platform,
}: {
  node?: string;
  carrier?: string;
  platform?: string;
}) {
  const [range, setRange] = useState<'7d' | '30d'>('30d');

  const resource = useResource(
    `slo-${range}-${node ?? ''}-${carrier ?? ''}-${platform ?? ''}`,
    (signal) => sloApi.get({ range, node, carrier, platform }, signal),
  );

  const data = resource.status === 'ready' ? resource.data : null;
  const items = data?.items ?? [];
  const summary = data?.summary ?? null;
  const updatedAt = data?.updatedAt ?? null;

  const columns = useMemo<DataColumn<SloRowDto>[]>(() => [
    {
      id: 'day',
      header: words.sloColumns.day,
      cell: (row) => (
        <span className="font-mono text-body">{formatDate(row.dayAt)}</span>
      ),
      sortValue: (row) => row.dayAt,
    },
    {
      id: 'node',
      header: words.sloColumns.node,
      cell: (row) => (
        <a
          className="text-body underline decoration-[var(--hairline)] underline-offset-4 hover:decoration-[var(--accent)]"
          href={`#/nodes/${encodeURIComponent(row.node)}`}
        >
          {row.node}
        </a>
      ),
      sortValue: (row) => row.node,
    },
    {
      id: 'platform',
      header: words.sloColumns.platform,
      cell: (row) => (
        <span className="text-body">
          {words.sloPlatform[row.platform as keyof typeof words.sloPlatform] ?? row.platform}
        </span>
      ),
      sortValue: (row) => row.platform,
    },
    {
      id: 'carrier',
      header: words.sloColumns.carrier,
      cell: (row) => (
        <span className="text-body">
          {words.sloCarrier[row.carrier as keyof typeof words.sloCarrier] ?? row.carrier}
        </span>
      ),
      sortValue: (row) => row.carrier,
    },
    {
      id: 'attempts',
      header: words.sloColumns.attempts,
      cell: (row) => (
        <Value value={String(row.attempts)} source={words.source} mono />
      ),
      sortValue: (row) => row.attempts,
      align: 'right',
    },
    {
      id: 'successRate',
      header: words.sloColumns.successRate,
      cell: (row) => (
        <span className="font-mono text-body">
          {row.attempts > 0 ? words.sloPercent(row.successes / row.attempts) : copy.missing}
        </span>
      ),
      sortValue: (row) => (row.attempts > 0 ? row.successes / row.attempts : -1),
      align: 'right',
    },
    {
      id: 'p50',
      header: words.sloColumns.p50,
      cell: (row) => (
        <span className="font-mono text-body">
          {row.p50Ms != null ? words.sloMs(row.p50Ms) : copy.missing}
        </span>
      ),
      sortValue: (row) => row.p50Ms ?? -1,
      align: 'right',
    },
    {
      id: 'outage',
      header: words.sloColumns.outage,
      cell: (row) => (
        <span className="font-mono text-body">
          {words.sloMinutes(row.verifiedOutageMin)}
        </span>
      ),
      sortValue: (row) => row.verifiedOutageMin,
      align: 'right',
    },
    {
      id: 'unmeasured',
      header: words.sloColumns.unmeasured,
      cell: (row) => (
        <span className="font-mono text-body">
          {words.sloMinutes(row.unmeasuredMin)}
        </span>
      ),
      sortValue: (row) => row.unmeasuredMin,
      align: 'right',
    },
  ], []);

  const tableState = resource.status === 'loading'
    ? 'loading'
    : resource.status === 'error'
      ? 'error'
      : items.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-[var(--muted-foreground)]">{words.sloLead}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cn(
              'h-7 rounded-[8px] px-2 text-micro font-medium transition-colors',
              range === '7d'
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--hairline)] bg-[var(--background)] hover:bg-[var(--muted)]',
            )}
            onClick={() => setRange('7d')}
          >
            {words.sloRange7d}
          </button>
          <button
            type="button"
            className={cn(
              'h-7 rounded-[8px] px-2 text-micro font-medium transition-colors',
              range === '30d'
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--hairline)] bg-[var(--background)] hover:bg-[var(--muted)]',
            )}
            onClick={() => setRange('30d')}
          >
            {words.sloRange30d}
          </button>
        </div>
      </div>

      {summary ? (
        <SloSummaryCards summary={summary} updatedAt={updatedAt} />
      ) : resource.status === 'error' ? (
        <EmptyLine message={resource.message} />
      ) : null}

      <DataTable
        rows={items}
        columns={columns}
        getRowId={(row) => `${row.dayAt}:${row.node}:${row.platform}:${row.carrier}`}
        state={tableState}
        emptyMessage={words.sloNone}
        errorMessage={resource.status === 'error' ? resource.message : undefined}
      />
    </div>
  );
}

function SloSummaryCards({
  summary,
  updatedAt,
}: {
  summary: SloSummaryDto;
  updatedAt: number | null;
}) {
  const at = updatedAt;
  const rateCell = measured<number | null>(summary.successRate, at, words.source);
  const p50Cell = measured<number | null>(summary.p50Ms, at, words.source);
  const outageCell = measured<number | null>(summary.verifiedOutageMin, at, words.source);
  const unmeasuredCell = measured<number | null>(summary.unmeasuredMin, at, words.source);
  const coverageCell = measured<number | null>(summary.coverage, at, words.source);

  return (
    <div className="grid gap-4 border-y border-[var(--hairline)] py-4 sm:grid-cols-5">
      <MetricCard
        label={words.sloSuccessRate}
        value={rateCell}
        format={splitPercent}
      />
      <MetricCard
        label={words.sloP50}
        value={p50Cell}
        format={(val) => ({ number: formatCount(val), unit: words.sloUnitMs })}
      />
      <MetricCard
        label={words.sloOutage}
        value={outageCell}
        format={(val) => ({ number: formatCount(val), unit: words.sloUnitMin })}
      />
      <MetricCard
        label={words.sloUnmeasured}
        value={unmeasuredCell}
        format={(val) => ({ number: formatCount(val), unit: words.sloUnitMin })}
      />
      <MetricCard
        label={words.sloCoverage}
        value={coverageCell}
        format={splitPercent}
      />
    </div>
  );
}
