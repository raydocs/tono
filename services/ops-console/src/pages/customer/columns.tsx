import type { CustomerSummaryDto } from '@contract';
import { type DataColumn } from '@/components/ops/DataTable';
import { QuotaBar } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { explainCode, stageWord } from '@/lib/codes';
import { formatDate, formatPercent, formatWhenAgo, splitBytes } from '@/lib/display';
import { shown } from '@/lib/sources';

type Mask = (email: string) => string;

/**
 * The address is the row's name, so it gets the width nothing else claims.
 *
 * Every other column here is fixed, which makes this one the one that takes
 * what is left — and while the last three are hiding, that is most of the
 * table rather than the 200 px that was clipping people's domains. The title
 * carries the whole address for the widths where even that is not enough, and
 * it is the masked one: the privacy toggle must not be undone by a hover.
 */
export function customerColumns(mask: Mask, wired: boolean): DataColumn<CustomerSummaryDto>[] {
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
        <div className="flex items-baseline gap-2" title={mask(row.email)}>
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
      width: '52px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.deviceCount,
      cell: (row) => `${row.deviceCount}${copy.deviceUnit}`,
    },
    {
      id: 'node',
      header: copy.customerColumns.node,
      width: '124px',
      sortValue: (row) => row.selectedServer ?? '',
      cell: (row) => <Value value={row.selectedServer} source={copy.sourceWord.catalog} />,
    },
    {
      id: 'failure',
      header: copy.customerColumns.failure,
      width: '130px',
      sortValue: (row) => row.lastFailure?.at ?? 0,
      cell: (row) => <FailureCell row={row} />,
    },
    {
      id: 'usage',
      header: copy.customerColumns.usage,
      width: '112px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.usageBytes.value,
      cell: (row) => <UsageCell row={row} />,
    },
    ...(wired ? [
      {
        id: 'services',
        header: copy.customerColumns.services,
        width: '112px',
        cell: (row: CustomerSummaryDto) => (
          row.services.length === 0
            ? <Value value={null} source={copy.sourceWord.telemetry} />
            : <ServicesCell families={row.services} />
        ),
      },
      {
        id: 'version',
        header: copy.customerColumns.minVersion,
        width: '68px',
        mono: true,
        sortValue: (row: CustomerSummaryDto) => row.minAppVersion ?? '',
        cell: (row: CustomerSummaryDto) => (
          <Value value={row.minAppVersion} source={copy.sourceWord.telemetry} mono />
        ),
      },
      {
        id: 'expires',
        header: copy.customerColumns.expires,
        width: '92px',
        align: 'right' as const,
        mono: true,
        sortValue: (row: CustomerSummaryDto) => row.expiresAt ?? 0,
        cell: (row: CustomerSummaryDto) => (
          <Value
            value={row.expiresAt === null ? null : formatDate(row.expiresAt)}
            source={copy.sourceWord.profile}
            mono
          />
        ),
      },
    ] : []),
  ];
}

/**
 * When it happened, then what the client called it and what that means.
 *
 * `ETIMEDOUT` on its own tells an operator nothing an hour later, and the
 * Chinese sentence on its own loses the token they will paste into a search.
 * The column has 150 px, so the pair is truncated and the title carries the
 * whole thing — including the stage, which is the least of the three and the
 * first to go.
 */
function FailureCell({ row }: { row: CustomerSummaryDto }) {
  const failure = row.lastFailure;
  if (!failure) return <Value value={null} source={copy.sourceWord.telemetry} />;
  const why = explainCode(failure.code);
  const said = failure.code ? [failure.code, why].filter(Boolean).join(' · ') : why;
  const line = said ?? stageWord(failure.stage) ?? copy.missing;
  const full = [stageWord(failure.stage), said].filter(Boolean).join(' · ');
  return (
    <span className="flex min-w-0 flex-col leading-tight" title={full || undefined}>
      <span className="truncate font-mono text-body">{formatWhenAgo(failure.at)}</span>
      <span className="truncate text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
        {line}
      </span>
    </span>
  );
}

/**
 * Bytes on the line, the share on the bar, the arithmetic in the tooltip.
 *
 * Spelling out the used figure and the remaining share together needs about
 * 180 px and this column has 120; right-aligned, the overflow is clipped from
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
      <QuotaBar used={usage.value} quota={quota} alarmOnly />
    </span>
  );
}

/**
 * The two busiest families, and how many others there are.
 *
 * One name plus a count made every multi-service customer look the same;
 * two names is what actually separates a Claude-and-ChatGPT account from a
 * Claude-and-Meta one, which is the distinction this column exists for. Three
 * does not fit, so the tail becomes an exact count and the full list stays one
 * hover away.
 */
const SERVICES_SHOWN = 2;

function ServicesCell({ families }: { families: CustomerSummaryDto['services'] }) {
  const rest = families.length - SERVICES_SHOWN;
  return (
    <span
      className="flex min-w-0 items-baseline gap-1"
      title={families.map((f) => copy.serviceName[f]).join(' · ')}
    >
      <span className="min-w-0 truncate">
        {families.slice(0, SERVICES_SHOWN).map((f) => copy.serviceName[f]).join(' · ')}
      </span>
      {rest > 0 ? <span className="shrink-0 text-[var(--muted-foreground)]">+{rest}</span> : null}
    </span>
  );
}
