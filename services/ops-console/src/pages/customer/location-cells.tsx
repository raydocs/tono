import type { CustomerSummaryDto } from '@contract';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { codeSentence, stageWord } from '@/lib/codes';
import { formatWhenAgo } from '@/lib/display';
import { splitNodeName, withoutRemark } from '@/lib/node-name';

/**
 * The node a customer is on: the city above, the site under it.
 *
 * Eight production nodes share a city and the sites run to 50 characters, so
 * a one-line cell clipped to "Los Angeles ·" — the half that says which
 * machine. The city and the site are two lines, each on one line: a site too
 * long for the column ends in an ellipsis rather than growing the row, and
 * the whole name is on the hover. A trailing full-width parenthetical is left
 * off the site line (see `withoutRemark`); the hover keeps it.
 */
export function NodeCell({ name }: { name: string | null }) {
  if (name === null) return <Value value={null} source={copy.sourceWord.catalog} />;
  const split = splitNodeName(name);
  return (
    <span className="flex min-w-0 flex-col leading-tight" title={name}>
      {split.prefix === null ? null : (
        <span className="truncate text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
          {split.prefix}
        </span>
      )}
      <span className="truncate text-row">{withoutRemark(split.main)}</span>
    </span>
  );
}

/**
 * When it happened, then what it means.
 *
 * The second line is the Chinese sentence for the client's code; a code
 * nobody has written a line for is printed as it came, because it is the one
 * thing the operator can paste into a search. The sentence stays on one line
 * (an ellipsis is the safety net, not the plan) so a failure never grows its
 * row, and the hover carries the raw code, or the sentence when the code is
 * unknown, so both are one look away.
 */
export function FailureCell({ failure }: { failure: CustomerSummaryDto['lastFailure'] }) {
  if (!failure) return <Value value={null} source={copy.sourceWord.telemetry} />;
  const line = failure.code
    ? codeSentence(failure.code) ?? failure.code
    : stageWord(failure.stage) ?? copy.missing;
  return (
    <span className="flex min-w-0 flex-col leading-tight" title={failure.code ?? stageWord(failure.stage) ?? undefined}>
      <span className="truncate font-mono text-body">{formatWhenAgo(failure.at)}</span>
      <span title={line} className="truncate text-micro normal-case tracking-normal text-[var(--muted-foreground)]">
        {line}
      </span>
    </span>
  );
}
