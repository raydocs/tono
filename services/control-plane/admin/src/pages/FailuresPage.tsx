import { operationsApi, type FleetNodeDto } from '../api';
import { useRefresh, useResource } from '../hooks';
import { timeAgo } from '../lib/format';
import { DataHealth, StateBoundary } from '../ui';

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
  const { refreshMs } = useRefresh();
  const fleet = useResource(operationsApi.fleetNodes, [], refreshMs);
  return (
    <div className="stack">
      <DataHealth sources={[{ label: '机队', resource: fleet }]} />
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
      <section className="card unavailable-card">
        <div className="card-body">
          <h2>客户故障流尚未接入</h2>
          <p className="muted">现有合同只能逐个客户读取诊断报告，不能可靠生成全局失败队列。请从客户详情查看诊断摘要；这里不会用推测数据冒充故障。</p>
          <a className="btn btn-outline btn-sm" href="#/users">去客户页</a>
        </div>
      </section>
    </div>
  );
}
