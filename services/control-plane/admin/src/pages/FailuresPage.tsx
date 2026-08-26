import type { FleetNodeDto } from '../api';
import { timeAgo } from '../lib/format';
import { DataHealth, StateBoundary } from '../ui';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';

const reasonLabels: Record<string, string> = {
  catalog_health_down: '在售节点整机失联',
  catalog_likely_blocked: '在售节点疑似被墙',
  agent_missing: '没有安装探针',
  agent_stale: '探针数据过期',
  profile_retired_but_listed: '已退役但仍在目录',
};

function FleetFailure({ node }: { node: FleetNodeDto }) {
  const severity = node.reasons.some((reason) => (
    reason === 'catalog_health_down'
    || reason === 'catalog_likely_blocked'
    || reason === 'profile_retired_but_listed'
  )) ? 'error' : 'warn';
  return (
    <article className={`incident incident-${severity}`}>
      <div className="incident-main">
        <span className="attention-dot" aria-hidden />
        <div>
          <h2>{node.name}</h2>
          <p>{node.reasons.map((reason) => reasonLabels[reason] ?? reason).join(' · ')}</p>
          <small>
            {node.catalogListed === true ? '仍在客户目录' : node.catalogListed === false ? '不在客户目录' : '目录状态未知'}
            {' · '}{node.occupancy} 位客户在线使用
            {' · '}探针{node.agentObservedAt ? ` ${timeAgo(node.agentObservedAt)}` : '未上报'}
          </small>
        </div>
      </div>
      <a className="btn btn-outline btn-sm" href={`#/monitor?node=${encodeURIComponent(node.name)}`}>处理节点</a>
    </article>
  );
}

export function FailuresPage() {
  const world = useOpsWorld();
  const privacy = usePrivacy();
  const fleet = world.fleet;
  return (
    <div className="stack">
      <DataHealth sources={[
        { label: '机队', resource: fleet },
        { label: '客户心跳', resource: world.activity },
      ]} />
      <section className="card">
        <div className="card-header">
          <div>
            <h2>故障队列</h2>
            <p>只列需要处理的节点，严重问题和仍在售的问题排在前面。</p>
          </div>
        </div>
        <div className="card-body incident-list">
          <StateBoundary resource={fleet}>{(data) => {
            const failures = data.nodes
              .filter((node) => node.needsAttention)
              .sort((a, b) => Number(b.catalogListed) - Number(a.catalogListed)
                || b.affectedUsers.length - a.affectedUsers.length);
            return failures.length
              ? failures.map((node) => <FleetFailure key={node.name} node={node} />)
              : <div className="attention-ok">✓ 当前没有机队故障</div>;
          }}</StateBoundary>
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>客户路径</h2>
            <p>只看 40 分钟内的心跳。缺测不是故障。400ms 警告，800ms 严重。</p>
          </div>
        </div>
        <div className="card-body incident-list">
          {world.activity.state !== 'ready' && !world.activity.refreshedAt
            ? <div className="state state-error"><strong>客户心跳没加载上来</strong><span>不能判断路径是不是事故，空着不是安全。</span></div>
            : world.accidents.filter((item) => item.userId).length
              ? world.accidents.filter((item) => item.userId).map((item) => (
                <article className={`incident incident-${item.severity === 'severe' ? 'error' : 'warn'}`} key={item.id}>
                  <div className="incident-main">
                    <span className="attention-dot" aria-hidden />
                    <div>
                      <h2>{privacy.email(item.title)}</h2>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                  <a className="btn btn-outline btn-sm" href={item.href}>打开客户</a>
                </article>
              ))
              : <div className="attention-ok">✓ 没有新鲜的客户路径事故</div>}
        </div>
      </section>
    </div>
  );
}
