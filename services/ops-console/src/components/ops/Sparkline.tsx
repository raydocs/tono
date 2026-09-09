import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import type { MetricSeries } from './measured';

/**
 * A trend, not a chart: no axes, no grid, no legend, one colour taken from the
 * surrounding tone at 40% (`--tone-wash`). Absent or single-point series
 * render nothing at all rather than an empty frame — a flat placeholder line
 * would read as "measured and flat", which is the lie R2 exists to prevent.
 */
export function Sparkline({
  series,
  height = 28,
  className,
}: {
  series?: MetricSeries | null;
  height?: number;
  className?: string;
}) {
  const points = (series?.points ?? []).map((v, i) => ({ i, v }));
  const known = points.map((p) => p.v).filter((v): v is number => v !== null && v !== undefined);
  if (known.length < 2) return null;

  // A domain of [0, max] turns a week of similar days into a filled block. The
  // padded domain below keeps the silhouette readable without pretending the
  // baseline is zero — this is a shape, not a chart to read values off.
  const low = Math.min(...known);
  const high = Math.max(...known);
  const spread = high - low || Math.abs(high) || 1;

  return (
    <div className={cn('w-full', className)} style={{ height }} aria-hidden data-spark="">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 1, right: 0, left: 0, bottom: 0 }}>
          <YAxis hide domain={[low - spread * 0.6, high + spread * 0.25]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke="var(--tone-wash)"
            fill="var(--tone-wash)"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
