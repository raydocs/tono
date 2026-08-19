import { Fragment, useState } from 'react';
import {
  operationsApi,
  type LiveAgentDto,
  type LiveDto,
  type LiveQualityNodeDto,
  type NodeProfileDto,
} from '../api';
import { gibibytes, unixDate } from '../lib/fields';
import { formatBytes, formatDuration, timestamp } from '../lib/format';
import { machineSignals, mergedBilling, trafficRemaining } from '../lib/machine';
import { blockLabel, blockStatus, isLikelyBlocked } from '../lib/quality';
import { useRefresh, useResource } from '../hooks';
import { Banner, DataHealth, StateBoundary, Status } from '../ui';
import { AgentTrends } from '../charts';
import { CarrierPing } from '../carriers';
import { worstCarrier } from '../lib/carrier';

const RISK_SIGNAL_LABELS: Record<string, string> = {
  attacker: '攻击者', abuser: '滥用者', threat: '威胁',
  malicious: '恶意', spam: '垃圾邮件', spamhaus: 'SPAMHAUS 名单',
};

function NodeExpand({ node, agent, profile, onProfile }: {
  node: LiveQualityNodeDto;
  agent?: LiveAgentDto;
  profile?: NodeProfileDto;
  onProfile: () => void;
}) {
  const incident = useResource(() => operationsApi.nodeIncident(node.name), [node.name]);
  const [url, setUrl] = useState(profile?.billingUrl ?? '');
  const [quota, setQuota] = useState(profile?.trafficQuotaBytes != null ? String(Math.round(profile.trafficQuotaBytes / (1024 ** 3))) : '');
  const [used, setUsed] = useState(profile?.trafficUsedBytes != null ? String(Math.round(profile.trafficUsedBytes / (1024 ** 3))) : '');
  const [renew, setRenew] = useState(profile?.renewsAt ? new Date(profile.renewsAt * 1000).toISOString().slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trafficQuotaBytes = gibibytes(quota);
    const trafficUsedBytes = gibibytes(used);
    const renewsAt = unixDate(renew);
    const bad = [
      trafficQuotaBytes === 'invalid' ? '套餐 GB' : null,
      trafficUsedBytes === 'invalid' ? '已用 GB' : null,
      renewsAt === 'invalid' ? '续费日期' : null,
    ].filter((label): label is string => label !== null);
    // Nothing partial: one unreadable box holds back the whole save. Sending
    // the fields that did parse would leave the operator looking at a form that
    // is half stored and half not, with no way to tell which half.
    if (
      trafficQuotaBytes === 'invalid'
      || trafficUsedBytes === 'invalid'
      || renewsAt === 'invalid'
    ) {
      setError(`${bad.join('、')}格式不对，这次什么都没保存。`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const payload = {
        catalogName: node.name,
        billingUrl: url.trim() || null,
        trafficQuotaBytes,
        trafficUsedBytes,
        renewsAt,
        publicIp: node.publicIp ?? undefined,
      };
      // The cycle baseline is deliberately absent from an ordinary save. It
      // records the interface counters as they stood when the billing period
      // began, and `trafficRemaining` measures against it — so writing it on
      // every save meant that correcting a typo in the billing URL silently
      // moved the start of the period to now and reported the node as having
      // used nothing. It is set once, when the profile is created, and
      // afterwards only by the button that says it is doing so.
      if (profile) await operationsApi.updateNodeProfile(profile.id, payload);
      else {
        await operationsApi.createNodeProfile({
          ...payload,
          cycleNetIn: agent?.netIn ?? null,
          cycleNetOut: agent?.netOut ?? null,
        });
      }
      onProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function startNewCycle() {
    if (!profile) return;
    setError(null);
    setBusy(true);
    try {
      // Both halves, or the reset does not happen: a hand-entered 已用 wins
      // over the counter arithmetic in `trafficRemaining`, so leaving it in
      // place would hold the old number on screen while the baseline moved
      // underneath it.
      await operationsApi.updateNodeProfile(profile.id, {
        cycleNetIn: agent?.netIn ?? null,
        cycleNetOut: agent?.netOut ?? null,
        trafficUsedBytes: null,
      });
      setUsed('');
      onProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : '这期没清掉');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monitor-detail">
      <div>
        <h4>概况</h4>
        <p>状态：{blockLabel(node)}</p>
        <p>质量：{node.quality === 'poor' ? '差' : '正常'}</p>
        {node.block?.rule ? <p className="muted">{node.block.rule}</p> : null}
        <h4>回大陆延迟</h4>
        <CarrierPing carriers={agent?.carriers ?? null} />
        <h4>对外端口</h4>
        {!node.exposure ? (
          <p className="muted">还没扫过端口。空着不代表安全。</p>
        ) : (
          <>
            {node.exposure.unexpected.length === 0 ? (
              <p>对外只开了 SSH（:{node.exposure.sshPorts.join('、:') || '—'}）和服务端口。</p>
            ) : (
              <p>
                多开了 {node.exposure.unexpected.length} 个端口：
                {node.exposure.unexpected.map((listener) => (
                  <span className="chip chip-risk" key={`exp-${listener.port}`}>
                    :{listener.port}{listener.process ? ` ${listener.process}` : ''}
                  </span>
                ))}
              </p>
            )}
            {node.exposure.acknowledged.map((listener) => (
              <p className="muted" key={`ack-${listener.port}`}>
                已允许 :{listener.port}
                {listener.process ? ` ${listener.process}` : ''}
                {listener.reason ? ` —— ${listener.reason}` : ''}
              </p>
            ))}
          </>
        )}
        {node.riskSignals.length > 0 && (
          <>
            <h4>IP 黑名单</h4>
            <p className="muted">
              查过 17 家名单，少数说有问题先不算。
            </p>
            {node.riskSignals.map((signal) => (
              <p key={`sig-${signal.tag}`}>
                {RISK_SIGNAL_LABELS[signal.tag] ?? signal.tag}：
                {signal.no === 0
                  ? `${signal.yes} 家标了这个`
                  : `${signal.yes} 家说是，${signal.no} 家说不是`}
                {node.riskKeywords.includes(signal.tag) ? '（算）' : '（证据不够，先不算）'}
              </p>
            ))}
          </>
        )}
        {agent ? (
          <p>
            CPU {agent.cpu == null ? '—' : `${Math.round(agent.cpu)}%`}
            {agent.memUsed != null && agent.memTotal != null ? ` · 内存 ${formatBytes(agent.memUsed)} / ${formatBytes(agent.memTotal)}` : ''}
          </p>
        ) : null}
      </div>
      <div>
        <h4>账单</h4>
        {(() => {
          const billing = mergedBilling(profile, agent);
          return billing.source !== 'none' ? (
            <p className="muted">
              {billing.price != null ? `${billing.currency || ''}${billing.price}` : '没有价格'}
              {billing.billingCycle ? ` · ${billing.billingCycle} 天一期` : ''}
              {billing.source === 'komari' ? ' · 来自 Komari' : billing.source === 'mixed' ? ' · 自己填的优先，缺的用 Komari 补' : ' · 自己填的'}
            </p>
          ) : null;
        })()}
        <div className="stack">
          <input className="input compact" placeholder="https://账单页" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input compact" type="number" min={0} placeholder="套餐 GB" value={quota} onChange={(e) => setQuota(e.target.value)} />
          <input className="input compact" type="number" min={0} placeholder="已用 GB（手填）" value={used} onChange={(e) => setUsed(e.target.value)} />
          <input className="input compact" type="date" value={renew} onChange={(e) => setRenew(e.target.value)} />
          <small className="muted">某项要清空：把格子清空再保存。填错不会被当成清空。</small>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>保存</button>
          {profile && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={busy || !agent}
              title={agent ? undefined : '这台没装探针，看不到当前用量'}
              onClick={() => void startNewCycle()}
            >这期用量清零</button>
          )}
          {profile?.billingUrl && (
            <a className="btn btn-outline btn-sm" href={profile.billingUrl} target="_blank" rel="noreferrer">打开账单</a>
          )}
          <Banner message={error} tone="error" />
        </div>
      </div>
      <div>
        <h4>谁在用</h4>
        {incident.state === 'ready' && (incident.data.affected.length > 0
          ? <ul className="detail-list">{incident.data.affected.map((user) => (
            <li key={user.userId}><strong>{user.email}</strong><span className="muted">{user.online ? '在线' : '离线'}</span></li>
          ))}</ul>
          : <span className="muted">现在没人连这台</span>)}
        <details>
          <summary>线路 / 黑名单原文</summary>
          <pre>{node.backtrace || '无'}</pre>
          <pre>{node.securityCheck || '无'}</pre>
        </details>
      </div>
    </div>
  );
}

function MachinePressure({ agents }: { agents: LiveAgentDto[] }) {
  // Recomputed on each render rather than held in state: the only thing that
  // makes it move is a refresh, and a clock ticking on its own would redraw a
  // table nobody asked to change.
  const nowMs = Date.now();
  const rows = agents
    .map((agent) => ({ agent, ...machineSignals(agent, nowMs) }))
    .sort((a, b) => {
      const worst = (r: typeof a) => r.signals.reduce((m, s) => Math.max(m, s.severity), 0);
      const delta = worst(b) - worst(a);
      if (delta !== 0) return delta;
      return (b.perCore ?? 0) - (a.perCore ?? 0);
    });
  const troubled = rows.filter((row) => row.signals.length > 0).length;

  return <section className="card">
    <div className="card-header">
      <div>
        <h2>机器负载</h2>
        <p>{troubled ? `${troubled} 台有告警，排在前面` : '全部正常'}</p>
      </div>
    </div>
    <div className="card-body">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>节点</th><th>CPU</th><th>内存</th><th>磁盘</th>
              <th>负载 1/5/15</th><th>TCP</th><th>运行</th><th>信号</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ agent, signals, memPct, diskPct }) => (
              <tr key={agent.name}>
                <td><strong>{agent.name}</strong>
                  <small className="muted">{agent.cpuCores ? `${agent.cpuCores} 核` : ''}</small></td>
                <td className="mono">{agent.cpu != null ? `${agent.cpu.toFixed(0)}%` : '—'}</td>
                <td className="mono">{memPct != null ? `${memPct.toFixed(0)}%` : '—'}
                  <small className="muted">{formatBytes(agent.memTotal)}</small></td>
                <td className="mono">{diskPct != null ? `${diskPct.toFixed(0)}%` : '—'}</td>
                <td className="mono">
                  {[agent.load1, agent.load5, agent.load15]
                    .map((value) => (value == null ? '—' : value.toFixed(2))).join(' / ')}
                </td>
                <td className="mono">{agent.tcpConnections ?? '—'}</td>
                <td className="muted">{formatDuration(agent.uptime)}</td>
                <td>
                  <div className="chip-list">
                    {signals.length === 0
                      ? <span className="chip chip-muted">正常</span>
                      : signals.map((signal) => (
                        <span
                          className={`chip${signal.severity >= 3 ? ' chip-risk' : ' chip-muted'}`}
                          key={signal.label}
                        >{signal.label}</span>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </section>;
}

export function MonitorPage() {
  const { refreshMs } = useRefresh();
  const resource = useResource(operationsApi.live, [], refreshMs);
  const profilesRes = useResource(operationsApi.nodeProfiles, [], refreshMs);
  const activityRes = useResource(operationsApi.activity, [], refreshMs);
  const metrics = useResource(() => operationsApi.metrics('24h'), [], refreshMs);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [focus, setFocus] = useState<'all' | 'needs' | 'expiring' | 'noprobe'>('all');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newQuota, setNewQuota] = useState('');
  const [newRenew, setNewRenew] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <StateBoundary resource={resource}>{(live: LiveDto) => {
    const qualityNodes = [...(live.quality?.nodes ?? [])].sort((a, b) => {
      const rank = (node: LiveQualityNodeDto) => {
        const status = blockStatus(node);
        if (status === 'LIKELY_BLOCKED') return 0;
        if (status === 'DOWN' || status === 'EDGE_FAIL') return 1;
        if (status === 'DEGRADED') return 2;
        if (node.quality && node.quality !== 'ok') return 3;
        return 4;
      };
      const delta = rank(a) - rank(b);
      return delta !== 0 ? delta : a.name.localeCompare(b.name, 'zh');
    });
    const agents = live.agents ?? [];
    const agentByName = new Map(agents.map((agent) => [agent.name, agent]));
    const profiles = profilesRes.state === 'ready' ? profilesRes.data : [];
    const profileByName = new Map(profiles.map((profile) => [profile.catalogName, profile]));
    const occupancy = new Map<string, number>();
    if (activityRes.state === 'ready') {
      for (const user of activityRes.data.users) {
        if (user.online && user.selectedServer) {
          occupancy.set(user.selectedServer, (occupancy.get(user.selectedServer) ?? 0) + 1);
        }
      }
    }
    const blocked = qualityNodes.filter(isLikelyBlocked);
    const reachable = qualityNodes.filter((node) => ['OK', 'EDGE_OK'].includes(blockStatus(node)));
    const poor = qualityNodes.filter((node) => node.quality === 'poor');
    const needle = query.trim().toLowerCase();
    const nowSec = Math.floor(Date.now() / 1_000);
    const visible = qualityNodes.filter((node) => {
      const status = blockStatus(node);
      if (filter !== 'all' && status !== filter) return false;
      const agent = agentByName.get(node.name);
      const profile = profileByName.get(node.name);
      const billing = mergedBilling(profile, agent);
      if (focus === 'noprobe' && agent) return false;
      if (focus === 'expiring') {
        if (!billing.renewsAt || billing.renewsAt - nowSec > 7 * 86_400) return false;
      }
      if (focus === 'needs') {
        const troubled = status === 'LIKELY_BLOCKED' || status === 'DOWN' || status === 'EDGE_FAIL'
          || node.quality === 'poor' || !agent;
        if (!troubled) return false;
      }
      if (!needle) return true;
      return `${node.name} ${node.host ?? ''} ${node.publicIp ?? ''}`.toLowerCase().includes(needle);
    });
    const agentsConfigured = live.quality?.cnAgentsConfigured;
    const keyOf = (node: LiveQualityNodeDto) => node.publicIp || node.host || node.name;
    const routeChips = (node: LiveQualityNodeDto) =>
      node.routeKeywords.filter((keyword) => !['联通', '电信', '移动'].includes(keyword)).slice(0, 4);
    // A listed exit is the failure customers report as "everything asks me for
    // a captcha", and it is invisible from latency or reachability — the node
    // answers probes perfectly while being useless for real browsing.
    //
    // Shown as a tally rather than a word. securityCheck asks seventeen
    // databases; a node here was reported as attacker/abuser/threat/spamhaus
    // when the evidence was a minority on each, and printing those four words
    // would have sent someone chasing a reputation problem that sixteen
    // databases said was absent. `1/3` cannot mislead in that direction.
    const RISK_LABELS: Record<string, string> = {
      attacker: '攻击者', abuser: '滥用者', threat: '威胁',
      malicious: '恶意', spam: '垃圾邮件', spamhaus: 'SPAMHAUS',
    };
    //
    // Colour follows `riskKeywords` — the collector's considered verdict —
    // rather than a comparison done here. `spamhaus` is a presence claim, not a
    // poll: nothing ever votes "no", so `yes > no` is true for a single source
    // and would paint one database out of seventeen as a unanimous finding. For
    // the same reason it is labelled by source count, not as a fraction.
    const riskChips = (node: LiveQualityNodeDto) => {
      const confirmed = new Set(node.riskKeywords);
      return node.riskSignals
        .filter((signal) => signal.yes > 0)
        .slice(0, 4)
        .map((signal) => ({
          key: signal.tag,
          label: signal.no === 0
            ? `${RISK_LABELS[signal.tag] ?? signal.tag} ${signal.yes} 源`
            : `${RISK_LABELS[signal.tag] ?? signal.tag} ${signal.yes}/${signal.yes + signal.no}`,
          majority: confirmed.has(signal.tag),
        }));
    };
    // Absent is not clean. A node no collector run has looked at is exactly the
    // state the leaked panel lived in for weeks, so it reads as unknown.
    const exposureChip = (node: LiveQualityNodeDto) => {
      if (!node.exposure) return { label: '还没扫端口', tone: 'muted' as const };
      const { unexpected } = node.exposure;
      if (!unexpected.length) return null;
      const first = unexpected[0];
      const rest = unexpected.length > 1 ? ` +${unexpected.length - 1}` : '';
      return {
        label: `对外 :${first.port}${first.process ? ` ${first.process}` : ''}${rest}`,
        tone: 'risk' as const,
      };
    };
    return <div className="stack">
      <DataHealth sources={[
        { label: '账单资料', resource: profilesRes },
        { label: '谁在线', resource: activityRes },
        { label: '趋势', resource: metrics },
        { label: '节点质量', resource },
      ]} />
      {(live.agentsError || live.qualityError) && (
        <Banner
          tone="error"
          message={[
            live.agentsError ? `探针：${live.agentsError}` : null,
            live.qualityError ? `质量：${live.qualityError}` : null,
          ].filter(Boolean).join('；')}
        />
      )}

      {agentsConfigured === 0 && (
        <Banner tone="info" message="大陆三网探针还没配。现在用香港、日本、新加坡测通，不会把海外测通当成没被墙。" />
      )}

      <div className="metrics">
        <article className="metric">
          <div className="metric-label"><span>节点</span></div>
          <div className="metric-value">{qualityNodes.length}</div>
          <div className="metric-hint">更新于 {timestamp(live.quality?.updatedAt)}</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>可达</span></div>
          <div className="metric-value">{reachable.length}</div>
          <div className="metric-hint">大陆正常或边缘能通 · 探针 {agents.length}</div>
        </article>
        <article className={`metric${blocked.length ? ' metric-alert' : ''}`}>
          <div className="metric-label"><span>疑似被墙</span></div>
          <div className="metric-value">{blocked.length}</div>
          <div className="metric-hint">大陆探针 ≥2/3 不通</div>
        </article>
        <article className={`metric${poor.length ? ' metric-warn' : ''}`}>
          <div className="metric-label"><span>质量差</span></div>
          <div className="metric-value">{poor.length}</div>
          <div className="metric-hint">{poor.length ? poor.map((n) => n.name).join('、') : '只有问题比较大才会标'}</div>
        </article>
      </div>

      {agents.length > 0 && <MachinePressure agents={agents} />}
      {metrics.state === 'ready' && <AgentTrends metrics={metrics.data} />}

      <section className="card">
        <div className="card-header">
          <div>
            <h2>补账单资料</h2>
            <p>到期日和流量额度以这里填的为准，没填的才用 Komari。价格和周期只有 Komari 有。</p>
          </div>
        </div>
        <div className="card-body">
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
                profilesRes.reload();
              } catch (err) {
                setNewError(err instanceof Error ? err.message : '没保存成');
              } finally {
                setBusy(false);
              }
            }}
          >
            <input className="input compact" placeholder="节点名（要和探测里的名字一致）" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={busy} />
            <input className="input compact" placeholder="https://账单页" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} disabled={busy} />
            <input className="input compact" type="number" min={0} placeholder="套餐 GB" value={newQuota} onChange={(e) => setNewQuota(e.target.value)} disabled={busy} />
            <input className="input compact" type="date" value={newRenew} onChange={(e) => setNewRenew(e.target.value)} disabled={busy} />
            <button className="btn btn-sm" type="submit" disabled={busy || !newName.trim()}>保存</button>
          </form>
          <Banner message={newError} tone="error" />
        </div>
      </section>

      <div className="card">
        <div className="card-header monitor-toolbar">
          <div>
            <h2>服务器</h2>
            <p>卡片看状态，表格做批量对照</p>
          </div>
          <div className="form-row">
            <input className="input compact" type="search" placeholder="搜索名称 / IP" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className="input compact" value={focus} onChange={(event) => setFocus(event.target.value as typeof focus)}>
              <option value="all">全部</option>
              <option value="needs">需要处理</option>
              <option value="expiring">即将到期</option>
              <option value="noprobe">未安装探针</option>
            </select>
            <select className="input compact" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="LIKELY_BLOCKED">疑似被墙</option>
              <option value="OK">大陆正常</option>
              <option value="EDGE_OK">边缘可达</option>
              <option value="EDGE_FAIL">边缘不通</option>
              <option value="DOWN">不通</option>
            </select>
            <button type="button" className={`btn btn-sm ${view === 'cards' ? '' : 'btn-outline'}`} onClick={() => setView('cards')}>卡片</button>
            <button type="button" className={`btn btn-sm ${view === 'table' ? '' : 'btn-outline'}`} onClick={() => setView('table')}>表格</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => resource.reload()}>刷新</button>
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="state"><strong>没有符合条件的节点</strong></div>
        ) : view === 'cards' ? (
          <div className="server-grid">
            {visible.map((node) => {
              const agent = agentByName.get(node.name);
              const profile = profileByName.get(node.name);
              const remain = trafficRemaining(profile, agent);
              const billing = mergedBilling(profile, agent);
              const opened = open === keyOf(node);
              const worst = worstCarrier(agent?.carriers ?? null);
              return (
                <button
                  type="button"
                  key={keyOf(node)}
                  className={`server-card${opened ? ' open' : ''}`}
                  onClick={() => setOpen(opened ? null : keyOf(node))}
                >
                  <div className="server-card-top">
                    <div>
                      <strong>{node.name}</strong>
                      <div className="muted">{node.publicIp || node.host || '—'}</div>
                    </div>
                    <span className={`status status-${blockStatus(node) === 'OK' || blockStatus(node) === 'EDGE_OK' ? 'active' : blockStatus(node) === 'LIKELY_BLOCKED' ? 'degraded' : 'planned'}`}>
                      {blockLabel(node)}
                    </span>
                  </div>
                  <div className="server-card-meta">
                    <span>探针 {agent ? `CPU ${agent.cpu != null ? `${Math.round(agent.cpu)}%` : '—'}` : '没装'}</span>
                    <span>在用 {activityRes.state === 'ready' ? (occupancy.get(node.name) ?? 0) : '—'}</span>
                    <span>余量 {remain == null ? '—' : formatBytes(remain)}</span>
                    <span>续费 {billing.renewsAt ? timestamp(billing.renewsAt) : '—'}</span>
                    <span>{worst ? `${worst.label} ${worst.latencyText}` : '延迟未测'}</span>
                    <span>内存 {agent?.memUsed != null && agent.memTotal ? `${Math.round((agent.memUsed / agent.memTotal) * 100)}%` : '—'}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {open && visible.some((node) => keyOf(node) === open) && (
            <div className="card-body">
              {visible.filter((node) => keyOf(node) === open).map((node) => (
                <NodeExpand
                  key={keyOf(node)}
                  node={node}
                  agent={agentByName.get(node.name)}
                  profile={profileByName.get(node.name)}
                  onProfile={profilesRes.reload}
                />
              ))}
            </div>
          )}
        ) : (
          <div className="table-wrap">
            <table className="monitor-table">
              <thead>
                <tr><th>节点</th><th>状态</th><th>探针</th><th>占用</th><th>余量</th><th>续费</th><th>回程</th></tr>
              </thead>
              <tbody>{visible.map((node) => {
                const agent = agentByName.get(node.name);
                const profile = profileByName.get(node.name);
                const remain = trafficRemaining(profile, agent);
                const billing = mergedBilling(profile, agent);
                const status = blockStatus(node);
                const opened = open === keyOf(node);
                return <Fragment key={keyOf(node)}>
                  <tr className={opened ? 'open' : undefined} onClick={() => setOpen(opened ? null : keyOf(node))}>
                    <td>
                      <strong>{node.name}</strong>
                      <small className="mono">{node.publicIp || node.host || '—'}</small>
                    </td>
                    <td><span className={`status status-${status === 'OK' || status === 'EDGE_OK' ? 'active' : status === 'LIKELY_BLOCKED' ? 'degraded' : 'planned'}`}>{blockLabel(node)}</span></td>
                    <td>
                      {agent ? <Status value="active" /> : <span className="muted">没装探针</span>}
                      {agent?.cpu != null && <small className="muted">CPU {Math.round(agent.cpu)}%</small>}
                    </td>
                    <td className="mono">
                      {activityRes.state === 'ready' ? (occupancy.get(node.name) ?? 0) : '—'}
                    </td>
                    <td className="mono">{remain == null ? '—' : formatBytes(remain)}</td>
                    <td className="muted">
                      {billing.renewsAt ? timestamp(billing.renewsAt) : '—'}
                      {billing.price != null && (
                        <small className="muted">{billing.currency || ''}{billing.price}</small>
                      )}
                      {profile?.billingUrl && (
                        <a className="btn btn-outline btn-sm" href={profile.billingUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>打开账单</a>
                      )}
                    </td>
                    <td>
                      <div className="chip-list">
                        {(() => {
                          // Only the carrier doing worst, and only when something
                          // was actually probed. A row that says nothing is
                          // correct here; a row that says "0 ms" would not be.
                          const worst = worstCarrier(agent?.carriers ?? null);
                          if (!worst) return null;
                          const bad = worst.lossTone === 'bad' || worst.latencyTone === 'bad';
                          return (
                            <span
                              className={`chip${bad ? ' chip-risk' : ' chip-muted'}`}
                              title={worst.detail}
                            >
                              {worst.label} {worst.latencyText}
                              {worst.lossPct ? ` · 丢包 ${worst.lossText}` : ''}
                            </span>
                          );
                        })()}
                        {(() => {
                          const chip = exposureChip(node);
                          return chip ? (
                            <span className={`chip chip-${chip.tone === 'risk' ? 'risk' : 'muted'}`}>
                              {chip.label}
                            </span>
                          ) : null;
                        })()}
                        {riskChips(node).map((signal) => (
                          <span
                            className={`chip${signal.majority ? ' chip-risk' : ' chip-muted'}`}
                            key={`risk-${signal.key}`}
                          >
                            {signal.label}
                          </span>
                        ))}
                        {routeChips(node).map((keyword) => (
                          <span className={`chip${/9929|CMIN2|CN2|GIA/.test(keyword) ? ' chip-hot' : ''}`} key={keyword}>{keyword}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {opened && (
                    <tr className="detail-row">
                      <td colSpan={7}>
                        <NodeExpand
                          node={node}
                          agent={agent}
                          profile={profile}
                          onProfile={profilesRes.reload}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>;
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>;
  }}</StateBoundary>;
}
