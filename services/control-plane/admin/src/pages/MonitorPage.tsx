import { useEffect, useMemo, useState } from 'react';
import {
  operationsApi,
  type FleetNodeDto,
  type FleetSourceDto,
  type LiveAgentDto,
} from '../api';
import { AgentTrends } from '../charts';
import { CarrierLegend } from '../carriers';
import { gibibytes, unixDate } from '../lib/fields';
import { formatBytes, formatDuration } from '../lib/format';
import { formatOpsHash } from '../lib/hash';
import { machineSignals } from '../lib/machine';
import {
  isMonitorFocus,
  nodeMatchesFocus,
  nodeSearchHaystack,
  sortOpsNodes,
  nodeAttentionLabel,
  type OpsNodeView,
} from '../lib/ops-views';
import { useOpsRoute } from '../lib/route';
import { NodeCard } from '../NodeCard';
import { useOpsWorld } from '../ops-context';
import { usePrivacy } from '../privacy';
import { Banner, DataHealth, Empty, FilterChips, GlassCard, Skeleton, Unavailable } from '../ui';
import { NodeDrawer } from './monitor/NodeDrawer';

const FILTERS = [
  { id: '', label: '全部' },
  { id: 'needs', label: '需处理' },
  { id: 'loss', label: '高丢包' },
  { id: 'blocked', label: '被墙' },
  { id: 'offline', label: '离线' },
  { id: 'pressure', label: '高负载' },
  { id: 'expiring', label: '将到期' },
  { id: 'unfilled-renew', label: '续费未填' },
  { id: 'noprobe', label: '没探针' },
  { id: 'unknown', label: '数据未知' },
];

