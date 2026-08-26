import type { MetricsDto } from './api';
import { sparkPath } from './lib/spark';

export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const d = sparkPath(values, 160, 36);
  if (!d) return <span className="muted">还没有{label}记录</span>;
  return (
    <svg className="sparkline" viewBox="0 0 160 36" width="160" height="36" aria-label={label} role="img">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
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
