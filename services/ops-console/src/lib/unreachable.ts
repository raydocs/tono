import type { BackendUnreachableError } from './api-errors';

type ShellRead = { status: string; fetchedAt?: number; unreachable?: BackendUnreachableError };

/**
 * Whether any shared read is currently holding an unanswered refetch, and how
 * old the oldest copy it left on screen is. `since` is null when nothing the
 * failing reads showed ever loaded, so the banner does not invent a time.
 */
export function unreachableSummary(...reads: ShellRead[]): { since: number | null } | null {
  const failing = reads.filter((read) => read.unreachable !== undefined);
  if (failing.length === 0) return null;
  let since: number | null = null;
  for (const read of failing) {
    if (read.fetchedAt === undefined) continue;
    if (since === null || read.fetchedAt < since) since = read.fetchedAt;
  }
  return { since };
}
