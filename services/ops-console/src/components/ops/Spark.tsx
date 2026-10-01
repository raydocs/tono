import { cn } from '@/lib/utils';
import { linear, splitRuns } from './chart-scale';
import type { Tone } from './StatusWord';
import type { SeriesPoint } from './TimeSeries';

const WIDTH = 100;

function px(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A trend small enough for a tile or a table cell, on a domain the caller
 * chooses.
 *
 * `TimeSeries` always starts at zero, which is right for load and wrong for a
 * success rate: a month between 97 % and 99 % drawn from 0 is a flat line
 * along the top. This one takes the domain the big chart uses, so the tile
 * and the chart below it tell the same story at two sizes. Gaps break the
 * line (R2). The shape is decoration for a number printed beside it, so it
 * is hidden from screen readers rather than described twice.
 */
export function Spark({
  points,
  domain,
  height = 24,
  tone,
  className,
}: {
  points: readonly SeriesPoint[];
  domain: [number, number];
  height?: number;
  /** A trend that is itself a verdict takes a tone; otherwise it is the first series colour. */
  tone?: Tone;
  className?: string;
}) {
  if (points.filter((point) => point.v !== null).length < 2) return null;
  const x = linear(0, points.length - 1, 1, WIDTH - 1);
  const y = linear(domain[0], domain[1], height - 1.5, 1.5);
  const indexed = points.map((point, index) => ({ index, v: point.v }));
  const runs = splitRuns(indexed, (point) => point.v === null);
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      className={cn('block w-full', tone && `tone-${tone}`, className)}
      style={{ height, color: tone ? 'var(--tone-ink)' : 'var(--series-1)' }}
    >
      {runs.map((run) => (
        run.length === 1 ? (
          <circle key={run[0].index} cx={px(x(run[0].index))} cy={px(y(run[0].v ?? 0))} r={1.5} fill="currentColor" />
        ) : (
          <path
            key={run[0].index}
            d={run.map((point, step) => `${step === 0 ? 'M' : 'L'}${px(x(point.index))},${px(y(Math.max(domain[0], point.v ?? 0)))}`).join('')}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )
      ))}
    </svg>
  );
}
