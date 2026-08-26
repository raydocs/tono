import { operationsApi, type UserDto } from '../api';
import { useRefresh, useResource } from '../hooks';
import { formatBytes } from '../lib/format';
import { DataHealth, StateBoundary, Status } from '../ui';

export function TrafficPage() {
  const { refreshMs } = useRefresh();
  const users = useResource(operationsApi.users, [], refreshMs);
  return (
    <div className="stack">
      <DataHealth sources={[{ label: '客户用量', resource: users }]} />
      <section className="card">
        <div className="card-header">
          <div>
            <h2>客户本期流量</h2>
            <p>这里展示控制面现有的本期累计值，不推算实时速度或历史趋势。</p>
          </div>
        </div>
        <div className="table-wrap">
          <StateBoundary resource={users} empty={(rows: UserDto[]) => rows.length === 0}>{(rows) => (
            <table>
              <thead><tr><th>客户</th><th>状态</th><th>已用</th><th>额度</th><th>使用率</th></tr></thead>
              <tbody>{[...rows].sort((a, b) => b.usageBytes - a.usageBytes).map((user) => {
                const ratio = user.quotaBytes ? user.usageBytes / user.quotaBytes : null;
                return <tr key={user.id}>
                  <td><a className="table-link" href={`#/users?user=${encodeURIComponent(user.id)}`}><strong>{user.email}</strong></a></td>
                  <td><Status value={user.status} /></td>
                  <td className="mono">{formatBytes(user.usageBytes)}</td>
                  <td className="mono">{user.quotaBytes == null ? '不限' : formatBytes(user.quotaBytes)}</td>
                  <td>{ratio == null ? <span className="muted">—</span> : (
                    <span className={`chip ${ratio >= 1 ? 'chip-risk' : ratio >= 0.8 ? 'chip-warn' : 'chip-ok'}`}>
                      {Math.round(ratio * 100)}%
                    </span>
                  )}</td>
                </tr>;
              })}</tbody>
            </table>
          )}</StateBoundary>
        </div>
      </section>
      <section className="card unavailable-card">
        <div className="card-body">
          <h2>流量趋势尚不可用</h2>
          <p className="muted">当前前端 API 没有按客户的时间序列与账期来源。此处不会用累计值伪造日速率；待后端提供聚合接口后再恢复趋势图。</p>
        </div>
      </section>
    </div>
  );
}
