import type { MonthReconRowDto } from '@contract';
import { EmptyLine } from '@/components/ops/Empty';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import type { MonthSummaryDto } from '@/lib/api-ledger';
import { formatAmount, formatCny } from '@/lib/ledger';

const words = copy.ledger;

/**
 * The two lists the month close exists to answer: a bill with no cost row,
 * and a cost row whose object is gone, retired, or has no price.
 *
 * Amounts go through `Value` so a missing figure is a missing figure, not a
 * zero. Matched pairs are omitted on the wire; this block only renders what
 * still disagrees.
 */
export function LedgerRecon({ summary }: { summary: MonthSummaryDto }) {
  const recon = summary.reconciliation;
  if (!recon) return null;
  const bills = recon.billsWithoutLedger;
  const ledger = recon.ledgerWithoutBill;
  if (bills.length === 0 && ledger.length === 0) {
    return <EmptyLine message={words.reconNone} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-[var(--muted-foreground)]">{words.reconLead}</p>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <ReconList title={words.billsWithoutLedger(bills.length)} rows={bills} source={words.source} />
        <ReconList title={words.ledgerWithoutBill(ledger.length)} rows={ledger} source={words.source} />
      </div>
    </div>
  );
}

function ReconList({
  title,
  rows,
  source,
}: {
  title: string;
  rows: readonly MonthReconRowDto[];
  source: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro text-[var(--muted-foreground)]">{title}</span>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const href = hrefOf(row);
          return (
            <li
              key={`${row.subjectType}:${row.subjectId}`}
              className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2 last:border-b-0"
            >
              <span className="min-w-0 truncate">
                {href ? (
                  <a
                    className="text-body underline decoration-[var(--hairline)] underline-offset-4 hover:decoration-[var(--accent)]"
                    href={href}
                  >
                    {row.label}
                  </a>
                ) : (
                  <span className="text-body">{row.label}</span>
                )}
                <span className="ml-2 text-micro text-[var(--muted-foreground)]">
                  {words.reconReason[row.reason]}
                </span>
              </span>
              <Value
                value={amountOf(row)}
                source={source}
                mono
                tier="body"
                className="shrink-0"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function hrefOf(row: MonthReconRowDto): string | null {
  if (row.subjectType === 'node') return `#/nodes/${encodeURIComponent(row.subjectId)}`;
  if (row.subjectType === 'home_exit') return '#/settings/homelines';
  if (row.subjectType === 'account' && row.ownerUserId) {
    return `#/customers/${encodeURIComponent(row.ownerUserId)}`;
  }
  return null;
}

function amountOf(row: MonthReconRowDto): string | null {
  if (row.ledgerCnyMinor != null) return formatCny(row.ledgerCnyMinor);
  if (row.expectedMinor != null) return formatAmount(row.expectedMinor, row.expectedCurrency ?? 'USD');
  return null;
}
