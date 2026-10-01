import { useState } from 'react';
import { operationsApi } from '../api';
import { useRefresh, useResource } from '../hooks';
import { timestamp } from '../lib/format';
import { useOpsWorld } from '../ops-context';
import { DataHealth, GlassCard, Skeleton, Unavailable } from '../ui';

/**
 * The catalog and the routing policy have one publisher: 设置 in the new
 * console. Two editors writing the same revisioned documents is how a
 * fleet ends up on a catalog nobody reviewed, so this page only reads.
 */
const CATALOG_EDITOR = '/ops2/#/settings/catalog';
const POLICY_EDITOR = '/ops2/#/settings/policy';

export function ControlPage() {
  const world = useOpsWorld();
  const { refreshMs } = useRefresh();
  const catalog = world.catalog;
  const policy = useResource(operationsApi.trafficPolicy, [], refreshMs ? Math.max(refreshMs, 120_000) : 0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const revisions = useResource(operationsApi.catalogRevisions, [], 0, historyOpen);

  const catalogRevision = catalog.state === 'ready' ? catalog.data.revision : null;
  const policyRevision = policy.state === 'ready' ? policy.data.revision : null;
  const behind = world.people.filter((person) => person.catalogLag.state === 'behind').length;
  const latest = world.people.filter((person) => person.catalogLag.state === 'current').length;
  const unreported = world.people.filter((person) => person.catalogLag.state === 'unreported').length;
  const lagReady = world.activity.state === 'ready';

  return (
    <div className="stack">
      <DataHealth sources={[
        { label: '节点目录', resource: catalog },
        { label: '直连规则', resource: policy },
        { label: '客户心跳', resource: world.activity },
      ]} />

      <GlassCard>
        <div className="card-header">
          <div>
            <h2>发布概况</h2>
            <p>线上版本，以及客户端拉到了第几版。</p>
          </div>
        </div>
        <div className="card-body">
          <div className="release-stats">
            <div className="release-stat">
              <span>节点目录</span>
              <strong>{catalogRevision != null ? `r${catalogRevision}` : '未知'}</strong>
              <small>{catalog.state === 'ready' ? timestamp(catalog.data.updatedAt) : catalog.state === 'error' ? '目录源不可用' : '加载中'}</small>
            </div>
            <div className="release-stat">
              <span>直连规则</span>
              <strong>{policyRevision != null ? `r${policyRevision}` : '未知'}</strong>
              <small>{policy.state === 'error' ? '规则源不可用' : policy.state === 'ready' ? '已加载' : '加载中'}</small>
            </div>
            {lagReady ? (
              <>
                <div className="release-stat">
                  <span>客户端最新</span>
                  <strong>{latest}</strong>
                  <small>已经拉到线上版</small>
                </div>
                <div className={`release-stat${behind > 0 ? ' t-severe' : ''}`}>
                  <span>客户端落后</span>
                  <strong style={behind > 0 ? { color: 'hsl(var(--sev-fg))' } : undefined}>{behind}</strong>
                  <small>还在用旧目录</small>
                </div>
                <div className="release-stat">
                  <span>未上报</span>
                  <strong>{unreported}</strong>
                  <small>没说自己在第几版</small>
                </div>
              </>
            ) : (
              <div className="release-stat t-unknown">
                <span>客户端目录版本</span>
                <strong>不可判断</strong>
                <small>心跳源不是 ready</small>
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="doc-row">
          <div className="doc-row-main">
            <h2>节点目录 YAML</h2>
            <p>编辑、对照和发布都在新后台的「设置 · 目录」，这里只看线上版本。</p>
            <div className="doc-meta">
              <span>线上 r{catalogRevision ?? '—'}</span>
              {catalog.state === 'ready' ? <span>{timestamp(catalog.data.updatedAt)}</span> : null}
            </div>
          </div>
          <a className="btn btn-outline btn-sm" href={CATALOG_EDITOR}>去新后台编辑</a>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="doc-row">
          <div className="doc-row-main">
            <h2>国内直连规则 JSON</h2>
            <p>编辑、关闭网页直连、关掉全部直连都在新后台的「设置 · 分流规则」。</p>
            <div className="doc-meta"><span>线上 r{policyRevision ?? '—'}</span></div>
          </div>
          <a className="btn btn-outline btn-sm" href={POLICY_EDITOR}>去新后台编辑</a>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="card-body">
          <details className="control-history" onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
            <summary>历史版本 · 展开才拉取发布记录</summary>
            {historyOpen && (
              revisions.state === 'error' ? (
                <Unavailable title="发布记录不可用" detail={revisions.message} />
              ) : revisions.state === 'loading' ? (
                <Skeleton label="发布记录" />
              ) : revisions.data.length === 0 ? (
                <p className="muted">还没有发布记录。</p>
              ) : (
                <div className="control-history-list">
                  {revisions.data.map((rev) => (
                    <div className="control-history-row" key={rev.revision}>
                      <span className="mono">r{rev.revision}</span>
                      {rev.current ? <span className="phase-pill t-ok">当前线上</span> : null}
                      <span className="muted">{timestamp(rev.publishedAt)}</span>
                      <span className="muted">{rev.serverCount} 台机器 · {rev.logicalNodeCount} 节点 · {rev.deploymentCount} 部署</span>
                      <span className="mono muted" title={rev.sha256}>{rev.sha256.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </details>
        </div>
      </GlassCard>
    </div>
  );
}
