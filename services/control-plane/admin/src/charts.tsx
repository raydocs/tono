import type { MetricsDto } from './api';
import { sparkPath } from './lib/spark';

import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatDuration, timestamp } from './lib/format';
import type { RatePoint } from './lib/traffic';

export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const d = sparkPath(values, 160, 36);
  if (!d) return <span className="muted">还没有{label}记录</span>;
  return (
    <svg className="sparkline" viewBox="0 0 160 36" width="160" height="36" aria-label={label} role="img">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const RATE_H = 200;
const PAD_L = 58;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 22;

/** Round the axis top up to 1/2/5 × 2^n so the labels are readable byte sizes. */
function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const unit = 1024 ** Math.floor(Math.log2(max) / 10);
  const scaled = max / unit;
  const step = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 700, 1024]
    .find((value) => value >= scaled) ?? 1024;
  return step * unit;
}

function clockLabel(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * The fleet rate chart.
 *
 * It only ever draws what `points` contains: a null bucket is a gap in the
 * counter differencing, so the line breaks there instead of bridging it, and
 * the gap is shaded rather than filled. The y axis starts at zero because a
 * min-anchored axis makes a flat 30 KB/s line look like a cliff.
 */
export function RateChart({
  points,
  summary,
  coverage,
  latestIn,
  latestOut,
  spanSeconds,
}: {
  points: Array<RatePoint & { contributingIn?: number; contributingOut?: number; expected?: number | null }>;
  summary: string;
  coverage?: string;
  latestIn?: number | null;
  latestOut?: number | null;
  spanSeconds?: number;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  // One SVG unit = one CSS pixel. Without this the viewBox scales the axis
  // labels down with the container and they become unreadable on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [RATE_W, setRateW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setRateW(Math.max(300, Math.round(width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const usable = points.filter((point) => point.inBps != null || point.outBps != null);
  if (usable.length < 2) {
    return (
      <figure className="rate-chart">
        <div className="rate-canvas" ref={box} />
        <div className="rate-empty">
          <strong>还没有可连起来的采样</strong>
          <span>{usable.length === 0 ? '这个区间里没有任何合法差分。' : '只有一个合法差分点，两点之间才有速率。'}</span>
        </div>
        <p className="rate-foot">{summary}</p>
      </figure>
    );
  }

  const values = points.flatMap((point) => [point.inBps, point.outBps]).filter((v): v is number => v != null);
  const rawMax = Math.max(...values, 0);
  const yMax = niceMax(rawMax);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = t1 - t0 || 1;
  const plotW = RATE_W - PAD_L - PAD_R;
  const plotH = RATE_H - PAD_T - PAD_B;
  const x = (t: number) => PAD_L + ((t - t0) / span) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / yMax) * plotH;

  function seriesPath(pick: (p: RatePoint) => number | null): string {
    const parts: string[] = [];
    let drawing = false;
    for (const point of points) {
      const value = pick(point);
      if (value == null || !Number.isFinite(value)) { drawing = false; continue; }
      parts.push(`${drawing ? 'L' : 'M'}${x(point.t).toFixed(1)},${y(value).toFixed(1)}`);
      drawing = true;
    }
    return parts.length >= 2 ? parts.join(' ') : '';
  }

  const inPath = seriesPath((p) => p.inBps);
  const outPath = seriesPath((p) => p.outBps);
  const wide = span > 3 * 24 * 3600;
  const short = spanSeconds != null && span < spanSeconds * 0.5;
  const xLabel = wide ? dayLabel : clockLabel;
  const ticks = [0, yMax / 2, yMax];
  const hovered = cursor != null ? points[cursor] : null;

  /** Nearest sample to an x position in SVG units. */
  function indexAt(px: number): number {
    const t = t0 + ((px - PAD_L) / plotW) * span;
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    }
    return best;
  }
  function svgX(event: { clientX: number; currentTarget: Element }): number {
    const box = event.currentTarget.getBoundingClientRect();
    return ((event.clientX - box.left) / box.width) * RATE_W;
  }
  function step(delta: number) {
    setLocked(true);
    setCursor((value) => {
      const next = (value ?? points.length - 1) + delta;
      return Math.max(0, Math.min(points.length - 1, next));
    });
  }
  function readout(point: typeof points[number]): string {
    return [
      timestamp(point.t),
      point.inBps != null ? `下行 ${formatBytes(point.inBps)}/s` : '下行缺口',
      point.outBps != null ? `上行 ${formatBytes(point.outBps)}/s` : '上行缺口',
      point.expected != null ? `下行 ${point.contributingIn ?? 0}/${point.expected} 台 · 上行 ${point.contributingOut ?? 0}/${point.expected} 台` : '',
    ].filter(Boolean).join(' · ');
  }

  // Buckets where neither direction produced a legal delta: shade them so the
  // hole is visible rather than being read as a quiet period.
  const gaps: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].inBps != null || points[i].outBps != null) continue;
    const from = i === 0 ? points[0].t : points[i - 1].t;
    const to = i === points.length - 1 ? points[i].t : points[i + 1].t;
    const last = gaps[gaps.length - 1];
    if (last && from <= last.to) last.to = to;
    else gaps.push({ from, to });
  }

  return (
    <figure className="rate-chart">
      <div className="rate-canvas" ref={box}>
      {/* Pointer, not mouse: a tap locks a sample, a drag moves it, and the
          arrow keys do the same thing without any pointer at all. Hover alone
          would leave the chart unreadable on a phone. */}
      <svg
        viewBox={`0 0 ${RATE_W} ${RATE_H}`}
        width={RATE_W}
        height={RATE_H}
        className={`rate-svg${locked ? ' rate-svg-locked' : ''}`}
        role="img"
        tabIndex={0}
        aria-label={`${summary}。用左右方向键逐点查看。`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const next = indexAt(svgX(event));
          // Tapping the locked sample again releases it; anything else locks.
          if (locked && cursor === next) { setLocked(false); setCursor(null); }
          else { setLocked(true); setCursor(next); }
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse' && !locked) { setCursor(indexAt(svgX(event))); return; }
          if (event.buttons === 0) return;
          setCursor(indexAt(svgX(event)));
        }}
        onPointerLeave={() => { if (!locked) setCursor(null); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
          else if (event.key === 'Home') { event.preventDefault(); setLocked(true); setCursor(0); }
          else if (event.key === 'End') { event.preventDefault(); setLocked(true); setCursor(points.length - 1); }
          else if (event.key === 'Escape') { setLocked(false); setCursor(null); }
        }}
        onBlur={() => { if (!locked) setCursor(null); }}
      >
        {gaps.map((gap, index) => (
          <rect
            key={`gap-${index}`}
            x={x(gap.from)} y={PAD_T}
            width={Math.max(1, x(gap.to) - x(gap.from))} height={plotH}
            fill="currentColor" opacity="0.06"
          />
        ))}
        {ticks.map((value) => (
          <g key={value}>
            <line className="rate-grid" x1={PAD_L} x2={RATE_W - PAD_R} y1={y(value)} y2={y(value)} />
            <text className="rate-axis-text" x={PAD_L - 6} y={y(value) + 3} textAnchor="end">
              {value === 0 ? '0' : `${formatBytes(value)}/s`}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((frac) => (
          <text key={frac} className="rate-axis-text" x={PAD_L + frac * plotW} y={RATE_H - 6} textAnchor={frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle'}>
            {xLabel(t0 + frac * span)}
          </text>
        ))}
        {inPath && <path d={inPath} fill="none" stroke="var(--rate-down)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {outPath && <path d={outPath} fill="none" stroke="var(--rate-up)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 3" />}
        {hovered && (
          <>
            <line className="rate-cursor" x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD_T} y2={PAD_T + plotH} />
            {hovered.inBps != null && <circle className="rate-knob rate-knob-down" cx={x(hovered.t)} cy={y(hovered.inBps)} r="4" />}
            {hovered.outBps != null && <circle className="rate-knob rate-knob-up" cx={x(hovered.t)} cy={y(hovered.outBps)} r="4" />}
          </>
        )}
      </svg>
      </div>
      <figcaption className="rate-foot">
        <div className="rate-legend">
          <span className="rate-key"><i className="rate-swatch down" /> 下行<strong>{latestIn == null ? ' —' : ` ${formatBytes(latestIn)}/s`}</strong></span>
          <span className="rate-key"><i className="rate-swatch up" /> 上行<strong>{latestOut == null ? ' —' : ` ${formatBytes(latestOut)}/s`}</strong></span>
          <span className="rate-key">纵轴 字节/秒 · 横轴 {wide ? '日期' : '时间'}</span>
          {gaps.length > 0 && <span className="rate-key">阴影 = 该桶没有合法差分</span>}
          {short && <span className="rate-key">这个区间里只有 {formatDuration(span)}的采样</span>}
        </div>
        {coverage && <p className="muted">{coverage}</p>}
        <p className="rate-read">{summary}</p>
        {/* The readout is a live region so the selected sample is announced,
            and it stays put so a locked point can be read without a pointer. */}
        <p className={`rate-sample${hovered ? ' is-on' : ''}`} role="status" aria-live="polite">
          {hovered
            ? <>
              <span className={`pill-count ${locked ? 't-info' : 't-unknown'}`}>{locked ? '已锁定' : '悬停'}</span>
              <span className="rate-sample-text">{readout(hovered)}</span>
              {locked && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLocked(false); setCursor(null); }}>取消</button>}
            </>
            : <span className="rate-sample-text">点一下图上任意位置锁定一个采样点，拖动或用左右方向键换点。</span>}
        </p>
      </figcaption>
    </figure>
  );
}

