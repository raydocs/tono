import type { CustomerSummaryDto } from '@contract';
import { Value } from '@/components/ops/Value';
import { copy } from '@/copy/copy';
import { codeSentence, stageWord } from '@/lib/codes';
import { formatWhenAgo } from '@/lib/display';
import { splitNodeName } from '@/lib/node-name';

/**
 * The node a customer is on: the city above, the site under it.
 *
 * Eight production nodes share a city and the sites run to 50 characters, so
 * a one-line cell clipped to "Los Angeles ·" — the half that says which
 * machine. Both halves wrap (anywhere, since a site is one long token), and
 * the whole name is on the hover.
 */
export function NodeCell({ name }: { name: string | null }) {
  if (name === null) return <Value value={null} source={copy.sourceWord.catalog} />;
  const split = splitNodeName(name);
  return (
    <span className="flex min-w-0 flex-col leading-tight" title={name}>
      {split.prefix === null ? null : (
        <span className="whitespace-normal text-micro normal-case tracking-normal text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
          {split.prefix}
        </span>
      )}
      <span className="whitespace-normal text-row [overflow-wrap:anywhere]">{split.main}</span>
    </span>
  );
}

/**
 * When it happened, then what it means.
 *
 * The second line is the Chinese sentence for the client's code; a code
 * nobody has written a line for is printed as it came, because it is the one
 * thing the operator can paste into a search. That line wraps rather than
 * ends in an ellipsis for the same reason, and the raw code is the hover, so
 * the sentence and the token are both one look away.
 */
export function FailureCell({ failure }: { failure: CustomerSummaryDto['lastFailure'] }) {
  if (!failure) return <Value value={null} source={copy.sourceWord.telemetry} />;
  const line = failure.code
    ? codeSentence(failure.code) ?? failure.code
    : stageWord(failure.stage) ?? copy.missing;
  return (
    <span className="flex min-w-0 flex-col leading-tight" title={failure.code ?? stageWord(failure.stage) ?? undefined}>
      <span className="truncate font-mono text-body">{formatWhenAgo(failure.at)}</span>
      <span className="whitespace-normal text-micro normal-case tracking-normal text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
        {line}
      </span>
    </span>
  );
}
