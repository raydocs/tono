import { operationsApi } from '../api';
import { useResource } from '../hooks';
import { timeAgo } from '../lib/format';
import { HEARTBEAT_FRESH_SECONDS, type OpsIncident } from '../lib/incidents';
import { useOpsRoute } from '../lib/route';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';
import { DataHealth, FilterChips, GlassCard, Unavailable } from '../ui';
import { NodeDrawer } from './monitor/NodeDrawer';
import { CustomerDrawer } from './users/CustomerDrawer';
import { PersonRow } from './users/PersonRow';

function IncidentRow({ item, nowSec }: { item: OpsIncident; nowSec: number }) {
  const privacy = usePrivacy();
  const { openNode, openUser } = useOpsRoute();
  // Each source has its own honest freshness boundary: heartbeats every few
  // minutes, quality scans every twelve hours.
  const staleAfter = item.staleAfterSec ?? HEARTBEAT_FRESH_SECONDS;
  const fresh = item.measuredAtSec != null && nowSec - item.measuredAtSec <= staleAfter;
  const title = item.userId ? privacy.email(item.title) : item.title;
  return (
    <article className={`incident incident-${item.severity === 'severe' ? 'error' : 'warn'}`}>
      <div className="incident-main">
        <div className="incident-head">
          <span className="incident-sev">{item.severity === 'severe' ? '严重' : '警告'}</span>
          <h2>{title}</h2>
        </div>
        <p>{item.detail}</p>
        <div className="incident-meta">
          <span>
            {item.category === 'customer-path'
              ? `${item.impactCount} 位客户${item.affectedDeviceCount ? ` · ${item.affectedDeviceCount} 台设备` : ''}`
              : item.impactCount ? `影响 ${item.impactCount} 人` : '无人在用'}
          </span>
          <span>
            {item.measuredAtSec != null ? `测量 ${timeAgo(item.measuredAtSec)}` : '测量时间未知'}
            {item.measuredAtSec != null ? (fresh ? ' · 新鲜' : ' · 已过保鲜') : ''}
          </span>
          {item.node ? <span>{item.node}</span> : null}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => {
          // Triage stays on this page: the drawer opens here, the filters stay.
          if (item.category === 'customer-path' && item.userId) openUser(item.userId, { page: 'failures' });
          else if (item.node) openNode(item.node, { page: 'failures' });
        }}
      >
        {item.category === 'customer-path' ? '打开客户' : '处理节点'}
      </button>
    </article>
  );
}

