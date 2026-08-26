import type { MetricsDto } from './api';
import { sparkPath } from './lib/spark';

import { useState } from 'react';
import { formatBytes, timestamp } from './lib/format';
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

export function RateChart({
  points,
  summary,
  coverage,
}: {
  points: Array<RatePoint & { contributingIn?: number; contributingOut?: number; expected?: number | null }>;
  summary: string;
  coverage?: string;
}) {
  const width = 640;
  const height = 160;
  const pad = 8;
  const inPath = sparkPath(points.map((point) => point.inBps), width, height);
  const outPath = sparkPath(points.map((point) => point.outBps), width, height);
  const [hover, setHover] = useState<number | null>(null);
  const hovered = hover != null ? points[hover] : null;
  return (
    <figure className="rate-chart">
      <svg
        viewBox={`0 0 ${width} ${height + pad * 2}`}
        className="rate-svg"
        role="img"
        aria-label={summary}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - box.left;
          const index = Math.round((x / box.width) * Math.max(0, points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, index)));
        }}
      >
        {inPath && <path d={inPath} transform={`translate(0 ${pad})`} fill="none" stroke="var(--rate-down)" strokeWidth="1.8" />}
        {outPath && <path d={outPath} transform={`translate(0 ${pad})`} fill="none" stroke="var(--rate-up)" strokeWidth="1.8" />}
        {!inPath && !outPath && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fill="currentColor" fontSize="12">还没有可连起来的采样</text>
        )}
      </svg>
      <figcaption>
        <span className="rate-key"><i className="rate-swatch down" /> 下行</span>
        <span className="rate-key"><i className="rate-swatch up" /> 上行</span>
        {coverage && <span className="muted">{coverage}</span>}
        <p>{summary}</p>
        {hovered && (
          <p className="muted">
            {timestamp(hovered.t)}
            {hovered.inBps != null ? ` · 下行 ${formatBytes(hovered.inBps)}/s` : ' · 下行缺口'}
            {hovered.outBps != null ? ` · 上行 ${formatBytes(hovered.outBps)}/s` : ' · 上行缺口'}
            {hovered.expected != null ? ` · 下行 ${hovered.contributingIn ?? 0}/${hovered.expected} · 上行 ${hovered.contributingOut ?? 0}/${hovered.expected}` : ''}
          </p>
        )}
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
