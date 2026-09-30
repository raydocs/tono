import { useMemo, useState } from 'react';
import { time, dateTime } from '@proto/format';
import type { Point } from '@proto/mock/series';
import { extent, linear, niceTicks, TONE_VAR, type Tone, useWidth } from './core';

export type LineSeries = {
  name: string;
  color: string;
  points: Point[];
  area?: boolean;
  dashed?: boolean;
};

type Props = {
  series: LineSeries[];
  height?: number;
  format: (v: number) => string;
  domain?: [number, number];
  /** Horizontal guide lines, e.g. an SLO target. */
  guides?: { value: number; label: string; tone?: Tone }[];
  /** Shaded time windows, e.g. an open incident. */
  bands?: { from: number; to: number; tone: Tone; label?: string }[];
  longRange?: boolean;
  /** Counts: ticks land on whole numbers only. */
  integer?: boolean;
};

const PAD = { top: 8, right: 8, bottom: 22 };

/**
 * The one time-series chart. Hovering anywhere draws a crosshair and lists
 * every series at that instant, the way Grafana does; nulls break the line
 * rather than being drawn as zero.
 */
export function LineChart({ series, height = 180, format, domain, guides = [], bands = [], longRange, integer }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const times = series[0]?.points.map((p) => p.at) ?? [];
  const [lo, hi] = useMemo(() => domain ?? extent(series.flatMap((s) => s.points.map((p) => p.v)).concat(guides.map((g) => g.value))), [series, domain, guides]);
  const yTicks = niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi && (!integer || Number.isInteger(t)));
  const left = Math.max(32, Math.max(...yTicks.map((t) => format(t).length)) * 6.8 + 14);
  const innerW = Math.max(0, width - left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = linear(times[0] ?? 0, times[times.length - 1] ?? 1, left, left + innerW);
  const y = linear(lo, hi, PAD.top + innerH, PAD.top);
  const xTicks = times.filter((_, i) => i % Math.ceil(times.length / 6) === 0);

  function path(points: Point[], closeArea: boolean) {
    let d = '';
    let open = false;
    let firstX = 0;
    let lastX = 0;
    const segments: string[] = [];
    for (const p of points) {
      if (p.v == null) {
        if (open && closeArea) segments.push(`${d}L${lastX},${y(lo)}L${firstX},${y(lo)}Z`);
        else if (open) segments.push(d);
        d = ''; open = false; continue;
      }
      const px = x(p.at);
      const py = y(Math.min(hi, Math.max(lo, p.v)));
      if (!open) { d = `M${px},${py}`; firstX = px; open = true; } else d += `L${px},${py}`;
      lastX = px;
    }
    if (open) segments.push(closeArea ? `${d}L${lastX},${y(lo)}L${firstX},${y(lo)}Z` : d);
    return segments.join(' ');
  }

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (px < left || px > left + innerW || times.length === 0) { setHover(null); return; }
    const t = times[0] + ((px - left) / innerW) * (times[times.length - 1] - times[0]);
    let best = 0;
    for (let i = 1; i < times.length; i += 1) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    setHover(best);
  }

  const hx = hover != null ? x(times[hover]) : 0;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
          {bands.map((b, i) => (
            <rect key={i} x={x(Math.max(b.from, times[0]))} y={PAD.top} width={Math.max(0, x(Math.min(b.to, times[times.length - 1])) - x(Math.max(b.from, times[0])))} height={innerH} fill={TONE_VAR[b.tone]} opacity={0.08} />
          ))}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + innerW} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === yTicks[0] ? undefined : '2 3'} />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--faint)" className="num">{format(t)}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--faint)" className="num">{longRange ? dateTime(t).split(' ')[0] : time(t)}</text>
          ))}
          {guides.map((g) => (
            <g key={g.label}>
              <line x1={left} x2={left + innerW} y1={y(g.value)} y2={y(g.value)} stroke={TONE_VAR[g.tone ?? 'idle']} strokeDasharray="4 4" strokeWidth={1} />
              <text x={left + innerW - 4} y={y(g.value) - 4} textAnchor="end" fontSize={11} fill={TONE_VAR[g.tone ?? 'idle']}>{g.label}</text>
            </g>
          ))}
          {series.map((s) => (
            <g key={s.name}>
              {s.area && <path d={path(s.points, true)} fill={s.color} opacity={0.1} />}
              <path d={path(s.points, false)} fill="none" stroke={s.color} strokeWidth={1.5} strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" />
            </g>
          ))}
          {hover != null && (
            <g>
              <line x1={hx} x2={hx} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--line-strong)" />
              {series.map((s) => s.points[hover]?.v != null && (
                <circle key={s.name} cx={hx} cy={y(s.points[hover].v!)} r={3} fill="var(--panel)" stroke={s.color} strokeWidth={1.5} />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover != null && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-line bg-panel px-2.5 py-2 text-xs"
          style={{ left: Math.min(hx + 12, width - 170), top: 4, boxShadow: 'var(--shadow-pop)' }}
        >
          <div className="mb-1 text-faint num">{dateTime(times[hover])}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-muted">{s.name}</span>
              <span className="ml-auto pl-3 num">{s.points[hover]?.v == null ? '未测到' : format(s.points[hover].v!)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
