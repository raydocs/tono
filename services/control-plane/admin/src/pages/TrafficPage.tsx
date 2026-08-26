import { RateChart } from '../charts';
import { formatBytes, timestamp } from '../lib/format';
import { parseTrafficRange } from '../lib/hash';
import { useOpsRoute } from '../lib/route';
import {
  aggregateFleetRates,
  coverageByBucket,
  latestValidRate,
  nodeRateSeries,
  rangeTransfer,
} from '../lib/traffic';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';
import { DataHealth, FilterChips, GlassCard, Unavailable } from '../ui';

const RANGES = [
  { id: '24h', label: '24 小时' },
  { id: '7d', label: '7 天' },
  { id: '90d', label: '90 天' },
];

export function TrafficPage() {
  const world = useOpsWorld();
  const privacy = usePrivacy();
  const { route, setRoute, openNode, openUser } = useOpsRoute();
  const range = parseTrafficRange(route.range);
  const metrics = world.metrics.state === 'ready' ? world.metrics.data : null;
  const expected = Object.keys(metrics?.series ?? {}).length || world.nodes.filter((node) => node.agent).length;
  const series = metrics
    ? Object.fromEntries(Object.entries(metrics.series).map(([name, points]) => [name, nodeRateSeries(points, metrics.resolutionSeconds)]))
    : {};
  const fleet = aggregateFleetRates(series, expected || Object.keys(series).length);
  const coverage = coverageByBucket(fleet);
  const latest = latestValidRate(fleet);
  const nowSec = world.nowSec;
  const stale = latest != null && nowSec - latest.t > (metrics?.resolutionSeconds ?? 60) * 3;
  const transfer = rangeTransfer(fleet);
  const top = Object.entries(series).map(([name, points]) => {
    const moved = rangeTransfer(points);
    const peak = points.reduce((max, point) => Math.max(max, point.inBps ?? 0, point.outBps ?? 0), 0);
    const complete = points.filter((point) => point.inBps != null || point.outBps != null).length;
    return { name, moved, peak, complete, total: points.length };
  }).sort((a, b) => (b.moved.inBytes ?? 0) + (b.moved.outBytes ?? 0) - ((a.moved.inBytes ?? 0) + (a.moved.outBytes ?? 0))).slice(0, 8);
  const customers = [...world.people].filter((person) => person.user).sort((a, b) => b.usageBytes - a.usageBytes);

  const summary = latest
    ? `${stale ? '最近有效采样' : '最近采样'} ${timestamp(latest.t)} · 下行 ${latest.inBps == null ? '缺口' : `${formatBytes(latest.inBps)}/s`} · 上行 ${latest.outBps == null ? '缺口' : `${formatBytes(latest.outBps)}/s`}`
    : '没有有效速率采样。累计计数器不能写成当前速度。';

  return (
    <div className="stack">
      <DataHealth sources={[
        { label: '机器时序', resource: world.metrics },
        { label: '客户用量', resource: world.users },
      ]} />
      <FilterChips
        value={range}
        options={RANGES}
        onChange={(id) => setRoute((current) => ({ ...current, page: 'traffic', range: id, node: current.node }))}
      />

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>机器流量总览</h2>
            <p>速率来自相邻累计点差分。回绕和缺口断线，不把缺失节点当成 0。</p>
          </div>
        </div>
        <div className="card-body">
          {world.metrics.state === 'error' && !world.metrics.refreshedAt ? (
            <Unavailable title="机器时序不可用" detail={world.metrics.state === 'error' ? world.metrics.message : undefined} />
          ) : !metrics ? (
            <p className="muted">时序还没回来。</p>
          ) : (
            <RateChart
              points={fleet}
              summary={`${summary} · 区间下行 ${transfer.inBytes == null ? '—' : formatBytes(transfer.inBytes)} · 上行 ${transfer.outBytes == null ? '—' : formatBytes(transfer.outBytes)}`}
              coverage={`覆盖最多 ${coverage.present}/${coverage.expected} 台`}
            />
          )}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>机器 Top</h2>
            <p>有效区间流量、峰值速率、完整度</p>
          </div>
        </div>
        <div className="card-body">
          <div className="lb">
            {top.map((row) => (
              <button type="button" className="lb-row" key={row.name} onClick={() => openNode(row.name, { page: 'monitor' })}>
                <span className="lb-email">{row.name}</span>
                <span className="muted">完整 {row.complete}/{row.total}</span>
                <span className="lb-value mono">↓ {row.moved.inBytes == null ? '—' : formatBytes(row.moved.inBytes)} · 峰值 {row.peak ? `${formatBytes(row.peak)}/s` : '—'}</span>
              </button>
            ))}
            {top.length === 0 && <p className="muted">没有可排序的机器时序。</p>}
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>客户本期累计</h2>
            <p>没有客户级小时数据，不画线。</p>
          </div>
        </div>
        <div className="card-body">
          {world.users.state === 'error' && !world.users.refreshedAt ? (
            <Unavailable title="客户用量不可用" detail={world.users.state === 'error' ? world.users.message : undefined} />
          ) : (
            <div className="lb">
              {customers.slice(0, 12).map((person) => (
                <button type="button" className="lb-row" key={person.userId} onClick={() => openUser(person.userId)}>
                  <span className="lb-email">{privacy.email(person.email)}</span>
                  <span className="lb-value mono">
                    {formatBytes(person.usageBytes)}
                    {person.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(person.quotaBytes)}`}
                    {person.quotaRatio != null ? ` · ${Math.round(person.quotaRatio * 100)}%` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </GlassCard>

      <GlassCard className="unavailable-card">
        <div className="card-body">
          <h2>客户小时趋势尚不可用</h2>
          <p className="muted">当前只保存本期累计，没有客户级小时数据。这里不会画假线。</p>
        </div>
      </GlassCard>
    </div>
  );
}
