import type { BackfillHealthDto } from '@contract';
import { copy } from '@/copy/copy';
import { formatWhenAgo } from '@/lib/display';
import { backfillLine, consoleBehind } from '@/lib/sources';
import { cn } from '@/lib/utils';

/**
 * The grey line under a page's sentence: how old this page is, and whether the
 * numbers on it are still filling in.
 *
 * Both facts are about the reading rather than the fleet, so they share one
 * line and the page's smallest type. The stamp turns warn when the shell has
 * stopped hearing back — a console that keeps presenting an hour-old world in
 * the present tense is worse than one that admits it is behind.
 *
 * The backfill half is the answer to "why is everyone silent since the
 * deploy": thirty days of telemetry are still being worked through, and saying
 * so beats letting the operator conclude the pipeline is broken.
 */
export function PageNote({
  fetchedAt,
  backfill,
  className,
}: {
  fetchedAt: number | null;
  backfill?: BackfillHealthDto | null;
  className?: string;
}) {
  const filling = backfillLine(backfill ?? null);
  if (fetchedAt === null && filling === null) return null;
  const behind = consoleBehind(fetchedAt);
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 text-micro text-[var(--muted-foreground)]', className)}>
      {fetchedAt === null ? null : (
        <span className={cn('normal-case tracking-normal', behind && 'stamp-late')}>
          {behind ? copy.consoleStale : copy.pageAsOf(formatWhenAgo(fetchedAt))}
        </span>
      )}
      {filling === null ? null : (
        <>
          {fetchedAt === null ? null : <span aria-hidden>·</span>}
          <span className="normal-case tracking-normal">{filling}</span>
        </>
      )}
    </p>
  );
}
