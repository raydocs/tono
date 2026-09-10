import { copy } from '@/copy/copy';
import { formatBytesMeasured, formatDate } from '@/lib/display';
import { cn } from '@/lib/utils';
import type { MetricSeries } from './measured';

const DAY = 86_400;
const DAYS = 7;

/**
 * Seven days, seven bars.
 *
 * The smooth area this replaces was a silhouette: it read as a mood rather
 * than as measurements, and with a padded Y domain the same week of near
 * identical days could look like a hill or like a wall depending on the
 * spread. Bars are countable. One per day, a 2 px gap between them, and the
 * days above the week's mean carry the surrounding tone while the rest stay
 * grey — so the shape answers "which days were heavy" instead of colouring
 * the whole week.
 *
 * A gap in the measurement is hatched rather than drawn at zero, the same way
 * an unmeasured hour is on the activity strip: a missing day and a quiet day
 * are different facts (R2).
 *
 * Every bar carries its own date and value on hover, which is R7 for a shape
 * that otherwise has no numbers on it at all.
 */
export function Sparkline({
  series,
  height = 22,
  format = formatBytesMeasured,
  className,
}: {
  series?: MetricSeries | null;
  height?: number;
  /** Most series here are daily bytes; a counter would pass its own words. */
  format?: (value: number | null) => string;
  className?: string;
}) {
  const points = (series?.points ?? []).slice(-DAYS);
  const known = points.filter((v): v is number => typeof v === 'number');
  if (known.length < 2) return null;

  const max = Math.max(...known);
  const mean = known.reduce((sum, v) => sum + v, 0) / known.length;
  const source = series?.source ?? '';
  const lastDay = series?.lastDaySec ?? null;

  return (
    <div className={cn('spark', className)} style={{ height }} data-spark="">
      {points.map((value, index) => {
        const day = lastDay === null ? null : lastDay - (points.length - 1 - index) * DAY;
        const when = day === null ? '' : `${formatDate(day)} `;
        if (value === null) {
          return (
            <div
              key={index}
              className="spark-bar"
              data-gap="true"
              style={{ height: '100%' }}
              title={`${when}${copy.missing} ${source}`}
            />
          );
        }
        return (
          <div
            key={index}
            className="spark-bar"
            data-high={value > mean ? 'true' : 'false'}
            style={{ height: `${max <= 0 ? 2 : Math.max(2, (value / max) * 100)}%` }}
            title={`${when}${format(value)}`}
          />
        );
      })}
    </div>
  );
}
