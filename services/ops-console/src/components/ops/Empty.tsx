import { Action } from '@/components/ops/Action';
import { copy } from '@/copy/copy';

export function Empty({ message = copy.emptyMigrated }: { message?: string }) {
  return (
    <div
      className="flex min-h-[240px] items-center justify-center rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-8 py-12"
      role="status"
    >
      <p className="text-body text-[var(--muted-foreground)]">{message}</p>
    </div>
  );
}

/**
 * Nothing here, in one line.
 *
 * `Empty` is a whole page's worth of nothing — 240 px of bordered surface with
 * a sentence lost in the middle of it — and inside a block on the node page it
 * read as an empty white box, which is exactly the thing it exists to prevent.
 * A block that has no rows yet says so on one line, under its own heading,
 * where the sentence is the first thing read rather than the last.
 */
export function EmptyLine({ message }: { message: string }) {
  return (
    <p className="text-body text-[var(--muted-foreground)]" role="status">{message}</p>
  );
}

/**
 * A read that failed, in one line, with the way to ask again.
 *
 * Plain-text errors used to end at the sentence: the operator's only move was
 * to reload the whole console. When a refetch exists the page passes it as
 * `onRetry` and the sentence gets a retry button beside it (under it on a phone).
 */
export function ErrorLine({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="tone-sev tone-fg text-body">{message}</p>
      {onRetry ? <Action onClick={onRetry}>{copy.retry}</Action> : null}
    </div>
  );
}
