import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';
import { isPresent, type Measured } from './measured';

/**
 * Three sizes, and only three.
 *
 * A card is read in one glance and the glance has an order: what happened and
 * how much of the quota is gone, then who is on it and how the path looks,
 * then the dates. Giving every cell the same 15 px made the reader do that
 * sorting themselves, one cell at a time.
 */
export type Tier = 'row' | 'body' | 'fine';

const TIER_CLASS: Record<Tier, string> = {
  row: 'text-row',
  body: 'text-body',
  fine: 'text-fine',
};

/**
 * R2 in one component: a value that is not there renders the em dash, never
 * `0` and never a colour. Everything that prints a fact goes through here so
 * the rule cannot be forgotten in one cell and honoured in the next.
 *
 * The word for where it should have come from is on the hover and in the
 * accessible name, not beside the dash: printed in every empty cell it turned
 * a column of nothing into a column of grey words (nine "— follow-up" in one
 * table), which read as data. The dash is muted and takes the tier's size
 * without the mono bump, so an empty cell is lighter than a full one.
 */
export function Value({
  value,
  source,
  reason,
  mono,
  tier = 'row',
  className,
}: {
  value: string | null;
  source: string;
  /** Replaces the hover and accessible name when "no data from X" is not the real reason. */
  reason?: string;
  mono?: boolean;
  tier?: Tier;
  className?: string;
}) {
  if (value === null) {
    const label = reason ?? copy.missingFrom(source);
    return (
      <span
        className={cn(TIER_CLASS[tier], 'text-[var(--muted-foreground)]', className)}
        title={label}
        aria-label={label}
      >
        {copy.missing}
      </span>
    );
  }
  return <span className={cn(TIER_CLASS[tier], mono && 'font-mono', className)}>{value}</span>;
}

/** `Value` fed straight from a `Measured<T>`, with the formatting kept outside. */
export function MeasuredValue<T>({
  measured,
  format,
  mono,
  tier,
  className,
}: {
  measured: Measured<T | null>;
  format: (value: T) => string;
  mono?: boolean;
  tier?: Tier;
  className?: string;
}) {
  return (
    <Value
      value={isPresent(measured) ? format(measured.value) : null}
      source={measured.source}
      mono={mono}
      tier={tier}
      className={className}
    />
  );
}
