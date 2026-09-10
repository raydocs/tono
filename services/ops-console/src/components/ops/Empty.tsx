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
