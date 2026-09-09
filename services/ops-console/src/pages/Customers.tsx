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

/** Only the online fragment carries a tone; the other two are prose. */
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
      <div className="page-head">
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
        <div className="toolbar-row">
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
      width: '156px',
      sortValue: (row) => row.selectedServer ?? '',
      cell: (row) => <Value value={row.selectedServer} source={copy.sourceWord.catalog} />,
    },
    {
      id: 'failure',
      header: copy.customerColumns.failure,
      width: '150px',
      sortValue: (row) => row.lastFailure?.at ?? 0,
      cell: (row) => <FailureCell row={row} />,
    },
    {
      id: 'usage',
      header: copy.customerColumns.usage,
      width: '136px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.usageBytes.value,
      cell: (row) => <UsageCell row={row} />,
    },
    {
      id: 'services',
      header: copy.customerColumns.services,
      width: '100px',
      cell: (row) => (
        row.services.length === 0
          ? <Value value={null} source={copy.sourceWord.telemetry} />
          : <ServicesCell families={row.services} />
      ),
    },
    {
      id: 'version',
      header: copy.customerColumns.minVersion,
      width: '76px',
      mono: true,
      sortValue: (row) => row.minAppVersion ?? '',
      cell: (row) => <Value value={row.minAppVersion} source={copy.sourceWord.telemetry} mono />,
    },
    {
      id: 'expires',
      header: copy.customerColumns.expires,
      width: '104px',
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

/**
 * Bytes on the line, the share on the bar, the arithmetic in the tooltip.
 *
 * Spelling out the used figure and the remaining share together needs about
 * 180 px and this column has 136; right-aligned, the overflow is clipped from
 * the left, which turns "55.0 GB" into ".0 GB" — a number that is not wrong so
 * much as unreadable. The bar already carries the ratio, and its tone carries
 * the 70 / 90 / 100 steps.
 *
 * A customer past their quota gets the over-quota word rather than a negative
 * percentage: minus ten percent remaining is arithmetic nobody asked for, and
 * the bar is already red.
 */
function UsageCell({ row }: { row: CustomerSummaryDto }) {
  const usage = shown(row.usageBytes);
  if (usage.value === null) return <Value value={null} source={usage.source} mono />;
  const used = splitBytes(usage.value);
  const quota = row.quotaBytes;
  if (quota === null || quota <= 0) {
    return (
      <span className="truncate" title={copy.usageNoQuota(`${used.number} ${used.unit}`)}>
        {used.number} {used.unit}
      </span>
    );
  }
  const left = quota - usage.value;
  const cap = splitBytes(quota);
  return (
    <span
      className="inline-flex w-full flex-col items-end gap-1"
      title={copy.usageTitle(
        `${used.number} ${used.unit}`,
        `${cap.number} ${cap.unit}`,
        left < 0 ? copy.overQuota : formatPercent(left / quota),
      )}
    >
      <span className="truncate">{used.number} {used.unit}</span>
      <QuotaBar used={usage.value} quota={quota} />
    </span>
  );
}

/**
 * The busiest family, and how many others there are.
 *
 * Two names do not fit in a hundred pixels and a truncated "Claude · ChatG"
 * is a worse answer than "Claude +2" — the count is exact, and the full list
 * is one hover or one click away.
 */
function ServicesCell({ families }: { families: CustomerSummaryDto['services'] }) {
  const rest = families.length - 1;
  return (
    <span className="truncate" title={families.map((f) => copy.serviceName[f]).join(' · ')}>
      {copy.serviceName[families[0]]}
      {rest > 0 ? <span className="text-[var(--muted-foreground)]"> +{rest}</span> : null}
    </span>
  );
}
