import { useMemo, useState } from 'react';
import type { CustomerSummaryDto, Platform } from '@contract';
import { Chip } from '@/components/ops/Chip';
import { DataTable, type DataColumn, type TableState } from '@/components/ops/DataTable';
import { QuotaBar } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { explainCode, stageWord } from '@/lib/codes';
import {
  CUSTOMER_FILTERS,
  customerCounts,
  PLATFORM_CHIPS,
  platformCounts,
  releasedPlatforms,
  selectByPlatform,
  selectCustomers,
  type CustomerFilter,
  type CustomerFilterId,
} from '@/lib/customers';
import { formatDate, formatPercent, formatWhenAgo, splitBytes } from '@/lib/display';
import { openCustomer } from '@/lib/hash-route';
import { usePrivacy } from '@/lib/privacy';
import { shown } from '@/lib/sources';
import { cn } from '@/lib/utils';
import type { Resource } from '@/lib/use-resource';
import type { Tone } from '@/components/ops/StatusWord';

type Mask = (email: string) => string;

/** 在线 is the only fragment that carries a tone; the other two are prose. */
const FRAGMENT_TONE: Record<CustomerFilterId, Tone | 'none'> = {
  all: 'none',
  online: 'ok',
  unreachable: 'sev',
};

export default function CustomersPage({
  customers,
}: {
  customers: Resource<CustomerSummaryDto[]>;
}) {
  const privacy = usePrivacy();
  const [filter, setFilter] = useState<CustomerFilter>(null);
  const [platform, setPlatform] = useState<Platform | null>(null);

  const all = useMemo(
    () => (customers.status === 'ready' ? customers.data : []),
    [customers],
  );
  const counts = useMemo(() => customerCounts(all), [all]);
  const perPlatform = useMemo(() => platformCounts(all), [all]);
  const released = useMemo(() => releasedPlatforms(all), [all]);
  const rows = useMemo(
    () => selectByPlatform(selectCustomers(all, filter), platform),
    [all, filter, platform],
  );
  const columns = useMemo(() => customerColumns(privacy.email), [privacy.email]);

  const state: TableState = customers.status === 'loading'
    ? 'loading'
    : customers.status === 'error'
      ? 'error'
      : rows.length === 0
        ? 'empty'
        : 'ready';

  return (
    <div className="page-wrap">
      {customers.status === 'ready' ? (
        <p className="text-verdict">
          {CUSTOMER_FILTERS.map((id, index) => (
            <span key={id}>
              {index === 0 ? null : <span className="mx-2 text-[var(--muted-foreground)]">·</span>}
              <button
                type="button"
                aria-pressed={filter === id}
                className={cn('count-bit', `tone-${FRAGMENT_TONE[id]}`)}
                onClick={() => setFilter((current) => (current === id ? null : id))}
              >
                {copy.customerCount[id](counts[id])}
              </button>
            </span>
          ))}
        </p>
      ) : (
        <p className="text-verdict text-[var(--muted-foreground)]">
          {customers.status === 'loading' ? copy.loading : copy.loadError}
        </p>
      )}

      {/* All five platforms, always. The ones nothing has shipped for say so. */}
      <div className="flex flex-wrap items-center gap-2">
        {PLATFORM_CHIPS.map((id) => {
          const live = released.has(id);
          return (
            <Chip
              key={id}
              muted={!live}
              active={platform === id}
              count={live ? perPlatform[id] : null}
              title={live ? undefined : copy.unreleased}
              onClick={() => setPlatform((current) => (current === id ? null : id))}
            >
              {live ? copy.platform[id] : `${copy.platform[id]} ${copy.unreleased}`}
            </Chip>
          );
        })}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.userId}
        onRowClick={(row) => openCustomer(row.userId)}
        state={state}
        errorMessage={customers.status === 'error' ? customers.message : undefined}
      />
    </div>
  );
}

