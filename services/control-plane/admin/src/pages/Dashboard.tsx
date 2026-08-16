import { useMemo } from 'react';
import { operationsApi, type ActivityDto, type DashboardDto, type LiveQualityNodeDto, type UserDto } from '../api';
import { useRefresh, useResource } from '../hooks';
import { formatBytes, timeAgo, timestamp } from '../lib/format';
import { blockLabel, blockStatus, isLikelyBlocked } from '../lib/quality';
import { DataHealth, StateBoundary, Status } from '../ui';

function UsageLeaderboard({ users }: { users: UserDto[] }) {
  const top = useMemo(
    () => [...users].sort((a, b) => b.usageBytes - a.usageBytes).slice(0, 5),
    [users],
  );
  if (!top.some((user) => user.usageBytes > 0)) {
    return <div className="state"><strong>暂无按用户流量</strong><span>计量链是通的（每台节点持有独立凭据，采集器每十分钟上报一次跨节点累计值）。这里为空只说明这一批账号还没有计到量：刚重置过周期，或者他们仍在用旧的共享凭据，要等客户端下次拉取目录才会换过去。</span></div>;
  }
  const max = top[0]?.usageBytes || 1;
  return (
    <div className="lb">
      {top.map((user, index) => (
        <div className="lb-row" key={user.id}>
          <span className={`lb-rank${index < 3 ? ` lb-rank-${index + 1}` : ''}`}>{index + 1}</span>
          <span className="lb-email">{user.email}</span>
          <div className="lb-track">
            <div className="lb-fill" style={{ width: `${Math.max(2, (user.usageBytes / max) * 100)}%` }} />
          </div>
          <span className="lb-value mono">{formatBytes(user.usageBytes)}</span>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const { refreshMs } = useRefresh();
  const resource = useResource(operationsApi.dashboard, [], refreshMs);
  const live = useResource(operationsApi.live, [], refreshMs);
  const usersRes = useResource(operationsApi.users, [], refreshMs);
  const activityRes = useResource<ActivityDto>(operationsApi.activity, [], refreshMs);
  const auditRes = useResource(operationsApi.audit, [], refreshMs);
  return <StateBoundary resource={resource}>{(data: DashboardDto) => {
    const liveData = live.state === 'ready' ? live.data : null;
    const qualityNodes = liveData?.quality?.nodes ?? [];
    const agents = liveData?.agents ?? [];
    const agentNames = new Set(agents.map((agent) => agent.name));
    const offline = qualityNodes.filter((node) => !node.ok);
    const blocked = qualityNodes.filter(isLikelyBlocked);
    const degraded = qualityNodes.filter((node) => node.quality && node.quality !== 'ok');

    const nowSec = Math.floor(Date.now() / 1_000);
    const activityUsers = activityRes.state === 'ready' ? activityRes.data.users : [];
    const onlineUsers = activityUsers.filter((user) => user.online);

    const occupancy = new Map<string, number>();
    for (const user of onlineUsers) {
      if (user.selectedServer) {
        occupancy.set(user.selectedServer, (occupancy.get(user.selectedServer) ?? 0) + 1);
      }
    }
    const occupancyRows = [...occupancy.entries()].sort((a, b) => b[1] - a[1]);
    const occupancyMax = Math.max(1, ...occupancyRows.map(([, count]) => count));

    const alerts: Array<{ tone: 'error' | 'warn'; text: string }> = [];
    if (liveData) {
      for (const node of offline) alerts.push({ tone: 'error', text: `${node.name} 大陆探测失败` });
      for (const node of blocked) {
        alerts.push({ tone: 'error', text: `${node.name} 疑似被墙（${node.block?.label ?? '异常'}）` });
      }
      for (const node of degraded) alerts.push({ tone: 'warn', text: `${node.name} IP 质量异常（${node.quality}）` });
      const probeless = qualityNodes.filter((node) => !agentNames.has(node.name));
      if (probeless.length > 0) {
        alerts.push({ tone: 'warn', text: `${probeless.length} 台未装探针：${probeless.map((node) => node.name).join('、')}` });
      }
    }
    // Absence is not health. This card used to render whenever *either* source
    // was ready while the checks below only ran for the source that had loaded,
    // so a failed user call left a green "所有节点与用户状态正常" standing on
    // node data alone — asserting exactly the half it had never seen. Quota and
    // expiry lockouts are what this card exists to catch.
    const unchecked: string[] = [];
    if (live.state === 'error') {
      alerts.push({ tone: 'warn', text: `节点数据没能加载（${live.message}）——被墙、探测失败、质量异常这三类没有检查` });
    } else if (live.state !== 'ready') unchecked.push('节点');
    if (usersRes.state === 'error') {
      alerts.push({ tone: 'warn', text: `用户数据没能加载（${usersRes.message}）——配额与到期没有检查` });
    } else if (usersRes.state !== 'ready') unchecked.push('用户');

    if (usersRes.state === 'ready') {
      for (const user of usersRes.data) {
        if (user.status !== 'active') continue;
        if (user.quotaBytes && user.usageBytes >= user.quotaBytes) {
          alerts.push({
            tone: 'error',
            text: `${user.email} 已超配额（${formatBytes(user.usageBytes)} / ${formatBytes(user.quotaBytes)}）`,
          });
        } else if (user.quotaBytes && user.usageBytes / user.quotaBytes >= 0.8) {
          alerts.push({
            tone: 'warn',
            text: `${user.email} 用量达配额 ${Math.round((user.usageBytes / user.quotaBytes) * 100)}%`,
          });
        }
        if (user.expiresAt) {
          const days = (user.expiresAt - nowSec) / 86_400;
          if (days < 0) alerts.push({ tone: 'error', text: `${user.email} 账号已过期` });
          else if (days <= 7) alerts.push({ tone: 'warn', text: `${user.email} 账号 ${Math.ceil(days)} 天后到期` });
        }
        if (user.product?.incomplete) {
          alerts.push({ tone: 'warn', text: `${user.email} 还没开 Claude 号` });
        }
      }
    }
    const inventory = data.inventory;
    if (inventory) {
      if (inventory.usersWithoutHome > 0) {
        alerts.push({
          tone: 'warn',
          text: `${inventory.usersWithoutHome} 个在用客户未绑家宽，Claude 会走机房出口`,
        });
      }
      if (inventory.unusedHomes === 0) alerts.push({ tone: 'warn', text: '家宽库存见底' });
      if (inventory.unusedAccounts === 0) alerts.push({ tone: 'warn', text: 'Claude 号池见底' });
      if (inventory.bannedUnreplaced > 0) {
        alerts.push({ tone: 'error', text: `${inventory.bannedUnreplaced} 人封号后未换号` });
      }
      if (inventory.renewingSoon > 0) {
        alerts.push({ tone: 'warn', text: `${inventory.renewingSoon} 台 VPS 7 天内到期` });
      }
    }

    const nodeState = (node: LiveQualityNodeDto) => {
      const status = blockStatus(node);
      if (status === 'LIKELY_BLOCKED') return { key: 'blocked', label: blockLabel(node) };
      if (status === 'DOWN' || status === 'EDGE_FAIL' || !node.ok) return { key: 'down', label: blockLabel(node) };
      if (node.quality && node.quality !== 'ok') return { key: 'warn', label: `质量 ${node.quality}` };
      return { key: 'ok', label: blockLabel(node) };
    };

    return <>
      <DataHealth sources={[
        { label: '节点质量', resource: live },
        { label: '用户', resource: usersRes },
        { label: '在线活动', resource: activityRes },
        { label: '操作记录', resource: auditRes },
        { label: '概览', resource },
      ]} />
      <div className="metrics metrics-hero">
        <article className={`metric${blocked.length ? ' metric-alert' : ''}`}>
          <div className="metric-label"><span>被墙</span></div>
          <div className="metric-value">{liveData ? blocked.length : '—'}</div>
          <div className="metric-hint">{blocked.length ? blocked.map((n) => n.name).join('、') : '大陆探测口径'}</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>节点在线</span></div>
          <div className="metric-value">
            {liveData ? `${qualityNodes.length - offline.length}/${qualityNodes.length}` : '—'}
          </div>
          <div className="metric-hint">探针 {agents.length || '—'}</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>在线客户</span></div>
          <div className="metric-value">
            {activityRes.state === 'ready' ? activityRes.data.onlineUsers : '—'}
          </div>
          <div className="metric-hint">
            {activityRes.state === 'ready'
              ? `${activityRes.data.onlineDevices} 台设备`
              : '心跳口径'}
          </div>
        </article>
        <article className={`metric${inventory && inventory.incompleteUsers ? ' metric-warn' : ''}`}>
          <div className="metric-label"><span>未开 Claude</span></div>
          <div className="metric-value">{inventory ? inventory.incompleteUsers : '—'}</div>
          <div className="metric-hint">Claude 家宽靠绑定，不是靠客户端默认</div>
        </article>
      </div>

      {inventory && (
        <div className="inventory-bar">
          <a href="#/users" className={`inv-chip${inventory.usersWithoutHome ? ' inv-warn' : ''}`}>客户未绑家宽 {inventory.usersWithoutHome}</a>
          <a href="#/users" className={`inv-chip${inventory.unusedHomes === 0 ? ' inv-warn' : ''}`}>未派家宽 {inventory.unusedHomes}</a>
          <a href="#/users" className={`inv-chip${inventory.unusedAccounts === 0 ? ' inv-warn' : ''}`}>未派 Claude {inventory.unusedAccounts}</a>
          <span className={`inv-chip${inventory.bannedUnreplaced ? ' inv-alert' : ''}`}>封号未换 {inventory.bannedUnreplaced}</span>
          <a href="#/monitor" className={`inv-chip${inventory.renewingSoon ? ' inv-warn' : ''}`}>7 日内续费 {inventory.renewingSoon}</a>
          {degraded.length > 0 && <span className="inv-chip inv-warn">质量异常 {degraded.length}</span>}
        </div>
      )}

      {(liveData || usersRes.state === 'ready') && (
        <section className={`card attention-card${alerts.length > 0 ? ' has-alerts' : ''}`}>
          <div className="card-header">
            <div>
              <h2>需要关注</h2>
              <p>被墙 · 探测失败 · 质量异常 · 配额 · 到期</p>
            </div>
          </div>
          {alerts.length === 0 ? (
            unchecked.length === 0
              ? <div className="attention-ok">✓ 所有节点与用户状态正常</div>
              : <div className="attention-ok">{unchecked.join('与')}数据仍在加载，尚未检查完</div>
          ) : (
            <ul className="attention-list">
              {alerts.map((alert, index) => (
                <li key={index} className={`attention-${alert.tone}`}>
                  <span className="attention-dot" aria-hidden />
                  <span>{alert.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {live.state === 'ready' && qualityNodes.length > 0 && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2>节点状态</h2>
              <p>采集于 {timestamp(liveData?.quality?.updatedAt)} · 点任意节点看监控详情</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/monitor">节点监控</a>
          </div>
          <div className="card-body node-grid">
            {qualityNodes.map((node) => {
              const state = nodeState(node);
              return (
                <a className={`node-tile node-${state.key}`} key={node.name} href="#/monitor">
                  <span className="node-dot" aria-hidden />
                  <span className="node-tile-main">
                    <strong>{node.name}</strong>
                    <small>{state.label}{agentNames.has(node.name) ? '' : ' · 无探针'}</small>
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {activityRes.state === 'ready' && activityRes.data.users.length > 0 && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2>用户在线状态</h2>
              <p>客户端每 20 分钟心跳 · 谁在用、用的哪个节点、什么版本</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>用户</th><th>状态</th><th>在用节点</th><th>客户端</th><th>最后心跳</th></tr>
              </thead>
              <tbody>{activityRes.data.users.map((user) => (
                <tr key={user.userId}>
                  <td><strong>{user.email}</strong></td>
                  <td>
                    {user.online
                      ? <Status value="active" />
                      : <span className="muted">离线</span>}
                    {user.uiState ? <small className="muted">{user.uiState}</small> : null}
                  </td>
                  <td>{user.selectedServer ?? <span className="muted">—</span>}</td>
                  <td className="muted">{user.clientVersion} · {user.osVersion}</td>
                  <td className="muted">{timeAgo(user.lastSeenAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      <div className="dash-split">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>流量榜单</h2>
              <p>用户累计用量 Top 5</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/users">用户管理</a>
          </div>
          <div className="card-body">
            {usersRes.state === 'ready'
              ? <UsageLeaderboard users={usersRes.data} />
              : <div className="state"><span className="spinner" /></div>}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>节点实时占用</h2>
              <p>在线用户当前连接的节点</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/monitor">节点监控</a>
          </div>
          <div className="card-body">
            {activityRes.state === 'ready' && (occupancyRows.length > 0 ? (
              <div className="lb">
                {occupancyRows.map(([name, count]) => (
                  <div className="lb-row lb-row-plain" key={name}>
                    <span className="lb-email">{name}</span>
                    <div className="lb-track">
                      <div className="lb-fill" style={{ width: `${Math.max(2, (count / occupancyMax) * 100)}%` }} />
                    </div>
                    <span className="lb-value mono">{count} 人在用</span>
                  </div>
                ))}
              </div>
            ) : <div className="state"><strong>当前无在线用户</strong><span>有心跳上报后显示节点占用。</span></div>)}
            {activityRes.state !== 'ready' && <div className="state"><span className="spinner" /></div>}
          </div>
        </section>

      </div>

      {auditRes.state === 'ready' && auditRes.data.length > 0 && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2>最近操作</h2>
              <p>派线、开户、换号、改档案</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>谁</th><th>动作</th><th>摘要</th></tr></thead>
              <tbody>
                {auditRes.data.slice(0, 12).map((entry) => (
                  <tr key={entry.id}>
                    <td className="muted">{timestamp(entry.at)}</td>
                    <td>{entry.actorEmail}</td>
                    <td className="mono">{entry.action}</td>
                    <td>{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="muted catalog-footnote">
        Catalog revision {data.catalog.revision} · 更新于 {timestamp(data.catalog.updatedAt)}
      </div>
    </>;
  }}</StateBoundary>;
}
