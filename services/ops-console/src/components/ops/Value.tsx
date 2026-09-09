import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';
import { isPresent, type Measured } from './measured';

/**
 * R2 in one component: a value that is not there renders the em dash and the
 * word for where it should have come from, never `0` and never a colour.
 * Everything that prints a fact goes through here so the rule cannot be
 * forgotten in one cell and honoured in the next.
 */
export function Value({
  value,
  source,
  mono,
  className,
}: {
  value: string | null;
  source: string;
  mono?: boolean;
  className?: string;
}) {
  if (value === null) {
    return (
      <span className={cn('inline-flex items-baseline gap-1.5', className)}>
        <span className="font-mono text-row">{copy.missing}</span>
        <span className="text-micro text-[var(--muted-foreground)]">{source}</span>
      </span>
    );
  }
  return <span className={cn('text-row', mono && 'font-mono', className)}>{value}</span>;
}

/** `Value` fed straight from a `Measured<T>`, with the formatting kept outside. */
export function MeasuredValue<T>({
  measured,
  format,
  mono,
  className,
}: {
  measured: Measured<T | null>;
  format: (value: T) => string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <Value
      value={isPresent(measured) ? format(measured.value) : null}
      source={measured.source}
      mono={mono}
      className={className}
    />
  );
}
