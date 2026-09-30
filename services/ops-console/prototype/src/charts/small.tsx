import { useState } from 'react';
import type { Point } from '@proto/mock/series';
import { extent, linear, TONE_VAR, type Tone, useWidth } from './core';

/** A trend without axes, for table cells and stat cards. */
export function Spark({ points, color = 'var(--c1)', height = 24, width = 96, area = true, domain }: {
  points: Point[]; color?: string; height?: number; width?: number; area?: boolean; domain?: [number, number];
}) {
  const [lo, hi] = domain ?? extent(points.map((p) => p.v), 0.1);
  const x = linear(0, Math.max(1, points.length - 1), 1, width - 1);
  const y = linear(lo, hi, height - 1, 1);
  let d = '';
  points.forEach((p, i) => {
    if (p.v == null) return;
    d += `${d === '' ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      {area && d && <path d={`${d}L${width - 1},${height}L1,${height}Z`} fill={color} opacity={0.12} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  );
}

/** Stacked bars over categories or time buckets, with a hover readout. */
export function Bars({ data, colors, names, height = 160, format }: {
  data: { label: string; values: number[] }[];
  colors: string[];
  names: string[];
  height?: number;
  format: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.values.reduce((a, b) => a + Math.max(0, b), 0)));
  const bottom = 20;
  const innerH = height - bottom - 4;
  const slot = width / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(28, slot * 0.62));
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={width} y1={innerH + 4} y2={innerH + 4} stroke="var(--line)" />
          {data.map((d, i) => {
            let acc = 0;
            const cx = slot * i + slot / 2;
            return (
              <g key={d.label} onMouseEnter={() => setHover(i)}>
                <rect x={slot * i} y={0} width={slot} height={height} fill="transparent" />
                {d.values.map((v, k) => {
                  const h = (Math.max(0, v) / max) * innerH;
                  acc += h;
                  return <rect key={k} x={cx - bw / 2} y={innerH + 4 - acc} width={bw} height={Math.max(0, h - 1)} rx={2} fill={colors[k]} opacity={hover == null || hover === i ? 1 : 0.45} />;
                })}
                <text x={cx} y={height - 4} textAnchor="middle" fontSize={11} fill="var(--faint)">{d.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && (
        <div className="pointer-events-none absolute z-10 rounded-md border border-line bg-panel px-2.5 py-2 text-xs" style={{ left: Math.min(slot * hover + slot / 2 + 10, width - 160), top: 0, boxShadow: 'var(--shadow-pop)' }}>
          <div className="mb-1 text-faint">{data[hover].label}</div>
          {names.map((n, k) => (
            <div key={n} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm" style={{ background: colors[k] }} />
              <span className="text-muted">{n}</span>
              <span className="ml-auto pl-3 num">{format(data[hover].values[k])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One tick per probe; a gap is "not probed", never "dead". */
export function ProbeStrip({ probes, height = 16 }: { probes: ('alive' | 'dead' | null)[]; height?: number }) {
  return (
    <div className="flex items-end gap-px" style={{ height }} aria-label="探测记录">
      {probes.map((p, i) => (
        <span
          key={i}
          className={p == null ? 'hatch' : ''}
          style={{ width: 3, height: '100%', borderRadius: 1, background: p === 'alive' ? 'var(--ok)' : p === 'dead' ? 'var(--sev)' : undefined, opacity: p === 'alive' ? 0.7 : 1 }}
        />
      ))}
    </div>
  );
}

/** Rows × columns of intensity 0..max, e.g. 7 days × 24 hours of use. */
export function Heatmap({ rows, rowLabels, max = 60, cell = 14, color = 'var(--c1)' }: {
  rows: number[][]; rowLabels: string[]; max?: number; cell?: number; color?: string;
}) {
  return (
    <div className="inline-grid gap-1" style={{ gridTemplateColumns: `28px repeat(${rows[0]?.length ?? 0}, ${cell}px)` }}>
      {rows.map((row, r) => [
        <span key={`l${r}`} className="text-2xs text-faint leading-[14px]">{rowLabels[r]}</span>,
        ...row.map((v, c) => (
          <span key={`${r}:${c}`} title={`${rowLabels[r]} ${c}:00 · ${v} 分钟`} style={{ width: cell, height: cell, borderRadius: 3, background: v === 0 ? 'var(--hover)' : color, opacity: v === 0 ? 1 : 0.15 + 0.85 * (v / max) }} />
        )),
      ])}
      <span />
      {Array.from({ length: rows[0]?.length ?? 0 }, (_, c) => (
        <span key={`h${c}`} className="text-2xs text-faint text-center num">{c % 6 === 0 ? c : ''}</span>
      ))}
    </div>
  );
}

/** A horizontal gauge whose colour follows thresholds, e.g. quota use. */
export function Meter({ value, warn = 0.8, sev = 0.95, width = 96 }: { value: number | null; warn?: number; sev?: number; width?: number }) {
  if (value == null) return <span className="text-faint">不限</span>;
  const tone: Tone = value >= sev ? 'sev' : value >= warn ? 'warn' : 'ok';
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1.5 overflow-hidden rounded-full bg-hover" style={{ width }}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(1, value) * 100}%`, background: TONE_VAR[tone] }} />
      </span>
    </span>
  );
}
