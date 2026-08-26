import type { UserDto } from '../api';
import { formatBytes } from '../lib/format';
import { DataHealth, StateBoundary, Status } from '../ui';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';

export function TrafficPage() {
  const world = useOpsWorld();
  const privacy = usePrivacy();
  const users = world.users;
  return (
    <div className="stack">
      <DataHealth sources={[{ label: '客户用量', resource: users }]} />
      <section className="card">
        <div className="card-header">
          <div>
            <h2>客户本期流量</h2>
            <p>本期累计用量。机器网卡数字是累计字节，不是当前速度。</p>
          </div>
        </div>
        <div className="table-wrap">
          <StateBoundary resource={users} empty={(rows: UserDto[]) => rows.length === 0}>{(rows) => (
            <table>
              <thead><tr><th>客户</th><th>状态</th><th>已用</th><th>额度</th><th>使用率</th></tr></thead>
              <tbody>{[...rows].sort((a, b) => b.usageBytes - a.usageBytes).map((user) => {
                const ratio = user.quotaBytes ? user.usageBytes / user.quotaBytes : null;
                return <tr key={user.id}>
                  <td><a className="table-link" href={`#/users?user=${encodeURIComponent(user.id)}`}><strong>{privacy.email(user.email)}</strong></a></td>
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
          <h2>客户小时趋势尚不可用</h2>
          <p className="muted">没有按客户的时间序列接口。机器累计可在服务器抽屉的 24 小时趋势里看。这里不会把累计计数器画成当前速度。</p>
        </div>
      </section>
    </div>
  );
}