export function FailuresPage() {
  const world = useOpsWorld();
  const { route, setRoute, closeDrawer, openUser } = useOpsRoute();
  const focus = route.focus;
  const homes = useResource(operationsApi.homeExits, [], 120_000, Boolean(route.user));
  // world.incidents already arrives sorted.
  const board = world.incidents.filter((item) => item.category === 'node' || item.category === 'customer-path');
  const pathOnly = focus === 'customer-path';
  const unmeasuredOnly = focus === 'unmeasured';
  const visible = pathOnly ? board.filter((item) => item.category === 'customer-path') : board;
  const severe = visible.filter((item) => item.severity === 'severe' && item.category === 'node');
  const warn = visible.filter((item) => item.severity === 'warn' && item.category === 'node');
  const paths = visible.filter((item) => item.category === 'customer-path');
  const qualityFailed = world.sources.quality.status === 'unavailable';
  const agentsFailed = world.sources.agents.status === 'unavailable';
  const activityFailed = world.sources.activity.status === 'unavailable';
  const qualityPending = world.sources.quality.status === 'loading';
  const agentsPending = world.sources.agents.status === 'loading';
  const activityPending = world.sources.activity.status === 'loading';
  const neverMeasured = world.people.filter((person) => person.online && person.path.kind === 'unmeasured');
  const staleSampled = world.people.filter((person) => person.online && person.path.kind === 'stale-sample');
  const pathUnmeasured = neverMeasured.length + staleSampled.length;
  const selectedNode = world.nodes.find((node) => node.name === route.node) ?? null;
  const selectedPerson = world.people.find((person) => person.userId === route.user) ?? null;

  return (
    <div className="stack">
      <DataHealth sources={[
        { label: '节点质量', resource: world.live },
        { label: '客户心跳', resource: world.activity },
      ]} />
      <p className="muted">这是当前快照，不是事故历史。没有持续时长，也没有已恢复事故。</p>
      <FilterChips
        value={focus ?? ''}
        options={[
          { id: '', label: '全部事故', count: board.length },
          { id: 'customer-path', label: '客户路径', count: paths.length },
          { id: 'unmeasured', label: '路径未测', count: pathUnmeasured },
        ]}
        onChange={(id) => setRoute((current) => ({ ...current, page: 'failures', focus: id || null }))}
      />

      {unmeasuredOnly ? (
        <GlassCard>
          <div className="card-header">
            <div>
              <h2>路径未测</h2>
              <p>在线但没有新鲜的出口/TCP 采样。</p>
            </div>
          </div>
          <div className="card-body">
            {activityFailed
              ? <Unavailable title="客户路径不可判断" detail={world.sources.activity.error ?? undefined} />
              : activityPending
                ? <p className="muted">心跳还没查完。</p>
                : pathUnmeasured === 0
                  ? <p className="muted">在线客户都有新鲜的路径采样，或目前没有在线客户。</p>
                  : (
                    <>
                      {neverMeasured.length > 0 && (
                        <>
                          <p className="muted">{neverMeasured.length} 位从来没有采样。缺测不是故障。</p>
                          <div className="person-list">
                            {neverMeasured.map((person) => (
                              <PersonRow key={person.userId} person={person} onOpen={() => openUser(person.userId, { page: 'failures' })} />
                            ))}
                          </div>
                        </>
                      )}
                      {staleSampled.length > 0 && (
                        <>
                          <p className="muted">{staleSampled.length} 位上次采样已过保鲜。这不是缺测，也不能当成正常。</p>
                          <div className="person-list">
                            {staleSampled.map((person) => (
                              <PersonRow key={person.userId} person={person} onOpen={() => openUser(person.userId, { page: 'failures' })} />
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
          </div>
        </GlassCard>
      ) : (
      <>
      {!pathOnly && (
        <GlassCard>
          <div className="card-header"><div><h2>严重事故</h2></div></div>
          <div className="card-body incident-list">
            {qualityFailed && severe.length === 0
              ? <Unavailable title="质量源不可用，不能判断机房事故" detail={world.sources.quality.error ?? undefined} />
              : severe.length
                ? <>
                  {qualityFailed || world.sources.quality.status === 'stale' ? <p className="muted">来源不完整或为旧快照，已知事故仍列出。</p> : null}
                  {severe.map((item) => <IncidentRow key={item.id} item={item} nowSec={world.nowSec} />)}
                </>
                : qualityPending
                  ? <p className="muted">节点数据还没查完。</p>
                  : world.sources.quality.status === 'current'
                    ? <p className="muted">当前快照没有严重机房事故。缺测不是健康，也不是事故。</p>
                    : <p className="muted">质量不是 current，不能写成没有事故。</p>}
          </div>
        </GlassCard>
      )}

      {!pathOnly && (
        <GlassCard>
          <div className="card-header"><div><h2>警告</h2></div></div>
          <div className="card-body incident-list">
            {agentsFailed && warn.length === 0
              ? <Unavailable title="探针源不可用，不能判断负载警告" detail={world.sources.agents.error ?? undefined} />
              : warn.length
                ? warn.map((item) => <IncidentRow key={item.id} item={item} nowSec={world.nowSec} />)
                : agentsPending
                  ? <p className="muted">探针还没查完。</p>
                  : world.sources.agents.status === 'current'
                    ? <p className="muted">没有探针/负载警告。</p>
                    : <p className="muted">探针不是 current，不能写成没有警告。</p>}
          </div>
        </GlassCard>
      )}

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>客户路径</h2>
            <p>400ms 警告，800ms 严重。同一客户多设备只一条。节点严重事故已覆盖的不再重复。</p>
          </div>
        </div>
        <div className="card-body incident-list">
          {activityFailed && paths.length === 0
            ? <Unavailable title="客户路径不可判断" detail={world.sources.activity.error ?? undefined} />
            : paths.length
              ? paths.map((item) => <IncidentRow key={item.id} item={item} nowSec={world.nowSec} />)
              : activityPending
                ? <p className="muted">心跳还没查完。</p>
                : world.sources.activity.status === 'current'
                  ? pathUnmeasured > 0
                    ? (
                      <p className="muted">
                        没有新鲜的客户路径事故。
                        {neverMeasured.length > 0 && (
                          <>
                            <a className="table-link" href="#/failures?focus=unmeasured">{neverMeasured.length} 个在线客户还没有路径采样</a>
                            ，缺测不是故障。
                          </>
                        )}
                        {staleSampled.length > 0 && (
                          <>
                            <a className="table-link" href="#/failures?focus=unmeasured">{staleSampled.length} 个在线客户上次采样已过保鲜</a>
                            ，不能当成正常。
                          </>
                        )}
                      </p>
                    )
                    : <p className="muted">没有新鲜的客户路径事故。缺测不是故障。</p>
                  : <p className="muted">心跳不是 current，不能写成没有路径事故。</p>}
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-header"><div><h2>数据未知 / 来源不可用</h2></div></div>
        <div className="card-body">
          {qualityFailed && <p>质量或探针源不可用，机房区域不能写成全部正常。</p>}
          {activityFailed && <p>心跳源不可用，客户路径不可判断。</p>}
          {!qualityFailed && !activityFailed && (
            <p className="muted">
              只在目录里、还没测过的机器不是事故。
              {world.nodes.some((node) => node.qualityState !== 'reported') ? ' 当前有质量未测或源不可用的节点，见服务器页「数据未知」。' : ''}
            </p>
          )}
        </div>
      </GlassCard>
      </>
      )}

      <NodeDrawer
        key={selectedNode?.name ?? 'node-none'}
        node={selectedNode}
        open={Boolean(route.node)}
        metrics={world.metrics.snapshotKey === '24h' && world.metrics.state === 'ready' ? world.metrics.data : null}
        focus={route.focus}
        onClose={closeDrawer}
        onChanged={() => { world.live.reload(); world.fleet.reload(); }}
      />
      <CustomerDrawer
        person={selectedPerson}
        open={Boolean(route.user)}
        focus={route.focus}
        publishedRevision={world.catalogRevision}
        catalog={world.catalog}
        homes={homes}
        onClose={closeDrawer}
        onChanged={() => { world.users.reload(); world.activity.reload(); }}
      />
    </div>
  );
}
