import { formatBytes, timestamp } from '../lib/format';
import { accidentsOnly, dashboardKpis } from '../lib/incidents';
import { sortOpsNodes } from '../lib/ops-views';
import { canDeclareHealthy } from '../lib/source-truth';
import { useOpsRoute } from '../lib/route';
import { NodeCard } from '../NodeCard';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';
import { DataHealth, GlassCard, Skeleton, Unavailable } from '../ui';
import { PersonRow } from './users/PersonRow';

function choreGroups(chores: ReturnType<typeof useOpsWorld>['chores']) {
  const quota = chores.filter((item) => item.kind === 'quota' || item.kind === 'expired' || item.kind === 'catalog-lag' || item.kind === 'node-renew');
  const ops = chores.filter((item) => item.kind === 'home' || item.kind === 'claude');
  return { quota, ops };
}

export function Dashboard() {
  const world = useOpsWorld();
  const { openNode, openUser } = useOpsRoute();
  const privacy = usePrivacy();
  const qualityAvailable = world.sources.quality.status === 'current' || world.sources.quality.status === 'stale';
  const activityAvailable = world.sources.activity.status === 'current' || world.sources.activity.status === 'stale';
  const usersAvailable = world.sources.users.status === 'current' || world.sources.users.status === 'stale';
  const kpis = dashboardKpis({
    nodes: world.nodes,
    people: world.people,
    incidents: world.incidents,
    qualityAvailable,
    activityAvailable,
    usersAvailable,
    profilesAvailable: world.sources.profiles.status === 'current' || world.sources.profiles.status === 'stale',
    nowSec: world.nowSec,
  });
  const accidents = accidentsOnly(world.incidents);
  const problemNodes = sortOpsNodes(world.nodes)
    .filter((node) => node.dot === 'bad' || node.dot === 'warn' || accidents.some((item) => item.node === node.name))
    .slice(0, 6);
  const onlinePeople = world.people.filter((person) => person.online).slice(0, 5);
  const occupancy = [...world.nodes]
    .filter((node) => node.occupancyState === 'known' && (node.occupancy ?? 0) > 0)
    .sort((a, b) => (b.occupancy ?? 0) - (a.occupancy ?? 0))
    .slice(0, 5);
  const usageTop = [...world.people]
    .filter((person) => person.user && person.usageBytes > 0)
    .sort((a, b) => b.usageBytes - a.usageBytes)
    .slice(0, 5);
  const { quota, ops } = choreGroups(world.chores);
  const inventory = world.dashboard.state === 'ready' ? world.dashboard.data.inventory : null;
  const healthy = canDeclareHealthy([world.sources.quality, world.sources.agents, world.sources.activity, world.sources.catalog]);
  const staleNote = [world.sources.quality, world.sources.agents, world.sources.activity, world.sources.catalog]
    .some((source) => source.status === 'stale');

  return (
    <div className="stack dash-page">
      <DataHealth sources={[
        { label: '节点质量', resource: world.live },
        { label: '客户', resource: world.users },
        { label: '谁在线', resource: world.activity },
        { label: '目录', resource: world.catalog },
      ]} />

      <div className="kpi-strip">
        {kpis.map((kpi) => (
          <a
            key={kpi.id}
            className={`kpi${kpi.alert ? ' kpi-alert' : ''}`}
            href={kpi.href}
          >
            <span className="kpi-label">{kpi.label}</span>
            <strong className="kpi-value">{kpi.value == null ? '—' : kpi.value}</strong>
          </a>
        ))}
      </div>

      {/* Incidents are the first focus; the operational chores sit directly
          under them as the second tier, which is also what keeps the left
          column from ending in a hole next to the taller node column. */}
      <GlassCard className={`attention-card${accidents.length ? ' has-alerts' : ''}`}>
        <div className="card-header">
          <div>
            <h2>机房 / 路径事故</h2>
            <p>只看被墙、失联、探针、路径。Claude 和家宽在下面待办。</p>
          </div>
          {accidents.length > 0 && <a className="btn btn-outline btn-sm" href="#/failures">全部事故</a>}
        </div>
        {accidents.length > 0 ? (
          <>
            {staleNote && <p className="muted dash-pad">正在看旧快照；采集或页面刷新已经落后。</p>}
            {!healthy && <p className="muted dash-pad">还有来源不可判断，已知事故仍列在下面。</p>}
            <ul className="attention-list">
              {accidents.map((item) => (
                <li key={item.id}>
                  <a
                    className={`incident-line attention-${item.severity === 'severe' ? 'error' : 'warn'}`}
                    href={item.actionRoute}
                  >
                    <span className="attention-dot" aria-hidden />
                    <span className="incident-line-body">
                      <span className="incident-line-title">{item.userId ? privacy.email(item.title) : item.title}</span>
                      <span className="incident-line-meta">{item.detail}</span>
                    </span>
                    {item.impactCount
                      ? <span className="incident-line-impact">影响 {item.impactCount} 人</span>
                      : <span className="incident-line-impact">无人在用</span>}
                    <span className="incident-line-go" aria-hidden>→</span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : healthy ? (
          <div className="attention-ok">节点和客户路径正常</div>
        ) : (
          <Unavailable title="还有数据没查完" detail="不能在质量、探针、心跳或目录未 current 时写成正常。" />
        )}
      </GlassCard>

      <div className="dash-command">
        <GlassCard>
          <div className="card-header">
            <div>
              <h2>问题节点</h2>
              <p>问题优先，最多 6 台</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/monitor">全部服务器</a>
          </div>
          {world.nodes.length === 0 && world.live.state === 'loading' ? (
            <Skeleton label="节点" />
          ) : problemNodes.length === 0 ? (
            <p className="muted dash-pad">这一屏没有需要先看的机器。</p>
          ) : (
            <div className="node-grid node-grid-compact dash-pad">
              {problemNodes.map((node) => (
                <NodeCard key={node.name} node={node} density="compact" onOpen={() => openNode(node.name)} />
              ))}
            </div>
          )}
        </GlassCard>

        <div className="dash-col">
          <GlassCard>
            <div className="card-header">
              <div>
                <h2>运营待办</h2>
                <p>额度、到期、目录落后</p>
              </div>
              <a className="btn btn-outline btn-sm" href="#/users?focus=quota">查看全部</a>
            </div>
            <ul className="attention-list">
              {quota.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <a className="table-link" href={item.actionRoute}>{item.node ? item.title : privacy.email(item.title)} · {item.detail}</a>
                </li>
              ))}
              {quota.length === 0 && (
                <li className="muted">
                  {world.sources.users.status === 'unavailable' ? '客户资料不可用，不能判断额度待办' : '没有额度或到期待办'}
                </li>
              )}
            </ul>
          </GlassCard>

          <GlassCard>
            <div className="card-header">
              <div>
                <h2>家宽 / Claude / 库存</h2>
                <p>开通侧的待办和闲置资源</p>
              </div>
              <a className="btn btn-outline btn-sm" href="#/users?focus=home">查看全部</a>
            </div>
            <ul className="attention-list">
              {inventory && (
                <>
                  <li><a className="table-link" href="#/users?focus=homes">闲置家宽 {inventory.unusedHomes}</a></li>
                  <li><a className="table-link" href="#/users?focus=claude">闲置 Claude {inventory.unusedAccounts} · 未开 {inventory.incompleteUsers}</a></li>
                </>
              )}
              {ops.slice(0, 5).map((item) => (
                <li key={item.id}><a className="table-link" href={item.actionRoute}>{privacy.email(item.title)} · {item.detail}</a></li>
              ))}
              {!inventory && world.dashboard.state === 'error' && <li className="muted">库存摘要不可用，客户待办仍在上面。</li>}
            </ul>
          </GlassCard>
        </div>
      </div>

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>谁在线</h2>
            <p>当前在线的客户，最多列出 5 人</p>
          </div>
          <a className="btn btn-outline btn-sm" href="#/users?focus=online">查看全部</a>
        </div>
        {!activityAvailable && world.activity.state !== 'ready' ? (
          world.activity.state === 'error'
            ? <Unavailable title="心跳不可用，不能写成 0 人在线" detail={world.activity.state === 'error' ? world.activity.message : undefined} />
            : <Skeleton label="在线客户" />
        ) : onlinePeople.length === 0 ? (
          <p className="muted dash-pad">现在没有在线客户。</p>
        ) : (
          <div className="person-list dash-online">
            {onlinePeople.map((person) => (
              <PersonRow key={person.userId} person={person} onOpen={() => openUser(person.userId)} />
            ))}
          </div>
        )}
      </GlassCard>

      <div className="dash-split">
        <GlassCard>
          <div className="card-header">
            <div>
              <h2>节点占用</h2>
              <p>当前在用人数 Top</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/monitor">查看全部</a>
          </div>
          <div className="card-body">
            {!activityAvailable ? (
              <p className="muted">占用不可判断</p>
            ) : occupancy.length === 0 ? (
              <p className="muted">现在没人在用机器</p>
            ) : (
              <div className="lb">
                {occupancy.map((node) => (
                  <button type="button" className="lb-row lb-row-plain" key={node.name} onClick={() => openNode(node.name)}>
                    <span className="lb-email" title={node.name}>{node.name}</span>
                    <div className="lb-track"><div className="lb-fill" style={{ width: `${Math.max(8, ((node.occupancy ?? 0) / (occupancy[0].occupancy || 1)) * 100)}%` }} /></div>
                    <span className="lb-value mono">{node.occupancy} 人</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </GlassCard>
        <GlassCard>
          <div className="card-header">
            <div>
              <h2>客户本期用量</h2>
              <p>累计 Top 5</p>
            </div>
            <a className="btn btn-outline btn-sm" href="#/traffic">查看全部</a>
          </div>
          <div className="card-body">
            {!usersAvailable ? (
              <p className="muted">客户用量不可判断</p>
            ) : !usageTop.some((person) => person.usageBytes > 0) ? (
              <p className="muted">还没有按客户统计的流量</p>
            ) : (
              <div className="lb">
                {usageTop.map((person, index) => (
                  <button type="button" className="lb-row" key={person.userId} onClick={() => openUser(person.userId)}>
                    <span className={`lb-rank${index < 3 ? ` lb-rank-${index + 1}` : ''}`}>{index + 1}</span>
                    <span className="lb-email" title={privacy.email(person.email)}>{privacy.email(person.email)}</span>
                    <div className="lb-track"><div className="lb-fill" style={{ width: `${Math.max(2, (person.usageBytes / (usageTop[0].usageBytes || 1)) * 100)}%` }} /></div>
                    <span className="lb-value mono">{formatBytes(person.usageBytes)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {world.audit.state === 'ready' && world.audit.data.length > 0 && (
        <details className="monitor-secondary">
          <summary>最近操作</summary>
          <ul className="attention-list">
            {world.audit.data.slice(0, 8).map((entry) => (
              <li key={entry.id}>
                <span className="muted">{timestamp(entry.at)}</span>
                {' · '}
                {privacy.email(entry.actorEmail)}
                {' · '}
                {privacy.privacy ? privacy.secret(entry.summary) : entry.summary}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
