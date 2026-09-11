import type { ChangeReceiptDto } from '@contract';
import { EmptyLine } from '@/components/ops/Empty';
import { FoldedSection } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { receiptDetail } from '@/lib/receipts';

/**
 * Change receipts for this machine: retires, relists, synchronisations, and
 * service restarts. Newest first, each line carrying the action taken and
 * the revision or acknowledgement count that confirmed it.
 */
export function NodeHistory({
  rows,
  state,
  message,
}: {
  rows: readonly ChangeReceiptDto[];
  state: 'loading' | 'error' | 'ready';
  message?: string;
}) {
  const sorted = [...rows].sort((a, b) => b.at - a.at);

  return (
    <FoldedSection title={copy.nodeSections.history} count={state === 'ready' ? sorted.length : null}>
      {state !== 'ready' ? (
        <EmptyLine message={state === 'loading' ? copy.loading : message || copy.loadError} />
      ) : sorted.length === 0 ? (
        <EmptyLine message={copy.nodeNoReceipts} />
      ) : (
        <ul className="flex flex-col">
          {sorted.map((row) => (
            <li
              key={row.id}
              className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2 last:border-b-0"
            >
              <span
                className="w-24 shrink-0 font-mono text-micro text-[var(--muted-foreground)]"
                title={formatWhen(row.at)}
              >
                {formatWhenAgo(row.at)}
              </span>
              <span className="shrink-0 text-body">
                {copy.receiptAction[row.kind as keyof typeof copy.receiptAction] ?? copy.receipt}
              </span>
              <span className="min-w-0 truncate text-body text-[var(--muted-foreground)]">
                {receiptDetail(row) || (row.actor ?? '')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </FoldedSection>
  );
}

