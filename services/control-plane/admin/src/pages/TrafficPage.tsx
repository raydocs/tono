import { RateChart } from '../charts';
import { formatBytes, timestamp } from '../lib/format';
import { parseTrafficRange } from '../lib/hash';
import { metricsForRange } from '../lib/metrics-bind';
import { useOpsRoute } from '../lib/route';
import {
  aggregateFleetRates,
  coverageByBucket,
  fleetByteTransfer,
  latestValidRate,
  nodeByteTransfer,
  nodeRateSeries,
} from '../lib/traffic';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';
import { DataHealth, FilterChips, GlassCard, Skeleton, Unavailable } from '../ui';

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
  const bound = metricsForRange(range, world.metrics.snapshotKey, world.metrics.state === 'ready' ? world.metrics.data : null);
  const agentKnown = world.sources.agents.status === 'current' || world.sources.agents.status === 'stale';
  const expected = agentKnown
    ? world.nodes.filter((node) => node.agentState === 'reported' || node.agentState === 'stale').length
    : null;
  const series = bound
    ? Object.fromEntries(Object.entries(bound.series).map(([name, points]) => [name, nodeRateSeries(points, bound.resolutionSeconds)]))
    : {};
  const fleet = aggregateFleetRates(series, expected);
  const coverage = coverageByBucket(fleet);
  const latest = latestValidRate(fleet);
  const nowSec = world.nowSec;
  const stale = latest != null && nowSec - latest.t > (bound?.resolutionSeconds ?? 60) * 3;
  const transfer = bound ? fleetByteTransfer(bound.series, bound.resolutionSeconds) : { inBytes: null, outBytes: null };
  const top = bound
    ? Object.entries(bound.series).map(([name, points]) => {
      const moved = nodeByteTransfer(points, bound.resolutionSeconds);
      const rates = nodeRateSeries(points, bound.resolutionSeconds);
      const peakIn = rates.reduce((max, point) => Math.max(max, point.inBps ?? 0), 0);
      const peakOut = rates.reduce((max, point) => Math.max(max, point.outBps ?? 0), 0);
      const complete = rates.filter((point) => point.inBps != null || point.outBps != null).length;
      return { name, moved, peakIn, peakOut, complete, total: rates.length };
    }).sort((a, b) => (b.moved.inBytes ?? 0) + (b.moved.outBytes ?? 0) - ((a.moved.inBytes ?? 0) + (a.moved.outBytes ?? 0))).slice(0, 8)
    : [];
  const customers = [...world.people].filter((person) => person.user).sort((a, b) => b.usageBytes - a.usageBytes);

  // "1/11" is only meaningful once it says what the two numbers count.
  const coverageText = expected == null
    ? '上报台数未知：探针源不可用，无法说明这条线代表几台机器。'
    : expected === 0
      ? '当前没有在上报的探针机器，这条线不代表任何机器。'
      : `覆盖：${expected} 台在上报的机器里，任一时刻最多 ${coverage.inPresent} 台给出下行差分、${coverage.outPresent} 台给出上行差分。其余机器在这个区间没有可用的相邻累计点，不是 0。`;
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
            <p>速率来自相邻累计点差分。区间字节按每台机器自己的合法 delta 相加。</p>
          </div>
        </div>
        <div className="card-body">
          {world.metrics.state === 'error' && world.metrics.snapshotKey !== range ? (
            <Unavailable title="这个时间范围不可用" detail={world.metrics.state === 'error' ? world.metrics.message : undefined} />
          ) : !bound ? (
            <Skeleton label={`${range} 时序加载中，不会拿其他范围冒充`} />
          ) : (
            <RateChart
              points={fleet}
              summary={`${summary} · 区间下行 ${transfer.inBytes == null ? '—' : formatBytes(transfer.inBytes)} · 上行 ${transfer.outBytes == null ? '—' : formatBytes(transfer.outBytes)}`}
              coverage={coverageText}
              latestIn={latest?.inBps ?? null}
              latestOut={latest?.outBps ?? null}
              spanSeconds={range === '90d' ? 90 * 86400 : range === '7d' ? 7 * 86400 : 86400}
            />
          )}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>机器 Top</h2>
            <p>按区间下行+上行合计排序</p>
          </div>
        </div>
        <div className="card-body">
          <div className="traffic-top">
            {top.map((row) => (
              <button type="button" className="traffic-row" key={row.name} onClick={() => openNode(row.name, { page: 'monitor' })}>
                <span className="traffic-name">
                  <strong title={row.name}>{row.name}</strong>
                  <span>{row.total === 0 ? '没有差分点' : `${row.complete}/${row.total} 个桶有合法差分`}</span>
                </span>
                <span className="traffic-values">
                  <span>↓ <b>{row.moved.inBytes == null ? '—' : formatBytes(row.moved.inBytes)}</b></span>
                  <span>↑ <b>{row.moved.outBytes == null ? '—' : formatBytes(row.moved.outBytes)}</b></span>
                  <span>峰值 ↓ {row.peakIn ? `${formatBytes(row.peakIn)}/s` : '—'}</span>
                  <span>↑ {row.peakOut ? `${formatBytes(row.peakOut)}/s` : '—'}</span>
                </span>
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
          ) : world.users.state === 'loading' ? (
            <Skeleton label="客户用量" />
          ) : customers.length === 0 ? (
            <p className="muted">还没有客户用量。</p>
          ) : (
            <div className="lb">
              {customers.slice(0, 12).map((person) => {
                const ratio = person.quotaRatio;
                const tone = ratio == null ? '' : ratio >= 1 ? 'quota-bad' : ratio >= 0.8 ? 'quota-warn' : 'quota-ok';
                return (
                  <button type="button" className="lb-row lb-row-plain" key={person.userId} onClick={() => openUser(person.userId)}>
                    <span className="lb-email" title={privacy.email(person.email)}>{privacy.email(person.email)}</span>
                    {ratio == null ? (
                      <span className="muted">不限额</span>
                    ) : (
                      <div className={`quota-bar ${tone}`} aria-hidden>
                        <span style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} />
                      </div>
                    )}
                    <span className="lb-value mono">
                      {formatBytes(person.usageBytes)}
                      {person.quotaBytes == null ? ' / 不限' : ` / ${formatBytes(person.quotaBytes)}`}
                      {ratio != null ? ` · ${Math.round(ratio * 100)}%` : ''}
                    </span>
                  </button>
                );
              })}
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
