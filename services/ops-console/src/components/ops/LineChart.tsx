import { useId, useMemo, type PointerEvent } from 'react';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';
import { ChartTip, Legend, type TipRow } from './ChartTip';
import { axisTicks, extent, labelWidth, linear, nearestIndex, seriesColor, splitRuns, timeTicks, type AxisScale } from './chart-scale';
import type { Tone } from './StatusWord';
import type { SeriesPoint } from './TimeSeries';
import { useCursor, useWidth } from './use-chart';

export type LineSeries = {
  key: string;
  name: string;
  points: readonly SeriesPoint[];
  /** A series that is itself a verdict (errors, failures) takes a tone; the rest take a categorical colour. */
  tone?: Tone;
};

/** A horizontal rule at a threshold the reader should compare against, such as an alert line. */
export type Guide = { value: number; label: string; tone: Tone };

const TOP = 10;
const BOTTOM = 22;
const RIGHT = 8;
const MIN_TICK_GAP = 110;

function px(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Several measurements over one time axis, with the axes a reader needs to
 * quote a number out loud.
 *
 * `TimeSeries` stays the glance: one line, no axis, in a table cell or under
 * a card. This is the chart a panel is built around. Round ticks on the value
 * axis, wall-clock ticks on the time axis, a readout per column on hover or
 * from the keyboard, and a gap left as a gap (R2) — a series that stopped
 * reporting breaks, and a lone measurement between two holes is drawn as a
 * dot rather than vanishing.
 *
 * Every string on the chart comes from the caller's `format`, `when` and
 * `tick`, which should be the helpers in `lib/display`; the chart only does
 * geometry.
 */
export function LineChart({
  series,
  height = 180,
  format,
  when,
  tick,
  tickOffsetSec,
  label,
  guides = [],
  domain,
  scale = 'linear',
  className,
}: {
  series: readonly LineSeries[];
  height?: number;
  format: (value: number) => string;
  /** The full time for the readout heading. */
  when: (atSec: number) => string;
  /** The short time under an axis tick. */
  tick: (atSec: number) => string;
  /** Daily UTC buckets use 0; event charts default to the operator's offset. */
  tickOffsetSec?: number;
  /** What a reader who cannot see the chart is told it shows. */
  label: string;
  guides?: readonly Guide[];
  domain?: [number, number];
  /** `bytes` puts value ticks on round KB, MB, GB; `minutes` on round hours past three of them. */
  scale?: AxisScale;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const hintId = useId();

  const times = useMemo(
    () => [...new Set(series.flatMap((line) => line.points.map((point) => point.t)))].sort((a, b) => a - b),
    [series],
  );
  const lookup = useMemo(
    () => series.map((line) => new Map(line.points.map((point) => [point.t, point.v]))),
    [series],
  );
  const cursor = useCursor(times.length);

  const values = series.flatMap((line) => line.points.map((point) => point.v));
  const knownCount = values.filter((value) => value !== null).length;
  if (knownCount < 2 || times.length < 2) {
    return (
      <div className={cn('flex items-center text-fine', className)} style={{ height }}>
        {copy.chartNoData}
      </div>
    );
  }

  const [lo, hi] = domain ?? extent([...values, ...guides.map((guide) => guide.value)]);
  const yTicks = axisTicks(scale, lo, hi, height >= 160 ? 4 : 3);
  const yMin = Math.min(lo, yTicks[0] ?? lo);
  const yMax = Math.max(hi, yTicks[yTicks.length - 1] ?? hi);
  const left = Math.max(...yTicks.map((value) => labelWidth(format(value)))) + 12;
  const t0 = times[0] ?? 0;
  const t1 = times[times.length - 1] ?? t0;
  const x = linear(t0, t1, left, width - RIGHT);
  const y = linear(yMin, yMax, height - BOTTOM, TOP);
  const xTicks = timeTicks(t0, t1, Math.max(2, Math.floor((width - left) / MIN_TICK_GAP)), tickOffsetSec);

  const at = cursor.index === null ? null : times[cursor.index] ?? null;
  const rows: TipRow[] = at === null ? [] : series.map((line, index) => {
    const value = lookup[index]?.get(at);
    return {
      key: line.key,
      name: line.name,
      value: value == null ? copy.missing : format(value),
      index,
      tone: line.tone,
    };
  });

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const t = linear(left, width - RIGHT, t0, t1)(event.clientX - box.left);
    cursor.setIndex(nearestIndex(times, t));
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        ref={ref}
        className="chart-frame"
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={hintId}
        onKeyDown={cursor.onKeyDown}
        onBlur={cursor.clear}
      >
        <span id={hintId} className="sr-only">{copy.chartKeys}</span>
        {width > 0 ? (
          <svg width={width} height={height} aria-hidden onPointerMove={onPointerMove} onPointerLeave={cursor.clear}>
            {yTicks.map((value) => (
              <g key={value}>
                <line
                  x1={left}
                  x2={width - RIGHT}
                  y1={px(y(value))}
                  y2={px(y(value))}
                  stroke={value === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                  strokeDasharray={value === 0 ? undefined : '2 3'}
                />
                <text
                  x={left - 8}
                  y={px(y(value))}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                  className="font-mono"
                >
                  {format(value)}
                </text>
              </g>
            ))}
            {xTicks.map((atSec) => (
              <text
                key={atSec}
                x={px(x(atSec))}
                y={height - 6}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
                className="font-mono"
              >
                {tick(atSec)}
              </text>
            ))}
            {guides.map((guide) => (
              <g key={`${guide.label}-${guide.value}`} className={`tone-${guide.tone}`}>
                <line
                  x1={left}
                  x2={width - RIGHT}
                  y1={px(y(guide.value))}
                  y2={px(y(guide.value))}
                  stroke="var(--tone-ink)"
                  strokeDasharray="4 3"
                />
                <text
                  x={width - RIGHT}
                  y={px(y(guide.value)) - 4}
                  textAnchor="end"
                  fontSize={11}
                  className="chart-guide-label"
                >
                  {guide.label}
                </text>
              </g>
            ))}
            {series.map((line, index) => (
              <g
                key={line.key}
                className={line.tone ? `tone-${line.tone}` : undefined}
                style={{ color: line.tone ? 'var(--tone-ink)' : seriesColor(index) }}
              >
                {splitRuns(line.points, (point) => point.v === null).map((run) => (
                  run.length === 1 ? (
                    <circle key={run[0].t} cx={px(x(run[0].t))} cy={px(y(run[0].v ?? 0))} r={2} fill="currentColor" />
                  ) : (
                    <path
                      key={run[0].t}
                      d={run.map((point, step) => `${step === 0 ? 'M' : 'L'}${px(x(point.t))},${px(y(point.v ?? 0))}`).join('')}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )
                ))}
              </g>
            ))}
            {at !== null ? (
              <g>
                <line x1={px(x(at))} x2={px(x(at))} y1={TOP} y2={height - BOTTOM} stroke="var(--chart-cursor)" />
                {series.map((line, index) => {
                  const value = lookup[index]?.get(at);
                  if (value == null) return null;
                  return (
                    <circle
                      key={line.key}
                      cx={px(x(at))}
                      cy={px(y(value))}
                      r={3.5}
                      fill="var(--surface)"
                      strokeWidth={2}
                      className={line.tone ? `tone-${line.tone}` : undefined}
                      stroke={line.tone ? 'var(--tone-ink)' : seriesColor(index)}
                    />
                  );
                })}
              </g>
            ) : null}
          </svg>
        ) : null}
        {at !== null ? <ChartTip heading={when(at)} rows={rows} x={x(at)} width={width} /> : null}
        <span className="sr-only" aria-live="polite">
          {at === null ? '' : copy.chartReadout(when(at), rows)}
        </span>
      </div>
      <Legend items={series} label={copy.chartLegend} />
    </div>
  );
}
