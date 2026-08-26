import { useMemo } from 'react';
import { type ActivityDto, type DashboardDto, type LiveQualityNodeDto, type UserDto } from '../api';

import { formatBytes, timeAgo, timestamp } from '../lib/format';
import { blockLabel, blockStatus, isLikelyBlocked } from '../lib/quality';
import { DataHealth, StateBoundary, Status } from '../ui';
import { catalogLag } from '../lib/revision';
import { formatExitDelay, formatTcpDelay, nodeHealthLabel, nodeHealthTone } from '../lib/path-status';
import { useOpsWorld } from '../ops-context';
import { NodeCard } from '../NodeCard';
import { useOpsRoute } from '../lib/route';
import { usePrivacy } from '../privacy';

function UsageLeaderboard({ users }: { users: UserDto[] }) {
  const privacy = usePrivacy();
  const top = useMemo(
    () => [...users].sort((a, b) => b.usageBytes - a.usageBytes).slice(0, 5),
    [users],
  );
  if (!top.some((user) => user.usageBytes > 0)) {
    return <div className="state"><strong>还没有按客户统计的流量</strong><span>计量本身是通的。这里空着，多半是刚清过这期，或者客户还在用旧凭证，等他们下次拉目录就会换过来。</span></div>;
  }
  const max = top[0]?.usageBytes || 1;
  return (
    <div className="lb">
      {top.map((user, index) => (
        <div className="lb-row" key={user.id}>
          <span className={`lb-rank${index < 3 ? ` lb-rank-${index + 1}` : ''}`}>{index + 1}</span>
          <span className="lb-email">{privacy.email(user.email)}</span>
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
  const world = useOpsWorld();
  const { openNode, openUser } = useOpsRoute();
  const privacy = usePrivacy();
  const resource = world.dashboard;
  const live = world.live;
  const usersRes = world.users;
  const activityRes = world.activity;
  const fleetRes = world.fleet;
  const auditRes = world.audit;
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

    const alerts: Array<{ tone: 'error' | 'warn'; text: string; href?: string; key?: string }> = [];
    if (fleetRes.state === 'ready') {
      const reasonLabel: Record<string, string> = {
        catalog_health_down: '整机失联且仍在售',
        catalog_likely_blocked: '疑似被墙且仍在售',
        agent_missing: '没有安装探针',
        agent_stale: '探针数据过期',
        profile_retired_but_listed: '已退役但仍在目录',
      };
      for (const node of fleetRes.data.nodes.filter((entry) => entry.needsAttention)) {
        const severe = node.reasons.some((reason) => ['catalog_health_down', 'catalog_likely_blocked', 'profile_retired_but_listed'].includes(reason));
        alerts.push({
          key: `node:${node.name}`,
          tone: severe ? 'error' : 'warn',
          text: `${node.name}：${node.reasons.map((reason) => reasonLabel[reason] ?? reason).join('、')}${node.affectedUsers.length ? `；影响 ${node.affectedUsers.length} 位客户` : ''}`,
          href: `#/monitor?node=${encodeURIComponent(node.name)}`,
        });
      }
    } else if (liveData) {
      for (const node of qualityNodes) {
        const parts: string[] = [];
        if (!node.ok) parts.push('大陆测不通');
        if (isLikelyBlocked(node)) parts.push(`疑似被墙（${node.block?.label ?? '异常'}）`);
        if (node.quality && node.quality !== 'ok') parts.push(`出口质量 ${node.quality}`);
        if (parts.length) alerts.push({ tone: 'error', text: `${node.name}：${parts.join('、')}`, href: `#/monitor?node=${encodeURIComponent(node.name)}`, key: `node:${node.name}` });
      }
      const probeless = qualityNodes.filter((node) => !agentNames.has(node.name));
      if (probeless.length > 0) {
        alerts.push({ tone: 'warn', text: `${probeless.length} 台还没装探针：${probeless.map((node) => node.name).join('、')}` });
      }
    }
    // Absence is not health. This card used to render whenever *either* source
    // was ready while the checks below only ran for the source that had loaded,
    // so a failed user call left a green "所有节点与用户状态正常" standing on
    // node data alone — asserting exactly the half it had never seen. Quota and
    // expiry lockouts are what this card exists to catch.
    const unchecked: string[] = [];
    if (live.state === 'error') {
      alerts.push({ tone: 'warn', text: `节点数据没加载上来（${live.message}），被墙、测不通、质量问题这次没查` });
    } else if (live.state !== 'ready') unchecked.push('节点');
    if (usersRes.state === 'error') {
      alerts.push({ tone: 'warn', text: `客户数据没加载上来（${usersRes.message}），配额和到期这次没查` });
    } else if (usersRes.state !== 'ready') unchecked.push('客户');

    if (usersRes.state === 'ready') {
      for (const user of usersRes.data) {
        if (user.status !== 'active') continue;
        if (user.quotaBytes && user.usageBytes >= user.quotaBytes) {
          alerts.push({
            tone: 'error',
            text: `${user.email} 流量超了（${formatBytes(user.usageBytes)} / ${formatBytes(user.quotaBytes)}）`,
          });
        } else if (user.quotaBytes && user.usageBytes / user.quotaBytes >= 0.8) {
          alerts.push({
            tone: 'warn',
            text: `${user.email} 流量用了 ${Math.round((user.usageBytes / user.quotaBytes) * 100)}%`,
          });
        }
        if (user.expiresAt) {
          const days = (user.expiresAt - nowSec) / 86_400;
          if (days < 0) alerts.push({ tone: 'error', text: `${user.email} 已经过期` });
          else if (days <= 7) alerts.push({ tone: 'warn', text: `${user.email} ${Math.ceil(days)} 天后到期` });
        }
        if (user.product?.incomplete) {
          alerts.push({ tone: 'warn', text: `${user.email} 还没开 Claude` });
        }
      }
    }
    const inventory = data.inventory;
    if (inventory) {
      if (inventory.usersWithoutHome > 0) {
        alerts.push({
          tone: 'warn',
          text: `${inventory.usersWithoutHome} 个在用客户没绑家宽，Claude 会走机房 IP`,
        });
      }
      if (inventory.unusedHomes === 0) alerts.push({ tone: 'warn', text: '家宽库存空了' });
      if (inventory.unusedAccounts === 0) alerts.push({ tone: 'warn', text: 'Claude 号池空了' });
      if (inventory.bannedUnreplaced > 0) {
        alerts.push({ tone: 'error', text: `${inventory.bannedUnreplaced} 人封号了还没换` });
      }
      if (inventory.renewingSoon > 0) {
        alerts.push({ tone: 'warn', text: `${inventory.renewingSoon} 台服务器 7 天内到期` });
      }
    }

    const nodeState = (node: LiveQualityNodeDto) => {
      const status = blockStatus(node);
      if (status === 'LIKELY_BLOCKED') return { key: 'blocked', label: blockLabel(node) };
      if (status === 'DOWN' || status === 'EDGE_FAIL' || !node.ok) return { key: 'down', label: blockLabel(node) };
      if (node.quality && node.quality !== 'ok') return { key: 'warn', label: `质量 ${node.quality}` };
      return { key: 'ok', label: blockLabel(node) };
    };
    const orderedAlerts = [...new Map(alerts.map((alert, index) => [alert.key ?? `alert:${index}:${alert.text}`, alert])).values()]
      .sort((a, b) => Number(b.tone === 'error') - Number(a.tone === 'error'));

    return <>
      <DataHealth sources={[
        { label: '节点质量', resource: live },
        { label: '机队', resource: fleetRes },
        { label: '客户', resource: usersRes },
        { label: '谁在线', resource: activityRes },
        { label: '操作记录', resource: auditRes },
        { label: '总览', resource },
      ]} />
      <div className="metrics metrics-hero">
        <article className={`metric${blocked.length ? ' metric-alert' : ''}`}>
          <div className="metric-label"><span>被墙</span></div>
          <div className="metric-value">{liveData ? blocked.length : '—'}</div>
          <div className="metric-hint">{blocked.length ? blocked.map((n) => n.name).join('、') : '从大陆测的结果'}</div>
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
              : '按心跳统计'}
          </div>
        </article>
        <article className={`metric${inventory && inventory.incompleteUsers ? ' metric-warn' : ''}`}>
          <div className="metric-label"><span>未开 Claude</span></div>
          <div className="metric-value">{inventory ? inventory.incompleteUsers : '—'}</div>
          <div className="metric-hint">要绑家宽，客户端不会自己选</div>
        </article>
      </div>

      {inventory && (
        <div className="inventory-bar">
          <a href="#/users" className={`inv-chip${inventory.usersWithoutHome ? ' inv-warn' : ''}`}>没绑家宽 {inventory.usersWithoutHome}</a>
          <a href="#/users" className={`inv-chip${inventory.unusedHomes === 0 ? ' inv-warn' : ''}`}>闲置家宽 {inventory.unusedHomes}</a>
          <a href="#/users" className={`inv-chip${inventory.unusedAccounts === 0 ? ' inv-warn' : ''}`}>闲置 Claude {inventory.unusedAccounts}</a>
          <span className={`inv-chip${inventory.bannedUnreplaced ? ' inv-alert' : ''}`}>封号没换 {inventory.bannedUnreplaced}</span>
          <a href="#/monitor" className={`inv-chip${inventory.renewingSoon ? ' inv-warn' : ''}`}>7 天内续费 {inventory.renewingSoon}</a>
          {degraded.length > 0 && <span className="inv-chip inv-warn">质量异常 {degraded.length}</span>}
        </div>
      )}

      {(liveData || usersRes.state === 'ready') && (
        <section className={`card attention-card${world.accidents.length > 0 ? ' has-alerts' : ''}`}>
          <div className="card-header">
            <div>
              <h2>事故</h2>
              <p>被墙、失联、路径差。Claude 和家宽在下面待办里。</p>
            </div>
          </div>
          {world.accidents.length === 0 ? (
            unchecked.length === 0
              ? <div className="attention-ok">✓ 没有机房或路径事故</div>
              : <div className="attention-ok">{unchecked.join('和')}还在加载，还没查完</div>
          ) : (
            <ul className="attention-list">
              {world.accidents.map((item) => (
                <li key={item.id} className={`attention-${item.severity === 'severe' ? 'error' : 'warn'}`}>
                  <span className="attention-dot" aria-hidden />
                  <a className="table-link" href={item.href}>{privacy.email(item.title)} · {item.detail}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {world.chores.length > 0 && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2>待办</h2>
              <p>额度、续费、目录落后、未开可选服务</p>
            </div>
          </div>
          <ul className="attention-list">
            {world.chores.slice(0, 12).map((item) => (
              <li key={item.id} className="attention-warn">
                <span className="attention-dot" aria-hidden />
                <a className="table-link" href={item.href}>{privacy.email(item.title)} · {item.detail}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {live.state === 'ready' && qualityNodes.length > 0 && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2>节点状态</h2>
              <p>更新于 {timestamp(liveData?.quality?.updatedAt)} · 点开看详情</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/monitor">去服务器页</a>
          </div>
          <div className="node-grid">
            {world.nodes.slice(0, 12).map((node) => (
              <NodeCard
                key={node.name}
                node={node}
                density="compact"
                onOpen={() => openNode(node.name)}
              />
            ))}
          </div>
        </section>
      )}

      {activityRes.state === 'ready' && activityRes.data.users.length > 0 && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2>谁在线</h2>
              <p>大约 20 分钟报一次心跳</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>客户</th><th>状态</th><th>在用节点</th><th>节点健康</th><th>出口</th><th>TCP</th><th>目录</th><th>客户端</th><th>上次心跳</th></tr>
              </thead>
              <tbody>{activityRes.data.users.map((user) => (
                <tr key={user.userId}>
                  <td><a className="table-link" href={`#/users?user=${encodeURIComponent(user.userId)}`} onClick={(event) => { event.preventDefault(); openUser(user.userId); }}><strong>{privacy.email(user.email)}</strong></a></td>
                  <td>
                    {user.online
                      ? <Status value="active" />
                      : <span className="muted">离线</span>}
                    {user.uiState ? <small className="muted">{user.uiState}</small> : null}
                  </td>
                  <td>{user.selectedServer ?? <span className="muted">—</span>}</td>
                  <td>
                    {user.selectedServer
                      ? <span className={`chip chip-${nodeHealthTone(user.nodeHealth)}`}>{user.nodeHealthLabel || nodeHealthLabel(user.nodeHealth)}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="mono" title="隧道里打 gstatic 的往返，不是 ping 节点">{formatExitDelay(user.exitDelayMs)}</td>
                  <td className="mono" title="TCP 连节点 :443">{formatTcpDelay(user.tcpDelayMs)}</td>
                  <td>{(() => {
                    // Against the published revision, because the number alone
                    // does not answer "did they pick up what I just published".
                    const lag = catalogLag(user.catalogRevision, data.catalog.revision);
                    if (lag.state === 'unreported') {
                      return <span className="muted" title="这个版本不上报目录版本，不代表落后">未上报</span>;
                    }
                    if (lag.state === 'behind') {
                      return <span className="chip chip-risk" title={`已发布 ${data.catalog.revision}`}>r{lag.revision} · 落后 {lag.by}</span>;
                    }
                    if (lag.state === 'ahead') {
                      return <span className="chip chip-risk" title="比线上目录还新，目录可能回滚过">r{lag.revision} · 超前</span>;
                    }
                    return <span className="mono">r{lag.revision}</span>;
                  })()}</td>
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
              <h2>流量最多</h2>
              <p>用量前 5 的客户</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/users">去客户页</a>
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
              <h2>各节点人数</h2>
              <p>现在连着哪台</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/monitor">去服务器页</a>
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
            ) : <div className="state"><strong>现在没人在线</strong><span>有心跳后这里会显示人数。</span></div>)}
            {activityRes.state !== 'ready' && <div className="state"><span className="spinner" /></div>}
          </div>
        </section>

      </div>

      {auditRes.state === 'ready' && auditRes.data.length > 0 && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2>最近操作</h2>
              <p>绑线路、开通、换号、改资料</p>
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
        目录版本 {data.catalog.revision} · 更新于 {timestamp(data.catalog.updatedAt)}
      </div>
    </>;
  }}</StateBoundary>;
}