function customerColumns(mask: Mask): DataColumn<CustomerSummaryDto>[] {
  return [
    {
      id: 'status',
      header: copy.customerColumns.status,
      width: '74px',
      sortValue: (row) => row.health,
      cell: (row) => <StatusWord word={row.health} reason={row.reason} />,
    },
    {
      id: 'customer',
      header: copy.customerColumns.customer,
      sortValue: (row) => row.email,
      cell: (row) => (
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-row">{mask(row.email)}</span>
          {row.lifecycle === 'active' ? null : (
            <span className="ops-tag shrink-0">{copy.lifecycle[row.lifecycle]}</span>
          )}
        </div>
      ),
    },
    {
      id: 'devices',
      header: copy.customerColumns.devices,
      width: '56px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.deviceCount,
      cell: (row) => `${row.deviceCount}${copy.deviceUnit}`,
    },
    {
      id: 'node',
      header: copy.customerColumns.node,
      width: '140px',
      sortValue: (row) => row.selectedServer ?? '',
      cell: (row) => <Value value={row.selectedServer} source={copy.sourceWord.catalog} />,
    },
    {
      id: 'failure',
      header: copy.customerColumns.failure,
      width: '170px',
      sortValue: (row) => row.lastFailure?.at ?? 0,
      cell: (row) => <FailureCell row={row} />,
    },
    {
      id: 'usage',
      header: copy.customerColumns.usage,
      width: '140px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.usageBytes.value,
      cell: (row) => <UsageCell row={row} />,
    },
    {
      id: 'services',
      header: copy.customerColumns.services,
      width: '110px',
      cell: (row) => (
        row.services.length === 0
          ? <Value value={null} source={copy.sourceWord.telemetry} />
          : <span className="truncate">{row.services.map((f) => copy.serviceName[f]).join(' · ')}</span>
      ),
    },
    {
      id: 'version',
      header: copy.customerColumns.minVersion,
      width: '80px',
      mono: true,
      sortValue: (row) => row.minAppVersion ?? '',
      cell: (row) => <Value value={row.minAppVersion} source={copy.sourceWord.telemetry} mono />,
    },
    {
      id: 'expires',
      header: copy.customerColumns.expires,
      width: '90px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.expiresAt ?? 0,
      cell: (row) => (
        <Value
          value={row.expiresAt === null ? null : formatDate(row.expiresAt)}
          source={copy.sourceWord.profile}
          mono
        />
      ),
    },
  ];
}

/** When, at which stage, and what the client called it — in that order. */
function FailureCell({ row }: { row: CustomerSummaryDto }) {
  const failure = row.lastFailure;
  if (!failure) return <Value value={null} source={copy.sourceWord.telemetry} />;
  const stage = stageWord(failure.stage);
  return (
    <span className="flex min-w-0 flex-col leading-tight" title={explainCode(failure.code) ?? undefined}>
      <span className="truncate font-mono text-body">{formatWhenAgo(failure.at)}</span>
      <span className="truncate text-micro text-[var(--muted-foreground)]">
        {[stage, failure.code].filter(Boolean).join(' · ')}
      </span>
    </span>
  );
}

function UsageCell({ row }: { row: CustomerSummaryDto }) {
  const usage = shown(row.usageBytes);
  if (usage.value === null) return <Value value={null} source={usage.source} mono />;
  const used = splitBytes(usage.value);
  if (row.quotaBytes === null) {
    return <span className="truncate">{used.number} {used.unit}</span>;
  }
  return (
    <span className="inline-flex w-full flex-col items-end gap-1">
      <span className="truncate">
        {used.number} {used.unit}
        <span className="text-[var(--muted-foreground)]">
          {' '}· {copy.remaining} {formatPercent((row.quotaBytes - usage.value) / row.quotaBytes)}
        </span>
      </span>
      <QuotaBar used={usage.value} quota={row.quotaBytes} />
    </span>
  );
}