function FleetQueue({
  nodes,
  views,
  catalogSource,
}: {
  nodes: FleetNodeDto[];
  views: OpsNodeView[];
  catalogSource?: FleetSourceDto;
}) {
  const { openNode } = useOpsRoute();
  const viewBy = new Map(views.map((node) => [node.name, node]));
  const needs = [...nodes]
    .filter((node) => node.needsAttention)
    .sort((a, b) => (viewBy.get(b.name)?.occupancy ?? -1) - (viewBy.get(a.name)?.occupancy ?? -1)
      || a.name.localeCompare(b.name, 'zh'));

  if (needs.length === 0) {
    return <p className="muted">没有待处理机队项。问题节点已经排在卡片前面。</p>;
  }

  return (
    <div className="fleet-list">
      {catalogSource && catalogSource.state !== 'ready' && (
        <Banner tone="error" message={`目录状态未知：${catalogSource.message || '目录源当前不可读'}。`} />
      )}
      {needs.map((node) => {
        const view = viewBy.get(node.name);
        const occupancy = view
          ? (view.occupancyState === 'known' ? `${view.occupancy ?? 0} 人` : '占用不可判断')
          : '—';
        return (
          <article className="fleet-row fleet-row-alert" key={node.name}>
            <div className="fleet-identity">
              <strong>{node.name}</strong>
              <small>{view ? (view.catalogState === 'known-listed' ? '在售' : view.catalogState === 'known-unlisted' ? '不在目录' : '目录未知') : '—'}</small>
            </div>
            <div className="fleet-impact">
              <strong>{occupancy}</strong>
              <small>{view?.blockLabel}</small>
            </div>
            <div className="row-actions">
              <button className="btn btn-outline btn-sm" type="button" onClick={() => openNode(node.name)}>打开处理</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function MachinePressure({ nodes }: { nodes: OpsNodeView[] }) {
  const nowMs = Date.now();
  const rows = nodes
    .filter((node) => node.agent)
    .map((node) => ({ node, agent: node.agent as LiveAgentDto, ...machineSignals(node.agent as LiveAgentDto, nowMs) }))
    .sort((a, b) => {
      const worst = (row: typeof a) => row.signals.reduce((max, signal) => Math.max(max, signal.severity), 0);
      const delta = worst(b) - worst(a);
      return delta !== 0 ? delta : (b.perCore ?? 0) - (a.perCore ?? 0);
    });
  if (rows.length === 0) return <p className="muted">没有探针负载可表。</p>;
  return (
    <div className="table-scroll monitor-wide">
      <table>
        <thead>
          <tr>
            <th>节点</th><th>CPU</th><th>内存</th><th>磁盘</th>
            <th>负载 1/5/15</th><th>TCP</th><th>运行</th><th>信号</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, agent, signals, memPct, diskPct }) => (
            <tr key={node.name}>
              <td><strong>{agent.name}</strong><small className="muted">{agent.cpuCores ? `${agent.cpuCores} 核` : ''}</small></td>
              <td className="mono">{agent.cpu != null ? `${agent.cpu.toFixed(0)}%` : '—'}</td>
              <td className="mono">{memPct != null ? `${memPct.toFixed(0)}%` : '—'}<small className="muted">{formatBytes(agent.memTotal)}</small></td>
              <td className="mono">{diskPct != null ? `${diskPct.toFixed(0)}%` : '—'}</td>
              <td className="mono">{[agent.load1, agent.load5, agent.load15].map((value) => (value == null ? '—' : value.toFixed(2))).join(' / ')}</td>
              <td className="mono">{agent.tcpConnections ?? '—'}</td>
              <td className="muted">{formatDuration(agent.uptime)}</td>
              <td>
                <div className="chip-list">
                  {signals.length === 0
                    ? <span className="chip chip-muted">正常</span>
                    : signals.map((signal) => (
                      <span className={`chip${signal.severity >= 3 ? ' chip-risk' : ' chip-muted'}`} key={signal.label}>{signal.label}</span>
                    ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeTable({
  nodes,
  selected,
  onOpen,
}: {
  nodes: OpsNodeView[];
  selected: string | null;
  onOpen: (name: string) => void;
}) {
  const privacy = usePrivacy();
  return (
    <div className="table-wrap monitor-table-wrap monitor-wide">
      <table className="monitor-table">
        <thead>
          <tr><th>节点</th><th>状态</th><th>探针</th><th>占用</th><th>余量</th><th>续费</th><th>目录</th></tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr
              key={node.name}
              className={selected === node.name ? 'open' : undefined}
              onClick={() => onOpen(node.name)}
            >
              <td>
                <strong>{node.name}</strong>
                <small className="mono">{privacy.ip(node.quality?.publicIp || node.quality?.host || node.profile?.publicIp)}</small>
              </td>
              <td>{nodeAttentionLabel(node)}</td>
              <td>
                {node.agentState === 'unavailable' ? '探针源不可用'
                  : node.agentState === 'unreported' ? '没装探针'
                    : node.agentState === 'stale' ? '探针过期'
                      : '已上报'}
                {node.agent?.cpu != null && <small className="muted">CPU {Math.round(node.agent.cpu)}%</small>}
              </td>
              <td className="mono">{node.occupancyState === 'known' ? node.occupancy : '—'}</td>
              <td className="mono">{node.trafficRemain == null ? '—' : formatBytes(node.trafficRemain)}</td>
              <td className="muted">{node.billing.renewsAt ? new Date(node.billing.renewsAt * 1000).toLocaleDateString('zh-CN') : '—'}</td>
              <td>{node.catalogState === 'known-listed' ? '在售' : node.catalogState === 'known-unlisted' ? '不在目录' : '未知'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingCreate({ onSaved }: { onSaved: () => void }) {
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newQuota, setNewQuota] = useState('');
  const [newRenew, setNewRenew] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form-row"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!newName.trim()) return;
        const trafficQuotaBytes = gibibytes(newQuota);
        const renewsAt = unixDate(newRenew);
        if (trafficQuotaBytes === 'invalid' || renewsAt === 'invalid') {
          setNewError('套餐或续费日期格式不对，没保存。');
          return;
        }
        setNewError(null);
        setBusy(true);
        try {
          await operationsApi.createNodeProfile({
            catalogName: newName.trim(),
            billingUrl: newUrl.trim() || null,
            trafficQuotaBytes,
            renewsAt,
          });
          setNewName('');
          setNewUrl('');
          setNewQuota('');
          setNewRenew('');
          onSaved();
        } catch (err) {
          setNewError(err instanceof Error ? err.message : '没保存成');
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="input compact" aria-label="节点名" placeholder="节点名（要和探测里的名字一致）" value={newName} onChange={(event) => setNewName(event.target.value)} disabled={busy} />
      <input className="input compact sensitive-value" aria-label="账单页" placeholder="https://账单页" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} disabled={busy} />
      <input className="input compact" aria-label="套餐 GB" type="number" min={0} placeholder="套餐 GB" value={newQuota} onChange={(event) => setNewQuota(event.target.value)} disabled={busy} />
      <input className="input compact" aria-label="续费日期" type="date" value={newRenew} onChange={(event) => setNewRenew(event.target.value)} disabled={busy} />
      <button className="btn btn-sm" type="submit" disabled={busy || !newName.trim()}>保存</button>
      <Banner message={newError} tone="error" />
    </form>
  );
}

export function MonitorPage() {
  const world = useOpsWorld();
  const privacy = usePrivacy();
  const { route, setRoute, openNode, closeDrawer } = useOpsRoute();
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [query, setQuery] = useState(route.q ?? '');
  useEffect(() => { setQuery(route.q ?? ''); }, [route.q]);
  useEffect(() => {
    // A persisted search can contain an IP. Entering screenshot/privacy mode
    // must remove it from the browser URL as well as obscuring the input.
    if (privacy.privacy && route.q) {
      const next = formatOpsHash({ ...route, page: 'monitor', q: null });
      history.replaceState(null, '', next);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }, [privacy.privacy, route]);
  const focus = isMonitorFocus(route.focus) ? route.focus : null;
  const nowSec = world.nowSec;
  const live = world.live.state === 'ready' ? world.live.data : null;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = world.nodes.filter((node) => {
      if (!nodeMatchesFocus(node, focus, nowSec)) return false;
      if (!needle) return true;
      return nodeSearchHaystack(node).includes(needle);
    });
    return sortOpsNodes(filtered);
  }, [world.nodes, focus, query, nowSec]);

  function onSearch(value: string) {
    setQuery(value);
    const next = formatOpsHash({
      ...route,
      page: 'monitor',
      q: privacy.privacy ? null : value.trim() || null,
    });
    if (window.location.hash !== next) history.replaceState(null, '', next);
  }

  const selected = world.nodes.find((node) => node.name === route.node) ?? null;
  const loading = world.nodes.length === 0 && (world.live.state === 'loading' || world.catalog.state === 'loading');

  return (
    <div className={`stack monitor-page monitor-view-${view}`}>
      <DataHealth sources={[
        { label: '节点质量', resource: world.live },
        { label: '账单资料', resource: world.profiles },
        { label: '谁在线', resource: world.activity },
        { label: '目录', resource: world.catalog },
        { label: '趋势', resource: world.metrics },
      ]} />
      {live?.agentsError && <Banner tone="error" message={`探针源不可用：${live.agentsError}。不能据此判断没装探针。`} />}
      {live?.qualityError && <Banner tone="error" message={`质量源不可用：${live.qualityError}。不能把空着写成大陆未测。`} />}
      {world.activity.state === 'error' && !world.activity.refreshedAt && (
        <Banner tone="error" message="心跳源不可用，占用显示为不可判断，不会写成 0 人。" />
      )}
      {live?.quality?.cnAgentsConfigured === 0 && (
        <Banner tone="info" message="大陆三网探针还没配。现在用香港、日本、新加坡测通，不会把海外测通当成没被墙。" />
      )}

      <div className="monitor-toolbar customer-toolbar">
        <input
          className="input compact search-input sensitive-value"
          type="search"
          aria-label="搜索服务器"
          placeholder="搜索名称 / IP / 商家 / 路线"
          value={query}
          onChange={(event) => onSearch(event.target.value)}
        />
        <button type="button" className={`btn btn-sm ${view === 'cards' ? '' : 'btn-outline'}`} onClick={() => setView('cards')}>卡片</button>
        <button type="button" className={`btn btn-sm view-toggle-table ${view === 'table' ? '' : 'btn-outline'}`} onClick={() => setView('table')}>表格</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { world.live.reload(); world.activity.reload(); world.profiles.reload(); }}>刷新</button>
      </div>
      <FilterChips
        value={focus ?? ''}
        options={FILTERS}
        onChange={(id) => setRoute((current) => ({ ...current, page: 'monitor', focus: id || null }))}
      />
      <div className="count-line">
        <span>{visible.length} / {world.nodes.length} 台 · 卡片和表格同一份全集</span>
        <CarrierLegend />
      </div>

      {loading ? (
        <Skeleton label="正在加载服务器" />
      ) : world.live.state === 'error' && world.nodes.length === 0 ? (
        <Unavailable title="服务器数据没加载上来" detail={world.live.state === 'error' ? world.live.message : undefined} />
      ) : visible.length === 0 ? (
        <GlassCard>
          <Empty
            title="没有符合条件的节点"
            detail={`全集里有 ${world.nodes.length} 台。换个筛选或清空搜索再看。`}
          />
        </GlassCard>
      ) : (
        <>
          <div className="node-grid">
            {visible.map((node) => (
              <NodeCard
                key={node.name}
                node={node}
                density="full"
                selected={route.node === node.name}
                onOpen={() => (route.node === node.name ? closeDrawer() : openNode(node.name))}
              />
            ))}
          </div>
          <NodeTable
            nodes={visible}
            selected={route.node}
            onOpen={(name) => (route.node === name ? closeDrawer() : openNode(name))}
          />
        </>
      )}

      <NodeDrawer
        key={`${selected?.name ?? 'none'}:${selected?.profile?.id ?? 'new'}:${focus ?? ''}`}
        node={selected}
        open={Boolean(route.node)}
        metrics={world.metrics.snapshotKey === '24h' && world.metrics.state === 'ready' ? world.metrics.data : null}
        focus={focus}
        onClose={closeDrawer}
        onChanged={() => { world.live.reload(); world.profiles.reload(); world.fleet.reload(); world.catalog.reload(); world.activity.reload(); }}
      />

      <div className="monitor-secondary">
        <details>
          <summary>机队处理队列</summary>
          {world.fleet.state === 'ready'
            ? <FleetQueue nodes={world.fleet.data.nodes} views={world.nodes} catalogSource={world.fleet.data.sources.catalog} />
            : world.fleet.state === 'error'
              ? <Unavailable title="机队队列没加载上来" detail={world.fleet.message} />
              : <Skeleton label="机队" />}
        </details>
        <details>
          <summary>机器负载表</summary>
          <MachinePressure nodes={world.nodes} />
        </details>
        <details>
          <summary>全机队 24h 趋势</summary>
          {world.metrics.snapshotKey === '24h' && world.metrics.state === 'ready'
            ? <AgentTrends metrics={world.metrics.data} />
            : <p className="muted">24h 趋势还没绑定到当前快照。</p>}
        </details>
        <details>
          <summary>补账单资料</summary>
          <BillingCreate onSaved={() => world.profiles.reload()} />
        </details>
      </div>
    </div>
  );
}
