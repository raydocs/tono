import { Action } from './Action';
import { DOT_SEPARATOR, DotJoined } from './DotJoined';
import { cn } from '@/lib/utils';

/**
 * One quiet sentence saying this page is missing facts the operator can type
 * in, and the one action that opens the place to do it.
 *
 * It is a hairline box rather than an alert: nothing is broken, the data was
 * never entered, and a coloured banner on every list that has a gap would
 * teach people to scroll past it. On a phone the action goes under the
 * sentence and takes the full width, which is also what makes it a thumb tall.
 */
export function DataGapBanner({
  sentence,
  action,
  className,
}: {
  sentence: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-3 text-body',
        'max-[640px]:flex-col max-[640px]:items-stretch',
        className,
      )}
    >
      <p><DotJoined parts={sentence.split(DOT_SEPARATOR)} /></p>
      {action ? (
        <Action className="shrink-0 max-[640px]:justify-center" onClick={action.onClick}>
          {action.label}
        </Action>
      ) : null}
    </div>
  );
}
