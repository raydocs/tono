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
 * line and the page's smallest type. The stamp turns warn when a displayed
 * read has aged — a console that keeps presenting an hour-old world in
 * the present tense is worse than one that admits it is behind.
 *
 * The backfill half is the answer to "why is everyone silent since the
 * deploy": thirty days of telemetry are still being worked through, and saying
 * so beats letting the operator conclude the pipeline is broken.
 *
 * On a phone the two halves are two lines and the separator goes: a line that
 * ends in a lone "·" with the second half wrapped under it reads as a typo.
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
    <p className={cn('flex flex-wrap items-baseline gap-x-2 max-[640px]:block text-micro text-[var(--muted-foreground)]', className)}>
      {fetchedAt === null ? null : (
        <span className={cn('inline-block normal-case tracking-normal max-[640px]:block', behind && 'stamp-late')}>
          {behind ? copy.pageStale : copy.pageAsOf(formatWhenAgo(fetchedAt))}
        </span>
      )}
      {filling === null ? null : (
        <>
          {fetchedAt === null ? null : <span aria-hidden className="max-[640px]:hidden">·</span>}
          <span className="inline-block normal-case tracking-normal max-[640px]:block">{filling}</span>
        </>
      )}
    </p>
  );
}
