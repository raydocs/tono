import { cn } from '@/lib/utils';

/** One column of the chart. `null` is a stretch nobody measured, not a zero. */
export type SeriesPoint = { t: number; v: number | null };

/**
 * The x axis in its own units, stretched to whatever width the column gets.
 *
 * The y axis is left at one unit per pixel so the shape is never squashed
 * vertically; only x scales, and the stroke is told not to scale with it.
 */
const WIDTH = 240;
/** Room above the tallest point and below the baseline, so neither is clipped. */
const HEADROOM = 3;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A run of measurements over time, drawn the way this console draws things.
 *
 * One colour, no grid, one hairline on the baseline, and the numbers on hover
 * rather than printed along an axis — a load chart is a shape you glance at,
 * and an axis full of tick labels turns it into a table that is bad at being
 * a table. The peak belongs above the chart, where the caller puts it, so the
 * one number that is always worth reading is not something you have to hover
 * to find.
 *
 * A gap is a break in the line rather than a dip to zero (R2): a machine that
 * stopped reporting and a machine that was idle are different facts, and
 * joining across the hole draws the second when the truth is the first.
 */
export function TimeSeries({
  points,
  height = 52,
  format,
  when,
  label,
  className,
}: {
  points: readonly SeriesPoint[];
  height?: number;
  /** How one value is spelled — per cent, bytes per second, a count. */
  format: (value: number) => string;
  /** The clock face for one column, for the hover line. */
  when: (at: number) => string;
  /** What a reader who cannot see the shape is told this chart is. */
  label: string;
  className?: string;
}) {
  const known = points.filter((point): point is { t: number; v: number } => point.v !== null);
  if (known.length < 2) return null;

  const top = Math.max(...known.map((point) => point.v)) || 1;
  const step = points.length > 1 ? WIDTH / (points.length - 1) : WIDTH;
  const floor = height - HEADROOM;
  const y = (value: number) => round(floor - (value / top) * (floor - HEADROOM));

  const runs: Array<Array<{ x: number; y: number }>> = [];
  let run: Array<{ x: number; y: number }> = [];
  points.forEach((point, index) => {
    if (point.v === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: round(index * step), y: y(point.v) });
  });
  if (run.length > 0) runs.push(run);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      className={cn('block w-full', className)}
      style={{ height }}
    >
      {runs.map((line, index) => (
        <path
          key={`fill-${index}`}
          d={`${trace(line)} L ${line[line.length - 1].x} ${height} L ${line[0].x} ${height} Z`}
          fill="var(--foreground)"
          fillOpacity={0.05}
        />
      ))}
      {runs.map((line, index) => (
        <path
          key={`line-${index}`}
          d={trace(line)}
          fill="none"
          stroke="var(--foreground)"
          strokeOpacity={0.7}
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <line
        x1={0}
        y1={height - 0.5}
        x2={WIDTH}
        y2={height - 0.5}
        stroke="var(--hairline)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {points.map((point, index) => (point.v === null ? null : (
        <rect
          key={point.t}
          x={round(index * step - step / 2)}
          y={0}
          width={round(step)}
          height={height}
          fill="transparent"
        >
          <title>{`${when(point.t)} · ${format(point.v)}`}</title>
        </rect>
      )))}
    </svg>
  );
}

function trace(line: ReadonlyArray<{ x: number; y: number }>): string {
  return line.map((at, index) => `${index === 0 ? 'M' : 'L'} ${at.x} ${at.y}`).join(' ');
}