export function AgentTrends({ metrics }: { metrics: MetricsDto }) {
  const names = Object.keys(metrics.series).sort((a, b) => a.localeCompare(b, 'zh'));
  if (names.length === 0) {
    return (
      <section className="card">
        <div className="card-header">
          <div>
            <h2>24 小时趋势</h2>
            <p>每分钟记一次。刚部署，还没有历史数据。</p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>24 小时趋势</h2>
          <p>分辨率 {metrics.resolutionSeconds >= 3600 ? '1 小时' : metrics.resolutionSeconds >= 300 ? '5 分钟' : '1 分钟'}</p>
        </div>
      </div>
      <div className="card-body">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>节点</th>
                <th>CPU</th>
                <th>内存</th>
                <th>负载</th>
                <th>点数</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name) => {
                const points = metrics.series[name];
                const mem = points.map((point) => (
                  point.memUsed != null && point.memTotal
                    ? (point.memUsed / point.memTotal) * 100
                    : null
                ));
                return (
                  <tr key={name}>
                    <td><strong>{name}</strong></td>
                    <td><Sparkline values={points.map((point) => point.cpu)} label={`${name} CPU`} /></td>
                    <td><Sparkline values={mem} label={`${name} 内存`} /></td>
                    <td><Sparkline values={points.map((point) => point.load1)} label={`${name} 负载`} /></td>
                    <td className="mono">{points.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
