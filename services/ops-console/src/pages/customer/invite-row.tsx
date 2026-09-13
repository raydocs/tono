import type { ReactNode } from 'react';
import type { CustomerSummaryDto, FunnelRowDto } from '@contract';
import type { DataColumn } from '@/components/ops/DataTable';
import { copy } from '@/copy/copy';
import type { ListRow } from '@/lib/funnel';

type Mask = (value: string) => string;

/**
 * An address that was opened and never registered, in a table of customers.
 *
 * Three cells answer, and the rest say nothing on purpose. The status cell
 * gets the neutral tag rather than a health word, because nobody has measured
 * this person: they have no client, no devices and no verdict, and printing
 * the silent-client word over them would put them in the same column as a
 * customer whose client has gone quiet — a different problem with a different
 * fix.
 *
 * The address and the handle are the two things there are, and both mask with
 * the privacy switch like everywhere else. Everything else is the em dash on
 * its own: `Value`'s dash carries the source word for a measurement that
 * failed to arrive, and this is not that — there is nothing to measure yet.
 */
function inviteCell(
  id: string,
  row: FunnelRowDto,
  mask: Mask,
  wechat: Mask | null,
): ReactNode {
  if (id === 'status') return <span className="ops-tag">{copy.inviteTag}</span>;
  if (id === 'customer') {
    const shown = mask(row.email);
    return (
      <div className="flex items-baseline gap-2" title={shown}>
        <span className="min-w-0 truncate text-row">{shown}</span>
      </div>
    );
  }
  if (id === 'wechat' && wechat !== null) {
    if (row.wechatId === null || row.wechatId === '') {
      return <span className="text-[var(--muted-foreground)]">{copy.missing}</span>;
    }
    const handle = wechat(row.wechatId);
    return <span className="block min-w-0 truncate" title={handle}>{handle}</span>;
  }
  // The selection box included: nothing here can be renewed or refreshed.
  if (id === 'pick') return null;
  return <span className="text-[var(--muted-foreground)]">{copy.missing}</span>;
}

function inviteSort(id: string, row: FunnelRowDto): string | number | null {
  if (id === 'status') return copy.inviteTag;
  if (id === 'customer') return row.email;
  if (id === 'wechat') return row.wechatId ?? '';
  return null;
}

/**
 * The customer columns, widened to a table that also holds invites.
 *
 * Wrapping rather than rewriting: every column keeps its own width, header and
 * sort, and gains one branch for the row that has no account. Teaching each of
 * the ten cells about `null` in place would have put the same branch in ten
 * files and made the customer half harder to read for the sake of the two
 * cells an invite actually fills in.
 */
export function withInvites(
  columns: readonly DataColumn<CustomerSummaryDto>[],
  mask: Mask,
  wechat: Mask | null,
): DataColumn<ListRow>[] {
  return columns.map((column) => ({
    ...column,
    sortValue: (row: ListRow) => (row.customer === null
      ? inviteSort(column.id, row.invite)
      : column.sortValue?.(row.customer) ?? null),
    cell: (row: ListRow) => (row.customer === null
      ? inviteCell(column.id, row.invite, mask, wechat)
      : column.cell(row.customer)),
  }));
}
