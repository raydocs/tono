import type { NodeHistoryEntryDto } from '@contract';
import { EmptyLine } from '@/components/ops/Empty';
import { FoldedSection } from '@/components/ops/Section';
import { StatusWord } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';
import { formatWhen, formatWhenAgo } from '@/lib/display';
import { reasonSentence } from '@/lib/node-detail';

/**
 * Only the moments the health word changed, so the row count is the number
 * of times this machine actually went wrong. Newest first, each line carrying
 * the sentence that justified the change — and nothing about which set of
 * rules produced it, which is the console's business and not the operator's.
 */
export function NodeHistory({
  rows,
  state,
  message,
}: {
  rows: readonly NodeHistoryEntryDto[];
  state: 'loading' | 'error' | 'ready';
  message?: string;
}) {
  const sorted = [...rows].sort((a, b) => b.at - a.at);

  return (
    <FoldedSection title={copy.nodeSections.history} count={state === 'ready' ? sorted.length : null}>
      {state !== 'ready' ? (
        <EmptyLine message={state === 'loading' ? copy.loading : message || copy.loadError} />
      ) : sorted.length === 0 ? (
        <EmptyLine message={copy.nodeNoHistory} />
      ) : (
        <ul className="flex flex-col">
          {sorted.map((row) => (
            <li
              key={row.at}
              className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2 last:border-b-0"
            >
              <span
                className="w-24 shrink-0 font-mono text-micro text-[var(--muted-foreground)]"
                title={formatWhen(row.at)}
              >
                {formatWhenAgo(row.at)}
              </span>
              <StatusWord word={row.health} className="shrink-0" />
              <span className="min-w-0 truncate text-body text-[var(--muted-foreground)]">
                {whyOf(row)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </FoldedSection>
  );
}

/**
 * The line beside the word. A row that recovered gets none: the word is the
 * whole story, and the engine's reason for it is the token `ok`.
 */
function whyOf(row: NodeHistoryEntryDto): string | null {
  const why = reasonSentence(row.verdict, row.reason);
  if (why) return why;
  return row.verdict === 'ok' ? null : copy.nodeHistoryNoReason;
}
