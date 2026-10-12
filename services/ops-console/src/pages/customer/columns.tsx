import type { CustomerSummaryDto } from '@contract';
import { type DataColumn } from '@/components/ops/DataTable';
import { QuotaBar } from '@/components/ops/QuotaGauge';
import { StatusWord } from '@/components/ops/StatusWord';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import type { FollowupDto } from '@/lib/api-followups';
import { formatDate, formatPercent, splitBytes } from '@/lib/display';
import { shown } from '@/lib/sources';
import { FailureCell, NodeCell } from './location-cells';

type Mask = (email: string) => string;

/** The open followups by customer, or null while nobody in the fleet has one. */
export type FollowupIndex = Map<string, FollowupDto> | null;

/**
 * How to print a WeChat id, or null while nobody in the fleet has one.
 *
 * A masker rather than a boolean beside one, so the column cannot be asked for
 * without a way to mask what it prints: this is the one column carrying a
 * handle a stranger could go and find somebody by.
 */
export type WechatMask = Mask | null;

/**
 * The three columns a 390 px phone keeps: the health word, the address, and
 * the expiry. The selection box is left out because batch selection is desktop
 * work and its column cost the address 40 px of 390; the rest are one tap away
 * on the customer 360.
 * The column objects are the desktop ones, so widths, sorting and cells cannot
 * drift between the two layouts; a column the fleet has not filled in (the
 * expiry, while no plan is wired) is simply absent from both.
 */
const PHONE_COLUMN_IDS: ReadonlySet<string> = new Set(['status', 'customer', 'expires']);

export function phoneColumns<T>(columns: readonly DataColumn<T>[]): DataColumn<T>[] {
  return columns.filter((column) => PHONE_COLUMN_IDS.has(column.id));
}

/**
 * The address is the row's name, so it gets the width nothing else claims.
 *
 * Every other column here is fixed, which makes this one the one that takes
 * what is left — and while the last three are hiding, that is most of the
 * table rather than the 200 px that was clipping people's domains. The title
 * carries the whole address for the widths where even that is not enough, and
 * it is the masked one: the privacy toggle must not be undone by a hover.
 *
 * Since the page took the 1280 px dashboard width, the address column at 1440
 * had about 80 px more than its longest entry plus a lifecycle tag, while the
 * node, handle, service and version columns clipped their values to a few
 * letters and the version header to three of its four characters. The
 * 2026-10-12 cut gives 72 of those pixels to those four columns and the
 * expiry's right air, keeping about ten over the longest address (the
 * customers spec asserts none is clipped). The node and failure cells then
 * kept each line on one line, which gives the failure column 114 px, enough
 * for every sentence up to 94 px (the 141 px one ends in an ellipsis); the status, handle and follow-up columns gave the
 * difference, and the usage, service and version columns took the 8 px
 * padding. The address column stays 260 px, the width the longest address
 * with its tag needs. Widths include the cells' padding (border-box). Below the table floor in Customers.tsx the container
 * scrolls sideways rather than squeeze any column further.
 */
