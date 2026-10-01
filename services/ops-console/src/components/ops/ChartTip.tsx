import type { Tone } from './StatusWord';
import { seriesColor } from './chart-scale';

export type TipRow = { key: string; name: string; value: string; index: number; tone?: Tone };

/** The colour key for one series: a tone when it has one, otherwise its categorical slot. */
export function Swatch({ index, tone }: { index: number; tone?: Tone }) {
  return (
    <span
      aria-hidden
      className={tone ? `chart-swatch tone-${tone}` : 'chart-swatch'}
      style={{ background: tone ? 'var(--tone-ink)' : seriesColor(index) }}
    />
  );
}

/**
 * The readout for one column. It sits beside the cursor and flips to the
 * other side near the right edge rather than being clipped by the panel.
 */
export function ChartTip({
  heading,
  rows,
  x,
  width,
}: {
  heading: string;
  rows: readonly TipRow[];
  x: number;
  width: number;
}) {
  const flip = x > width - 170;
  return (
    <div
      className="chart-tip"
      style={flip ? { right: Math.max(0, width - x + 10), top: 0 } : { left: x + 10, top: 0 }}
    >
      <div className="mb-1 font-mono text-[var(--muted-foreground)]">{heading}</div>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2">
          <Swatch index={row.index} tone={row.tone} />
          <span className="text-[var(--muted-foreground)]">{row.name}</span>
          <span className="ml-auto pl-3 font-mono">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** A row of swatches under a multi-series chart. One series needs no key. */
export function Legend({ items, label }: { items: readonly { key: string; name: string; tone?: Tone }[]; label: string }) {
  if (items.length < 2) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1 text-fine">
      {items.map((item, index) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <Swatch index={index} tone={item.tone} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}
