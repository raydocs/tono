import { useId, type PointerEvent } from 'react';
import { copy } from '@/copy/copy';
import { cn } from '@/lib/utils';
import { ChartTip, Legend, type TipRow } from './ChartTip';
import { axisTicks, linear, seriesColor, type AxisScale } from './chart-scale';
import type { Tone } from './StatusWord';
import { useCursor, useWidth } from './use-chart';

export type BarStack = { key: string; name: string; tone?: Tone };
/** One column. `null` in `values` is not measured and adds nothing to the stack. */
export type BarColumn = { key: string; label: string; values: ReadonlyArray<number | null> };

const TOP = 10;
const BOTTOM = 22;
const LABEL_PX = 6.6;
const MIN_LABEL_GAP = 44;

function px(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Stacked bars over categories or calendar buckets — revenue by month,
 * sessions by exit, bytes by day — with a value axis and a readout per column.
 *
 * Column labels are thinned when they would collide rather than rotated: a
 * label at 45° is read by tilting your head, and nobody does. Every string on
 * the chart comes from the caller's `format` and the column labels, which
 * should come from `lib/display`.
 */
export function Bars({
  columns,
  stacks,
  format,
  label,
  height = 180,
  scale = 'linear',
  className,
}: {
  columns: readonly BarColumn[];
  stacks: readonly BarStack[];
  format: (value: number) => string;
  label: string;
  height?: number;
  /** `bytes` puts value ticks on round multiples of KB, MB, GB. */
  scale?: AxisScale;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const hintId = useId();
  const cursor = useCursor(columns.length);

  const totals = columns.map((column) => column.values.reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0));
  const ticks = axisTicks(scale, 0, Math.max(1, ...totals), height >= 160 ? 4 : 3);
  const max = ticks[ticks.length - 1];
  const left = Math.ceil(Math.max(...ticks.map((value) => format(value).length)) * LABEL_PX) + 12;
  const y = linear(0, max, height - BOTTOM, TOP);
  const slot = (width - left) / Math.max(1, columns.length);
  const barWidth = Math.max(3, Math.min(28, slot * 0.62));
  const labelEvery = Math.max(1, Math.ceil(MIN_LABEL_GAP / Math.max(1, slot)));

  const hover = cursor.index;
  const rows: TipRow[] = hover === null ? [] : stacks.map((stack, index) => {
    const value = columns[hover].values[index];
    return { key: stack.key, name: stack.name, value: value == null ? copy.missing : format(value), index, tone: stack.tone };
  });

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - left) / slot);
    cursor.setIndex(index >= 0 && index < columns.length ? index : null);
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
            {ticks.map((value) => (
              <g key={value}>
                <line
                  x1={left}
                  x2={width}
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
            {columns.map((column, index) => {
              const cx = left + slot * index + slot / 2;
              let base = 0;
              return (
                <g key={column.key}>
                  {hover === index ? (
                    <rect x={px(left + slot * index)} y={TOP} width={px(slot)} height={height - BOTTOM - TOP} fill="var(--hover-wash)" />
                  ) : null}
                  {column.values.map((value, k) => {
                    if (value == null || value <= 0) return null;
                    const y0 = y(base);
                    base += value;
                    const y1 = y(base);
                    const stack = stacks[k];
                    return (
                      <rect
                        key={stack?.key ?? k}
                        x={px(cx - barWidth / 2)}
                        y={px(y1)}
                        width={px(barWidth)}
                        height={Math.max(0, px(y0 - y1 - 1))}
                        rx={2}
                        className={stack?.tone ? `tone-${stack.tone}` : undefined}
                        fill={stack?.tone ? 'var(--tone-ink)' : seriesColor(k)}
                        opacity={hover === null || hover === index ? 1 : 0.5}
                      />
                    );
                  })}
                  {index % labelEvery === 0 ? (
                    <text x={px(cx)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
                      {column.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        ) : null}
        {hover !== null ? (
          <ChartTip heading={columns[hover].label} rows={rows} x={left + slot * hover + slot / 2} width={width} />
        ) : null}
        <span className="sr-only" aria-live="polite">
          {hover === null ? '' : copy.chartReadout(columns[hover].label, rows)}
        </span>
      </div>
      <Legend items={stacks} label={copy.chartLegend} />
    </div>
  );
}