export function customerColumns(
  mask: Mask,
  wired: boolean,
  followups: FollowupIndex,
  wechat: WechatMask,
): DataColumn<CustomerSummaryDto>[] {
  return [
    {
      id: 'status',
      header: copy.customerColumns.status,
      /**
       * 64 px fitted the three-character words and cut the five-character one
       * a glyph short of itself, which is not a word — and the health word is
       * the one thing on the row that has to be readable at a glance.
       *
       * The 30 px are paid for by the three columns that can spare them
       * without losing a fact: 14 from the quota figure, which needs 62 px and
       * had 76, and 8 each from the handle and the service list, both of which
       * were already truncating with the whole value one hover away. The
       * narrower padding here is the same argument —
       * this cell is one short word, and its side air is worth less than a
       * word that can be read.
       */
      width: '86px',
      className: 'px-2',
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
    /* Beside the address, because the two are the same question — which
       person is this row — and an operator scanning for somebody they only
       know by their handle should not have to cross the table to find it. */
    ...(wechat === null ? [] : [
      {
        id: 'wechat',
        header: copy.customerColumns.wechat,
        width: '66px',
        sortValue: (row: CustomerSummaryDto) => row.wechatId ?? '',
        cell: (row: CustomerSummaryDto) => (
          <WechatCell id={row.wechatId} mask={wechat} duplicate={row.wechatDuplicate === true} />
        ),
      },
    ]),
    {
      id: 'devices',
      header: copy.customerColumns.devices,
      width: '44px',
      align: 'right',
      mono: true,
      sortValue: (row) => row.deviceCount,
      cell: (row) => `${row.deviceCount}${copy.deviceUnit}`,
    },
    {
      id: 'node',
      header: copy.customerColumns.node,
      width: '112px',
      sortValue: (row) => row.selectedServer ?? '',
      cell: (row) => <NodeCell name={row.selectedServer} />,
    },
    {
      id: 'failure',
      header: copy.customerColumns.failure,
      width: '114px',
      className: 'px-2',
      sortValue: (row) => row.lastFailure?.at ?? 0,
      cell: (row) => <FailureCell failure={row.lastFailure} />,
    },
    {
      id: 'usage',
      header: copy.customerColumns.usage,
      width: '78px',
      className: 'px-2',
      align: 'right',
      mono: true,
      sortValue: (row) => row.usageBytes.value,
      cell: (row) => <UsageCell row={row} />,
    },
    /* The same rule the last three columns follow: a column nobody has filled
       in anywhere is a column of dashes across the width the addresses need,
       so it stays away until the fleet has one open followup in it. */
    ...(followups === null ? [] : [
      {
        id: 'followup',
        header: copy.customerColumns.followup,
        width: '84px',
        sortValue: (row: CustomerSummaryDto) => followups.get(row.userId)?.dueAt ?? 0,
        cell: (row: CustomerSummaryDto) => <FollowupCell row={followups.get(row.userId)} />,
      },
    ]),
    ...(wired ? [
      {
        id: 'services',
        header: copy.customerColumns.services,
        width: '92px',
        className: 'px-2',
        cell: (row: CustomerSummaryDto) => (
          row.services.length === 0
            ? <Value value={null} source={copy.sourceWord.telemetry} reason={copy.customersBoard.servicesMissing} />
            : <ServicesCell families={row.services} />
        ),
      },
      {
        id: 'version',
        header: copy.customerColumns.minVersion,
        width: '70px',
        className: 'px-2',
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
        className: 'pl-1 pr-2',
        align: 'right' as const,
        mono: true,
        sortValue: (row: CustomerSummaryDto) => row.expiresAt ?? 0,
        cell: (row: CustomerSummaryDto) => (
          <Value
            value={row.expiresAt === null ? null : formatDate(row.expiresAt)}
            source={copy.sourceWord.profile}
            reason={copy.customersBoard.expiryMissing}
            mono
            tier="body"
          />
        ),
      },
    ] : []),
  ];
}

/**
 * The handle, masked, and nothing else on the hover.
 *
 * The title is the masked id too, for the same reason the address column's is:
 * a privacy switch that a mouse pointer undoes was never on. A customer with
 * no handle gets the em dash and the word for where one would have come from,
 * like every other absent fact on the page.
 */
function WechatCell({ id, mask, duplicate }: { id: string | null; mask: Mask; duplicate: boolean }) {
  if (id === null || id === '') return <Value value={null} source={copy.sourceWord.profile} />;
  const shownId = mask(id);
  if (!duplicate) return <span className="block min-w-0 truncate" title={shownId}>{shownId}</span>;
  return (
    <span className="flex min-w-0 flex-col items-start leading-tight" title={`${shownId} · ${copy.wechatDuplicateTitle}`}>
      <span className="block min-w-0 max-w-full truncate">{shownId}</span>
      <span className="ops-tag tone-unk">{copy.wechatDuplicate}</span>
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
  const [first, second] = families.map((f) => copy.serviceName[f]);
  return (
    <span
      className="flex min-w-0 items-baseline gap-1"
      title={families.map((f) => copy.serviceName[f]).join(' · ')}
    >
      <span className="shrink-0 whitespace-nowrap">{first}</span>
      {second === undefined ? null : (
        <span className="min-w-0 truncate">{`· ${second}`}</span>
      )}
      {rest > 0 ? <span className="shrink-0 text-[var(--muted-foreground)]">+{rest}</span> : null}
    </span>
  );
}

/**
 * What is still owed on this customer: what kind of thing it is, and when it
 * was promised for.
 *
 * A followup with no date is not a gap in a measurement — it is a note
 * somebody wrote without promising a day — so it shows its own word and stays
 * quiet about the date. A customer with nothing open gets the em dash through
 * `Value`, like every other absent fact on the page.
 */
function FollowupCell({ row }: { row: FollowupDto | undefined }) {
  if (row === undefined) return <Value value={null} source={copy.followupSection} />;
  return (
    <span className="flex min-w-0 flex-col leading-tight" title={row.body}>
      <span className="truncate text-body">{copy.followupKind[row.kind]}</span>
      {row.dueAt === null ? null : (
        <span className="truncate font-mono text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
          {formatDate(row.dueAt)}
        </span>
      )}
    </span>
  );
}
