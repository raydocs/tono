import { useMemo, useState } from 'react';
import type { Measured, NodeErrorRowDto, RangeKey } from '@contract';
import { Chip } from '@/components/ops/Chip';
import { Empty } from '@/components/ops/Empty';
import { Section } from '@/components/ops/Section';
import { copy } from '@/copy/copy';
import { nodeApi } from '@/lib/api-node';
import { formatCount, formatDate, formatWhenAgo } from '@/lib/display';
import { barSize, foldErrors } from '@/lib/node-detail';
import { sourceWord } from '@/lib/sources';
import { useResource } from '@/lib/use-resource';

const WEEK: RangeKey = '7d';
const MONTH: RangeKey = '30d';

/**
 * The machine's own error log, folded by category with one bar per day.
 *
 * The seven-day view is the one the node detail already carries, so switching
 * back to it costs nothing; only the month asks the Worker for more. The bars
 * are grey on purpose — a count of dial errors is a measurement, not a
 * verdict, and the page already has one coloured word at the top.
 */
export function NodeErrors({
  name,
  recent,
}: {
  name: string;
  recent: Measured<NodeErrorRowDto[]>;
}) {
  const [range, setRange] = useState<RangeKey>(WEEK);
  const month = useResource(
    range === MONTH ? `${name}#${MONTH}` : null,
    (signal) => nodeApi.errors(name, MONTH, signal),
  );
  const shown: Measured<NodeErrorRowDto[]> | null = range === WEEK
    ? recent
    : month.status === 'ready' ? month.data : null;

  const groups = useMemo(() => foldErrors(shown?.value ?? []), [shown]);
  const busiest = groups.reduce(
    (top, group) => group.days.reduce((day, row) => Math.max(day, row.count), top),
    0,
  );

  return (
    <Section
      title={copy.nodeSections.errors}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {shown === null ? null : (
            <span className="text-micro text-[var(--muted-foreground)]">
              {shown.asOfSec === null ? sourceWord(shown.source) : formatWhenAgo(shown.asOfSec)}
            </span>
          )}
          <Chip active={range === WEEK} onClick={() => setRange(WEEK)}>
            {copy.nodeErrorRange.week}
          </Chip>
          <Chip active={range === MONTH} onClick={() => setRange(MONTH)}>
            {copy.nodeErrorRange.month}
          </Chip>
        </div>
      }
    >
      {shown === null ? (
        <Empty message={month.status === 'error' ? month.message : copy.loading} />
      ) : groups.length === 0 ? (
        <Empty message={copy.nodeNoErrors} />
      ) : (
        <div className="flex flex-col">
          {groups.map((group) => (
            <div
              key={group.category}
              className="flex flex-col gap-2 border-b border-[var(--hairline)] py-3 last:border-b-0"
            >
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 truncate text-row">{group.category}</span>
                <span className="ml-auto shrink-0 font-mono text-micro text-[var(--muted-foreground)]">
                  {copy.nodeErrorTimes(formatCount(group.total))}
                </span>
              </div>
              <div className="flex h-6 items-end gap-[3px]">
                {group.days.map((day) => (
                  <span
                    key={day.dayAt}
                    title={`${formatDate(day.dayAt)} · ${copy.nodeErrorTimes(formatCount(day.count))}`}
                    className="w-2 shrink-0 rounded-[1px] bg-[var(--muted-foreground)] opacity-45"
                    style={{ height: barSize(day.count, busiest) }}
                  />
                ))}
              </div>
              {group.sample ? (
                <p className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-micro text-[var(--muted-foreground)]">
                    {copy.nodeErrorSample}
                  </span>
                  {/* The machine's own line, in the machine's own case: an
                      uppercased log entry is a different string from the one
                      an operator would grep for. */}
                  <span
                    title={group.sample}
                    className="min-w-0 truncate font-mono text-body text-[var(--muted-foreground)]"
                  >
                    {group.sample}
                  </span>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
