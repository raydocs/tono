import { Fragment, StrictMode, useEffect, useMemo, useState, type FormEvent, type ReactNode, type SVGProps } from 'react';
import { createRoot } from 'react-dom/client';
import {
  operationsApi,
  type ActivityDto,
  type DashboardDto,
  type HomeExitDto,
  type LiveDto,
  type LiveQualityNodeDto,
  type NodeProfileDto,
  type ProductAccountDto,
  type TrafficPolicyDto,
  type UserDetailDto,
  type UserDto,
} from './api';
import './styles.css';

type Page = 'dashboard' | 'users' | 'monitor' | 'control';
type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

const pages: Array<{ id: Page; label: string; group: string }> = [
  { id: 'dashboard', label: '今日', group: '日常' },
  { id: 'users', label: '客户', group: '日常' },
  { id: 'monitor', label: '服务器', group: '日常' },
  { id: 'control', label: '目录与策略', group: '配置' },
];

function Icon({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon" aria-hidden {...props}>
      <path d={d} />
    </svg>
  );
}

const icons: Record<Page, string> = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  monitor: 'M22 12h-4l-3 9L9 3l-3 9H2',
  control: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
};

function currentPage(): Page {
  const value = window.location.hash.replace(/^#\/?/, '');
  if (value === 'homes') return 'users';
  if (value === 'servers' || value === 'nodes' || value === 'catalog') return 'control';
  return pages.some((page) => page.id === value) ? value as Page : 'dashboard';
}

function usePage() {
  const [page, setPage] = useState(currentPage);
  useEffect(() => {
    const update = () => setPage(currentPage());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return page;
}

function useResource<T>(load: () => Promise<T>, deps: unknown[] = []): Resource<T> & { reload: () => void } {
  const [tick, setTick] = useState(0);
  const [resource, setResource] = useState<Resource<T>>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    setResource({ state: 'loading' });
    load().then(
      (data) => active && setResource({ state: 'ready', data }),
      (error: unknown) => active && setResource({
        state: 'error',
        message: error instanceof Error ? error.message : 'Unable to load operations data',
      }),
    );
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { ...resource, reload: () => setTick((value) => value + 1) };
}

function timestamp(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Date(value * 1_000).toLocaleString();
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 'B';
  for (const next of units) {
    if (size < 1024) break;
    size /= 1024;
    unit = next;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${unit}`;
}

function timeAgo(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const seconds = Math.max(0, Math.floor(Date.now() / 1_000) - value);
  if (seconds < 90) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/**
 * Line-level extraction of every proxy `name` under the `proxies:` list of a
 * plaintext Clash catalog. Mirrors the worker's catalogProxyName parsing;
 * quoted names are unescaped.
 */
function catalogProxyNames(yaml: string): string[] {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const names: string[] = [];
  let inProxies = false;
  let blockIndent: number | null = null;
  let pendingBlock = false;
  for (const line of lines) {
    if (!inProxies) {
      if (/^proxies\s*:/.test(line)) inProxies = true;
      continue;
    }
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent === 0 && !line.trimStart().startsWith('-')) break;
    if (/^\s*-\s/.test(line)) {
      if (blockIndent === null) blockIndent = indent;
      if (indent !== blockIndent) continue;
      pendingBlock = true;
    } else if (!pendingBlock) {
      continue;
    }
    const match = line.match(
      /^\s*(?:-\s+)?name:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s#]+))\s*(?:#.*)?$/,
    );
    if (match) {
      const raw = match[1] ?? match[2] ?? match[3] ?? '';
      names.push(raw.replace(/\\(["'\\])/g, '$1'));
      pendingBlock = false;
    }
  }
  return names;
}

const statusLabels: Record<string, string> = {
  active: '正常',
  disabled: '已销户',
  retired: '停用',
  banned: '已封',
  assigned: '在用',
  pooled: '库存',
  pending: '待确认',
  revoked: '已撤销',
  degraded: '异常',
  failed: '失败',
  alive: '通',
  dead: '不通',
  untested: '未测',
};

function Status({ value }: { value: string }) {
  const key = value.replaceAll('_', '-');
  return <span className={`status status-${key}`}>{statusLabels[value] ?? value.replaceAll('_', ' ')}</span>;
}

const blockLabels: Record<string, string> = {
  OK: '大陆正常',
  LIKELY_BLOCKED: '疑似被墙',
  DEGRADED: '部分不通',
  EDGE_OK: '边缘可达',
  EDGE_FAIL: '边缘不通',
  DOWN: '不通',
  UNPROBED: '未测大陆',
  PROBE_PARTIAL: '未测大陆',
  CHECK_FAILED: '基线失败',
};

function blockStatus(node: LiveQualityNodeDto) {
  return node.block?.status || (node.ok ? 'OK' : 'DOWN');
}

function blockLabel(node: LiveQualityNodeDto) {
  const status = blockStatus(node);
  return node.block?.label || blockLabels[status] || status;
}

function isLikelyBlocked(node: LiveQualityNodeDto) {
  return blockStatus(node) === 'LIKELY_BLOCKED';
}

function probeRatio(probe: { success?: number; total?: number } | null | undefined) {
  if (!probe || probe.total == null) return '—';
  return `${probe.success ?? 0}/${probe.total}`;
}

function StateBoundary<T>({ resource, empty, children }: {
  resource: Resource<T>;
  empty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (resource.state === 'loading') {
    return <div className="state"><span className="spinner" /><strong>加载中</strong><span>正在读取控制面数据…</span></div>;
  }
  if (resource.state === 'error') {
    return <div className="state state-error"><strong>无法加载</strong><span>{resource.message}</span></div>;
  }
  if (empty?.(resource.data)) {
    return <div className="state"><strong>暂无数据</strong><span>当前没有记录。</span></div>;
  }
  return children(resource.data);
}

function Banner({ message, tone = 'info' }: { message: string | null; tone?: 'info' | 'error' | 'ok' }) {
  if (!message) return null;
  return <div className={`banner banner-${tone}`}>{message}</div>;
}

function UsageLeaderboard({ users }: { users: UserDto[] }) {
  const top = useMemo(
    () => [...users].sort((a, b) => b.usageBytes - a.usageBytes).slice(0, 5),
    [users],
  );
  if (!top.some((user) => user.usageBytes > 0)) {
    return <div className="state"><strong>暂无流量数据</strong><span>VPS 出口还没把每人用量报上来，现在库里都是 0。</span></div>;
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

function Dashboard() {
  const resource = useResource(operationsApi.dashboard);
  const live = useResource(operationsApi.live);
  const usersRes = useResource(operationsApi.users);
  const activityRes = useResource<ActivityDto>(operationsApi.activity);
  const auditRes = useResource(operationsApi.audit);
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
            <div className="attention-ok">✓ 所有节点与用户状态正常</div>
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

function OnboardCard({ unusedHomes, pooledAccounts, onDone }: {
  unusedHomes: HomeExitDto[];
  pooledAccounts: ProductAccountDto[];
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [line, setLine] = useState('');
  const [homeExitId, setHomeExitId] = useState('');
  const [accountRef, setAccountRef] = useState('');
  const [productAccountId, setProductAccountId] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await operationsApi.onboardUser({
        email: email.trim(),
        line: line.trim() || undefined,
        homeExitId: homeExitId || undefined,
        accountRef: accountRef.trim() || undefined,
        productAccountId: productAccountId || undefined,
        contact: contact.trim() || undefined,
      });
      if (result.incomplete.includes('user_not_registered')) {
        setMessage(`已授权 ${result.email}。客户登录后再回来派线和开号。`);
      } else if (result.incomplete.length > 0) {
        const missing = result.incomplete.map((item) => item === 'claude' ? 'Claude 号' : item).join('、');
        setMessage(`${result.email} 已处理，仍缺：${missing}`);
      } else {
        setMessage(`${result.email} 已开通`);
        setEmail('');
        setLine('');
        setHomeExitId('');
        setAccountRef('');
        setProductAccountId('');
        setContact('');
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '开通失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>新开一单</h2>
          <p>邮箱进白名单。已注册的用户可以同时粘贴家宽并登记 Claude 号。</p>
        </div>
      </div>
      <div className="card-body">
        <Banner message={error} tone="error" />
        <Banner message={message} tone="ok" />
        <form className="onboard-form" onSubmit={submit}>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="客户邮箱" disabled={busy} />
          <input className="input" value={line} onChange={(e) => setLine(e.target.value)} placeholder="家宽 host:port:user:pass" disabled={busy} spellCheck={false} autoComplete="off" />
          <input className="input" value={accountRef} onChange={(e) => setAccountRef(e.target.value)} placeholder="Claude 账号标识" disabled={busy} />
          <button className="btn" type="submit" disabled={busy || !email.trim()}>开通</button>
          <details className="onboard-more">
            <summary>更多选项</summary>
            <div className="form-grid">
              <label>
                <span>微信 / 联系</span>
                <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} disabled={busy} />
              </label>
              <label>
                <span>库存家宽</span>
                <select className="input" value={homeExitId} onChange={(e) => setHomeExitId(e.target.value)} disabled={busy || unusedHomes.length === 0}>
                  <option value="">{unusedHomes.length ? '不从库存选' : '无未派库存'}</option>
                  {unusedHomes.map((home) => (
                    <option key={home.id} value={home.id}>{home.displayName} · {home.socks5Host}:{home.socks5Port}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>号池</span>
                <select className="input" value={productAccountId} onChange={(e) => setProductAccountId(e.target.value)} disabled={busy || pooledAccounts.length === 0}>
                  <option value="">{pooledAccounts.length ? '不从号池选' : '号池为空'}</option>
                  {pooledAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.accountRef}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </form>
      </div>
    </section>
  );
}

function UsersPage() {
  const users = useResource(operationsApi.users);
  const allowlist = useResource(operationsApi.signupAllowlist);
  const homes = useResource(operationsApi.homeExits);
  const catalog = useResource(operationsApi.exitCatalog);
  const pooled = useResource(() => operationsApi.productAccounts('pooled'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindPick, setBindPick] = useState<Record<string, string>>({});
  const [defaultPick, setDefaultPick] = useState<Record<string, string>>({});
  const [assignLine, setAssignLine] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expiryPick, setExpiryPick] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [showAllowlist, setShowAllowlist] = useState(false);

  const reloadAll = () => {
    users.reload();
    allowlist.reload();
    homes.reload();
    catalog.reload();
    pooled.reload();
  };

  async function removeAllow(address: string) {
    if (!confirm(`撤销注册资格：${address}？已有账号不会被禁用。`)) return;
    setBusy(true);
    setError(null);
    try {
      await operationsApi.removeSignupEmail(address);
      setMessage(`已撤销 ${address}`);
      allowlist.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: UserDto) {
    if (user.status === 'active') {
      if (!confirm(`退款销户 ${user.email}？立刻不能登录，设备撤销，家宽解绑回库存。`)) return;
    } else if (!confirm(`恢复账号 ${user.email}？`)) return;
    setBusy(true);
    setError(null);
    try {
      if (user.status === 'active') {
        await operationsApi.closeUser(user.id);
        setMessage(`已销户 ${user.email}`);
      } else {
        await operationsApi.setUserStatus(user.id, 'active');
        setMessage(`已恢复 ${user.email}`);
      }
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态更新失败');
    } finally {
      setBusy(false);
    }
  }

  async function setExpiry(user: UserDto, expiresAt: number | null) {
    setBusy(true);
    setError(null);
    try {
      await operationsApi.setUserExpiry(user.id, expiresAt);
      setMessage(expiresAt === null
        ? `已清除 ${user.email} 的到期时间（不再过期）`
        : `${user.email} 到期时间已设为 ${timestamp(expiresAt)}`);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '到期时间更新失败');
    } finally {
      setBusy(false);
    }
  }

  async function applyExpiryPick(user: UserDto) {
    const value = expiryPick[user.id];
    if (!value) {
      setError('请先选择到期日期时间');
      return;
    }
    const seconds = Math.floor(new Date(value).getTime() / 1_000);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      setError('到期时间无效');
      return;
    }
    await setExpiry(user, seconds);
  }

  async function bindHome(user: UserDto) {
    const homeExitId = bindPick[user.id] || user.homeBinding?.homeExitId;
    if (!homeExitId) {
      setError('请先选择家庭出口');
      return;
    }
    const defaultProxyName = defaultPick[user.id] ?? user.homeBinding?.defaultProxyName ?? '';
    setBusy(true);
    setError(null);
    try {
      const binding = await operationsApi.bindUserHome(user.id, {
        homeExitId,
        defaultProxyName: defaultProxyName || null,
      });
      setMessage(binding.defaultProxyName
        ? `已绑定 ${user.email} → ${binding.displayName}（${binding.proxyName}），默认 VPS：${binding.defaultProxyName}`
        : `已绑定 ${user.email} → ${binding.displayName}（${binding.proxyName}）`);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '绑定失败');
    } finally {
      setBusy(false);
    }
  }

  async function assignPasted(user: UserDto) {
    const line = (assignLine[user.id] ?? '').trim();
    if (!line) {
      setError('先粘贴 host:port:user:pass');
      return;
    }
    if (user.homeBinding && !confirm(`更换 ${user.email} 的家宽？旧线若无人使用将停用。`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await operationsApi.assignHomeLine({
        userId: user.id,
        line,
        defaultProxyName: defaultPick[user.id] ?? user.homeBinding?.defaultProxyName ?? null,
        replace: Boolean(user.homeBinding),
      });
      setMessage(result.replaced
        ? `已更换 ${user.email} → ${result.homeExit.displayName}（${result.homeExit.socks5Host}:${result.homeExit.socks5Port}）`
        : `已分派 ${user.email} → ${result.homeExit.displayName}（${result.homeExit.socks5Host}:${result.homeExit.socks5Port}）`);
      setAssignLine((prev) => ({ ...prev, [user.id]: '' }));
      reloadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '分派失败');
    } finally {
      setBusy(false);
    }
  }

  async function unbindHome(user: UserDto) {
    if (!confirm(`解除 ${user.email} 的家庭 IP 绑定？`)) return;
    setBusy(true);
    setError(null);
    try {
      await operationsApi.unbindUserHome(user.id);
      setMessage(`已解除 ${user.email} 家庭绑定`);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解绑失败');
    } finally {
      setBusy(false);
    }
  }

  const activeHomes = useMemo(
    () => (homes.state === 'ready' ? homes.data.filter((h) => h.status === 'active') : []),
    [homes],
  );
  const unusedHomes = useMemo(
    () => activeHomes.filter((home) => home.kind === 'socks5' && (home.bindCount ?? 0) === 0),
    [activeHomes],
  );

  // Shared VPS nodes = catalog proxies minus every registered home exit proxyName.
  const sharedProxies = useMemo(() => {
    if (catalog.state !== 'ready') return [];
    const homeNames = new Set((homes.state === 'ready' ? homes.data : []).map((h) => h.proxyName));
    return catalogProxyNames(catalog.data.yaml).filter((name) => !homeNames.has(name));
  }, [catalog, homes]);

  return <div className="stack">
    <Banner message={error} tone="error" />
    <Banner message={message} tone="ok" />

    <OnboardCard
      unusedHomes={unusedHomes}
      pooledAccounts={pooled.state === 'ready' ? pooled.data : []}
      onDone={reloadAll}
    />

    {allowlist.state === 'ready' && allowlist.data.length > 0 && (
      <div className="fold-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAllowlist((value) => !value)}>
          {showAllowlist ? '收起白名单' : `已授权 ${allowlist.data.length} 个邮箱`}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={reloadAll} disabled={busy}>刷新</button>
      </div>
    )}
    {showAllowlist && allowlist.state === 'ready' && (
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>邮箱</th><th>加入</th><th></th></tr></thead>
            <tbody>
              {allowlist.data.map((entry) => (
                <tr key={entry.email}>
                  <td><strong>{entry.email}</strong></td>
                  <td className="muted">{timestamp(entry.createdAt)}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeAllow(entry.email)}>撤销</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}

    <section className="card">
      <div className="card-header">
        <div>
          <h2>客户</h2>
          <p>点行展开账本和设备。日常派线直接粘贴。</p>
        </div>
        <div className="form-row">
          <input
            className="input compact"
            type="search"
            placeholder="搜索邮箱 / 家宽 / Claude"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="filter-check">
            <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
            只看未开号
          </label>
          <button type="button" className="btn btn-outline btn-sm" onClick={reloadAll} disabled={busy}>刷新</button>
        </div>
      </div>
      <div className="table-wrap">
        <StateBoundary resource={users} empty={(rows: UserDto[]) => rows.length === 0}>
          {(rows) => {
            const needle = query.trim().toLowerCase();
            const visible = rows.filter((user) => {
              if (onlyIncomplete && !user.product?.incomplete) return false;
              if (!needle) return true;
              const hay = [
                user.email,
                user.contact,
                user.product?.accountRef,
                user.homeBinding?.displayName,
                user.homeBinding?.socks5Host,
                user.homeBinding?.proxyName,
              ].filter(Boolean).join(' ').toLowerCase();
              return hay.includes(needle);
            });
            if (visible.length === 0) {
              return <div className="state"><strong>没有匹配的客户</strong></div>;
            }
            return <table className="users-table">
            <thead>
              <tr>
                <th>客户</th>
                <th>状态</th>
                <th>用量</th>
                <th>家宽</th>
                <th>Claude</th>
                <th>分派</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => {
                const nowSec = Math.floor(Date.now() / 1_000);
                const expired = user.expiresAt != null && user.expiresAt <= nowSec;
                const opened = expanded === user.id;
                return <Fragment key={user.id}>
                <tr
                  className={`${expired ? 'row-expired ' : ''}${opened ? 'open' : ''} click-row`}
                  onClick={() => setExpanded(opened ? null : user.id)}
                >
                <td>
                  <span className="expand-caret" aria-hidden>{opened ? '▾' : '▸'}</span>
                  <strong>{user.email}</strong>
                  {user.product?.incomplete && <span className="expired-flag">未开号</span>}
                </td>
                <td>
                  <Status value={user.status} />
                  {expired && <span className="expired-flag">已过期</span>}
                </td>
                <td className="mono">{formatBytes(user.usageBytes)}</td>
                <td>
                  {user.homeBinding ? (
                    <div>
                      <strong>{user.homeBinding.displayName}</strong>
                      <small className="mono">
                        {user.homeBinding.kind === 'socks5'
                          ? `${user.homeBinding.socks5Host}:${user.homeBinding.socks5Port}`
                          : user.homeBinding.proxyName}
                      </small>
                    </div>
                  ) : <span className="muted">未绑</span>}
                </td>
                <td>
                  {user.product?.accountRef
                    ? <>
                      <strong>{user.product.accountRef}</strong>
                      <small className="muted">换 {user.product.replaceCount} 次</small>
                    </>
                    : <span className="muted">未开户</span>}
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="assign-line">
                    <input
                      className="input compact"
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="host:port:user:pass"
                      value={assignLine[user.id] ?? ''}
                      onChange={(e) => setAssignLine((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy || !(assignLine[user.id] ?? '').trim()}
                      onClick={() => assignPasted(user)}
                    >{user.homeBinding ? '换线' : '分派'}</button>
                  </div>
                </td>
                </tr>
                {opened && (
                  <tr className="detail-row">
                    <td colSpan={6}>
                      <UserWorkbench
                        user={user}
                        busy={busy}
                        activeHomes={activeHomes}
                        unusedHomes={unusedHomes}
                        sharedProxies={sharedProxies}
                        bindPick={bindPick[user.id] || user.homeBinding?.homeExitId || ''}
                        defaultPick={defaultPick[user.id] ?? user.homeBinding?.defaultProxyName ?? ''}
                        expiryPick={expiryPick[user.id] ?? ''}
                        onBindPick={(value) => setBindPick((prev) => ({ ...prev, [user.id]: value }))}
                        onDefaultPick={(value) => setDefaultPick((prev) => ({ ...prev, [user.id]: value }))}
                        onExpiryPick={(value) => setExpiryPick((prev) => ({ ...prev, [user.id]: value }))}
                        onBind={() => bindHome(user)}
                        onUnbind={() => unbindHome(user)}
                        onToggle={() => toggleUser(user)}
                        onExpiry30={() => setExpiry(user, Math.floor(Date.now() / 1_000) + 30 * 86_400)}
                        onApplyExpiry={() => applyExpiryPick(user)}
                        onClearExpiry={() => setExpiry(user, null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>;
              })}
            </tbody>
          </table>;
          }}
        </StateBoundary>
      </div>
    </section>

    <HomesPage />
  </div>;
}

function UserWorkbench({
  user, busy, activeHomes, unusedHomes, sharedProxies,
  bindPick, defaultPick, expiryPick,
  onBindPick, onDefaultPick, onExpiryPick,
  onBind, onUnbind, onToggle, onExpiry30, onApplyExpiry, onClearExpiry,
}: {
  user: UserDto;
  busy: boolean;
  activeHomes: HomeExitDto[];
  unusedHomes: HomeExitDto[];
  sharedProxies: string[];
  bindPick: string;
  defaultPick: string;
  expiryPick: string;
  onBindPick: (value: string) => void;
  onDefaultPick: (value: string) => void;
  onExpiryPick: (value: string) => void;
  onBind: () => void;
  onUnbind: () => void;
  onToggle: () => void;
  onExpiry30: () => void;
  onApplyExpiry: () => void;
  onClearExpiry: () => void;
}) {
  const nowSec = Math.floor(Date.now() / 1_000);
  const aliveDays = Math.max(0, Math.floor((nowSec - user.createdAt) / 86_400));
  const remainDays = user.expiresAt == null ? null : Math.ceil((user.expiresAt - nowSec) / 86_400);
  const homes = unusedHomes.length > 0 ? unusedHomes : activeHomes;
  return (
    <div className="user-workbench">
      <div className="workbench-meta">
        <span>注册 {timestamp(user.createdAt)} · {aliveDays} 天</span>
        <span>到期 {user.expiresAt ? `${timestamp(user.expiresAt)}（剩 ${remainDays} 天）` : '不限'}</span>
        <span>用量 {formatBytes(user.usageBytes)}</span>
      </div>
      <div className="workbench-ops">
        <select className="input compact" value={bindPick} onChange={(e) => onBindPick(e.target.value)} disabled={busy || homes.length === 0}>
          <option value="">{homes.length ? '从库存绑家宽…' : '没有可绑线路'}</option>
          {homes.map((home) => (
            <option key={home.id} value={home.id}>
              {home.displayName} ({home.kind === 'socks5' ? `${home.socks5Host}:${home.socks5Port}` : home.proxyName})
            </option>
          ))}
        </select>
        <select className="input compact" value={defaultPick} onChange={(e) => onDefaultPick(e.target.value)} disabled={busy || sharedProxies.length === 0}>
          <option value="">{sharedProxies.length ? '默认 VPS（不指定）' : '无共享节点'}</option>
          {sharedProxies.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onBind}>
          {user.homeBinding ? '保存绑定' : '绑定库存'}
        </button>
        {user.homeBinding && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onUnbind}>解绑</button>
        )}
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onToggle}>
          {user.status === 'active' ? '销户' : '恢复账号'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onExpiry30}>+30 天</button>
        <input className="input compact" type="datetime-local" value={expiryPick} onChange={(e) => onExpiryPick(e.target.value)} disabled={busy} />
        <button type="button" className="btn btn-outline btn-sm" disabled={busy || !expiryPick} onClick={onApplyExpiry}>改到期</button>
        {user.expiresAt != null && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClearExpiry}>清到期</button>
        )}
      </div>
      <UserDetailPanel user={user} />
    </div>
  );
}

function DeviceActions({ deviceId, onChanged }: { deviceId: string; onChanged: () => void }) {
  const history = useResource(() => operationsApi.deviceActions(deviceId), [deviceId]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: string, confirmFirst = false) {
    if (confirmFirst && !confirm('仅当此设备已处于 Protected Offline 时重试保护？健康连接不会被断开。')) return;
    setBusy(true);
    setMessage(null);
    try {
      await operationsApi.enqueueDeviceAction(deviceId, action);
      setMessage('已排队');
      history.reload();
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '下发失败');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm('撤销此设备并从 tailnet 删除？')) return;
    setBusy(true);
    try {
      await operationsApi.revokeDevice(deviceId);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  }

  const latest = history.state === 'ready' ? history.data[0] : null;
  return (
    <div className="device-actions">
      <div className="row-actions">
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run('diagnostic_snapshot')}>诊断</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run('claude_traffic_snapshot')}>流量快照</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run('refresh_catalog')}>刷新目录</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run('retry_protection', true)}>重试保护</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => revoke()}>撤销</button>
      </div>
      {message && <div className="muted">{message}</div>}
      {latest && (
        <div className="muted">最近：{latest.action} · {latest.status} · {timestamp(latest.createdAt)}</div>
      )}
    </div>
  );
}

function ProductLedger({ user, detail, onChanged }: {
  user: UserDto;
  detail: UserDetailDto | null;
  onChanged: () => void;
}) {
  const [accountRef, setAccountRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = detail?.product?.accounts.find((account) => account.status === 'assigned') ?? null;
  const daysUsed = (account: ProductAccountDto) => {
    const start = account.openedAt ?? account.createdAt;
    const end = account.closedAt ?? Math.floor(Date.now() / 1000);
    return Math.max(0, Math.floor((end - start) / 86_400));
  };

  async function openAccount() {
    if (!accountRef.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await operationsApi.createProductAccount({ userId: user.id, accountRef: accountRef.trim() });
      setAccountRef('');
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '开户失败');
    } finally {
      setBusy(false);
    }
  }

  async function ban() {
    if (!current || !confirm(`标记 ${current.accountRef} 已封号？`)) return;
    setBusy(true);
    try {
      await operationsApi.banProductAccount(current.id);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '封号失败');
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (!current || !accountRef.trim()) return;
    if (!confirm(`用 ${accountRef.trim()} 替换 ${current.accountRef}？`)) return;
    setBusy(true);
    try {
      await operationsApi.replaceProductAccount(current.id, accountRef.trim());
      setAccountRef('');
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '换号失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-block">
      <h3>Claude 账本</h3>
      <div className="muted detail-note">
        首次开户 {user.firstEntitledAt ? timestamp(user.firstEntitledAt) : '—'}
        {user.firstEntitledAt ? ` · 已用 ${Math.max(0, Math.floor((Date.now() / 1000 - user.firstEntitledAt) / 86400))} 天` : ''}
        {` · 换号 ${detail?.product?.replaceCount ?? user.product?.replaceCount ?? 0} 次`}
      </div>
      {current ? (
        <p>
          当前 <strong>{current.accountRef}</strong>
          <small className="muted"> · 本号 {daysUsed(current)} 天</small>
        </p>
      ) : <p className="muted">没有在用的号</p>}
      <div className="assign-line">
        <input
          className="input compact"
          placeholder="账号标识"
          value={accountRef}
          onChange={(e) => setAccountRef(e.target.value)}
          disabled={busy}
        />
        {current
          ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !accountRef.trim()} onClick={replace}>换号</button>
          : <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !accountRef.trim()} onClick={openAccount}>开户</button>}
        {current && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={ban}>标封号</button>}
      </div>
      {message && <div className="muted">{message}</div>}
      {detail?.product?.events && detail.product.events.length > 0 && (
        <ul className="detail-list">
          {detail.product.events.slice(0, 8).map((event) => (
            <li key={event.id}>
              <span>{event.type}</span>
              <span className="muted">{timestamp(event.at)}{event.detail ? ` · ${event.detail}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserDetailPanel({ user }: { user: UserDto }) {
  const detail = useResource<UserDetailDto>(() => operationsApi.userDetail(user.id), [user.id]);
  const quotaPct = user.quotaBytes
    ? Math.min(100, (user.usageBytes / user.quotaBytes) * 100)
    : null;

  const prettyReport = (raw: string) => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  return (
    <div className="user-detail">
      <div className="detail-grid">
        <div className="detail-block">
          <h3>用量</h3>
          <div className="usage-line mono">
            {formatBytes(user.usageBytes)}{user.quotaBytes != null ? ` / ${formatBytes(user.quotaBytes)}` : ' / 不限'}
          </div>
          {quotaPct !== null && (
            <div className="usage-track">
              <div
                className={`usage-fill${quotaPct > 90 ? ' danger' : ''}`}
                style={{ width: `${Math.max(2, quotaPct)}%` }}
              />
            </div>
          )}
          <div className="muted detail-note">
            注册于 {timestamp(user.createdAt)} · 设备上限 {user.deviceLimit}
            {user.expiresAt ? ` · 到期 ${timestamp(user.expiresAt)}` : ''}
            {user.contact ? ` · ${user.contact}` : ''}
          </div>
          {detail.state === 'ready' && detail.data.heartbeat && (
            <div className="muted detail-note">
              心跳 {timeAgo(detail.data.heartbeat.lastSeenAt)}
              {detail.data.heartbeat.selectedServer ? ` · ${detail.data.heartbeat.selectedServer}` : ''}
              {` · ${detail.data.heartbeat.clientVersion}`}
            </div>
          )}
        </div>

        <ProductLedger
          user={user}
          detail={detail.state === 'ready' ? detail.data : null}
          onChanged={detail.reload}
        />

        <div className="detail-block">
          <h3>设备{detail.state === 'ready' ? `（${detail.data.devices.length}）` : ''}</h3>
          {detail.state === 'loading' && <span className="muted">加载中…</span>}
          {detail.state === 'error' && <span className="muted">{detail.message}</span>}
          {detail.state === 'ready' && (detail.data.devices.length > 0 ? (
            <ul className="detail-list">
              {detail.data.devices.map((device) => (
                <li key={device.id}>
                  <Status value={device.status} />
                  <strong>{device.name}</strong>
                  <span className="muted">更新 {timestamp(device.updatedAt)}</span>
                  {device.status !== 'revoked' && <DeviceActions deviceId={device.id} onChanged={detail.reload} />}
                </li>
              ))}
            </ul>
          ) : <span className="muted">无设备</span>)}
        </div>

        <div className="detail-block">
          <h3>诊断报告{detail.state === 'ready' ? `（${detail.data.diagnostics.length}）` : ''}</h3>
          {detail.state === 'loading' && <span className="muted">加载中…</span>}
          {detail.state === 'error' && <span className="muted">{detail.message}</span>}
          {detail.state === 'ready' && (detail.data.diagnostics.length > 0 ? (
            <ul className="detail-list">
              {detail.data.diagnostics.map((report) => (
                <li key={report.referenceCode}>
                  <details>
                    <summary>
                      <code>{report.referenceCode}</code>
                      <span className="muted"> · {timestamp(report.receivedAt)} · {report.clientVersion} · {report.osVersion}</span>
                    </summary>
                    <pre className="report-json">{prettyReport(report.reportJson)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          ) : <span className="muted">用户尚未上传诊断报告</span>)}
        </div>
      </div>
    </div>
  );
}

function HomesPage() {
  const homes = useResource(operationsApi.homeExits);
  const [proxyName, setProxyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [egressIpv4, setEgressIpv4] = useState('');
  const [kind, setKind] = useState<'catalog' | 'socks5'>('catalog');
  const [socks5Host, setSocks5Host] = useState('');
  const [socks5Port, setSocks5Port] = useState('');
  const [socks5Username, setSocks5Username] = useState('');
  const [socks5Password, setSocks5Password] = useState('');
  const [notes, setNotes] = useState('');
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importLines(event: FormEvent) {
    event.preventDefault();
    const lines = importText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      setError('先粘贴一行或多行 host:port:user:pass');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await operationsApi.importHomeLines(lines);
      const parts = [
        result.created.length ? `入库 ${result.created.length} 条` : null,
        result.skipped.length ? `跳过 ${result.skipped.length} 条已存在` : null,
        result.failed.length ? `失败 ${result.failed.length} 条` : null,
      ].filter(Boolean);
      setMessage(parts.join(' · ') || '没有新的线路');
      if (result.failed.length > 0) {
        setError(result.failed.map((item) => item.message).join('；'));
      }
      if (result.created.length > 0) setImportText('');
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '入库失败');
    } finally {
      setBusy(false);
    }
  }

  async function createHome(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await operationsApi.createHomeExit({
        proxyName: proxyName.trim(),
        displayName: displayName.trim(),
        egressIpv4: egressIpv4.trim() || undefined,
        kind,
        ...(kind === 'socks5' ? {
          socks5Host: socks5Host.trim(),
          socks5Port: Number(socks5Port),
          socks5Username,
          socks5Password,
        } : {}),
        notes: notes.trim() || undefined,
      });
      setMessage(`已登记 ${created.displayName}（${created.proxyName}）`);
      setProxyName('');
      setDisplayName('');
      setEgressIpv4('');
      setKind('catalog');
      setSocks5Host('');
      setSocks5Port('');
      setSocks5Username('');
      setSocks5Password('');
      setNotes('');
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function removeHome(home: HomeExitDto) {
    if (!confirm(`删除家庭出口 ${home.displayName}？需先解绑所有用户。`)) return;
    setBusy(true);
    setError(null);
    try {
      await operationsApi.deleteHomeExit(home.id);
      setMessage(`已删除 ${home.displayName}`);
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(home: HomeExitDto, status: string) {
    setBusy(true);
    setError(null);
    try {
      await operationsApi.updateHomeExit(home.id, { status });
      homes.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setBusy(false);
    }
  }

  return <div className="stack">
    <Banner message={error} tone="error" />
    <Banner message={message} tone="ok" />

    <section className="card">
      <div className="card-header">
        <div>
          <h2>粘贴入库</h2>
          <p>一行一条 <code>host:port:user:pass</code>，也可 <code>user:pass@host:port</code> 或 <code>socks5://…</code>。先入库不绑定，再在用户行分派或从下拉选择。</p>
        </div>
      </div>
      <div className="card-body">
        <form className="stack" onSubmit={importLines}>
          <textarea
            className="input control-textarea"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder={'198.51.100.10:6886:user:pass\nuser:pass@gw.example.com:11080'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            disabled={busy}
          />
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !importText.trim()}>入库</button>
          </div>
        </form>
      </div>
    </section>

    <details className="card extras-fold">
      <summary className="extras-summary">登记 catalog 型住宅节点（少用）</summary>
      <div className="card-body">
        <form className="form-grid" onSubmit={createHome}>
          <label>
            <span>显示名</span>
            <input className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="家庭 A · 上海电信" disabled={busy} />
          </label>
          <label>
            <span>Catalog proxy name</span>
            <input className="input" required value={proxyName} onChange={(e) => setProxyName(e.target.value)} placeholder="Home Residential A" disabled={busy} />
          </label>
          <label>
            <span>类型</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'catalog' | 'socks5')} disabled={busy}>
              <option value="catalog">catalog（节点在 catalog 里）</option>
              <option value="socks5">socks5（云端分配家宽，经选中节点链式出网）</option>
            </select>
          </label>
          {kind === 'socks5' && (
            <>
              <label>
                <span>SOCKS5 主机</span>
                <input className="input" required value={socks5Host} onChange={(e) => setSocks5Host(e.target.value)} placeholder="203.0.113.50 或 gw.example.com" disabled={busy} />
              </label>
              <label>
                <span>SOCKS5 端口</span>
                <input className="input" required type="number" min={1} max={65535} value={socks5Port} onChange={(e) => setSocks5Port(e.target.value)} placeholder="11080" disabled={busy} />
              </label>
              <label>
                <span>SOCKS5 用户名</span>
                <input className="input" required value={socks5Username} onChange={(e) => setSocks5Username(e.target.value)} disabled={busy} />
              </label>
              <label>
                <span>SOCKS5 密码</span>
                <input className="input" required type="password" value={socks5Password} onChange={(e) => setSocks5Password(e.target.value)} disabled={busy} />
              </label>
            </>
          )}
          <label>
            <span>家庭公网 IP（可选）</span>
            <input className="input" value={egressIpv4} onChange={(e) => setEgressIpv4(e.target.value)} placeholder="203.0.113.10" disabled={busy} />
          </label>
          <label>
            <span>备注（可选）</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="机房 / 联系人" disabled={busy} />
          </label>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>登记</button>
          </div>
        </form>
      </div>
    </details>

    <section className="card">
      <div className="card-header">
        <div>
          <h2>已登记出口</h2>
          <p>启用后可在用户页绑定。</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => homes.reload()} disabled={busy}>刷新</button>
      </div>
      <div className="table-wrap">
        <StateBoundary resource={homes} empty={(rows: HomeExitDto[]) => rows.length === 0}>
          {(rows) => <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>proxy name</th>
                <th>类型</th>
                <th>家庭 IP / 上游</th>
                <th>状态</th>
                <th>探活</th>
                <th>更新</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((home) => <tr key={home.id}>
                <td><strong>{home.displayName}</strong>{home.notes ? <small>{home.notes}</small> : null}</td>
                <td className="mono">{home.proxyName}</td>
                <td className="mono">{home.kind}</td>
                <td className="mono">{home.kind === 'socks5' ? `${home.socks5Host}:${home.socks5Port}` : (home.egressIpv4 || '—')}</td>
                <td><Status value={home.status} /></td>
                <td className="muted">{home.probeStatus ? `${home.probeStatus}${home.lastProbedAt ? ` · ${timeAgo(home.lastProbedAt)}` : ''}` : '—'}</td>
                <td className="muted">{timestamp(home.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    {home.status !== 'active' && (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setStatus(home, 'active')}>启用</button>
                    )}
                    {home.status === 'active' && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus(home, 'disabled')}>停用</button>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => removeHome(home)}>删除</button>
                  </div>
                </td>
              </tr>)}
            </tbody>
          </table>}
        </StateBoundary>
      </div>
    </section>
  </div>;
}

function NodeExpand({ node, agent, profile, onProfile }: {
  node: LiveQualityNodeDto;
  agent?: { os: string | null; arch: string | null; cpu: number | null; memUsed: number | null; memTotal: number | null; netIn: number | null; netOut: number | null };
  profile?: NodeProfileDto;
  onProfile: () => void;
}) {
  const incident = useResource(() => operationsApi.nodeIncident(node.name), [node.name]);
  const [url, setUrl] = useState(profile?.billingUrl ?? '');
  const [quota, setQuota] = useState(profile?.trafficQuotaBytes != null ? String(Math.round(profile.trafficQuotaBytes / (1024 ** 3))) : '');
  const [used, setUsed] = useState(profile?.trafficUsedBytes != null ? String(Math.round(profile.trafficUsedBytes / (1024 ** 3))) : '');
  const [renew, setRenew] = useState(profile?.renewsAt ? new Date(profile.renewsAt * 1000).toISOString().slice(0, 10) : '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const payload = {
        catalogName: node.name,
        billingUrl: url.trim() || undefined,
        trafficQuotaBytes: quota === '' ? undefined : Number(quota) * 1024 * 1024 * 1024,
        trafficUsedBytes: used === '' ? undefined : Number(used) * 1024 * 1024 * 1024,
        renewsAt: renew ? Math.floor(new Date(renew).getTime() / 1000) : undefined,
        publicIp: node.publicIp ?? undefined,
        cycleNetIn: agent?.netIn ?? undefined,
        cycleNetOut: agent?.netOut ?? undefined,
      };
      if (profile) await operationsApi.updateNodeProfile(profile.id, payload);
      else await operationsApi.createNodeProfile(payload);
      onProfile();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monitor-detail">
      <div>
        <h4>结论</h4>
        <p>状态：{blockLabel(node)}</p>
        <p>质量：{node.quality === 'poor' ? '差' : '正常'}</p>
        {node.block?.rule ? <p className="muted">{node.block.rule}</p> : null}
        <h4>对外暴露</h4>
        {!node.exposure ? (
          <p className="muted">尚未探测。这一栏空着不代表干净——泄露的面板正是在没人看的状态下开了几周。</p>
        ) : (
          <>
            {node.exposure.unexpected.length === 0 ? (
              <p>只对外开放 SSH（:{node.exposure.sshPorts.join('、:') || '—'}）与服务端口。</p>
            ) : (
              <p>
                意外对外开放 {node.exposure.unexpected.length} 个端口：
                {node.exposure.unexpected.map((listener) => (
                  <span className="chip chip-risk" key={`exp-${listener.port}`}>
                    :{listener.port}{listener.process ? ` ${listener.process}` : ''}
                  </span>
                ))}
              </p>
            )}
            {node.exposure.acknowledged.map((listener) => (
              <p className="muted" key={`ack-${listener.port}`}>
                已具名豁免 :{listener.port}
                {listener.process ? ` ${listener.process}` : ''}
                {listener.reason ? ` —— ${listener.reason}` : ''}
              </p>
            ))}
          </>
        )}
        {node.riskSignals.length > 0 && (
          <>
            <h4>IP 信誉</h4>
            <p className="muted">
              securityCheck 询问十七家数据库，下面是各自的答案；少数派不构成判定。
            </p>
            {node.riskSignals.map((signal) => (
              <p key={`sig-${signal.tag}`}>
                {signal.tag}：{signal.yes} 家认为是，{signal.no} 家认为否
                {signal.yes > signal.no ? '（多数）' : '（少数）'}
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
        <div className="stack">
          <input className="input compact" placeholder="https://账单页" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input compact" type="number" min={0} placeholder="套餐 GB" value={quota} onChange={(e) => setQuota(e.target.value)} />
          <input className="input compact" type="number" min={0} placeholder="已用 GB（手填）" value={used} onChange={(e) => setUsed(e.target.value)} />
          <input className="input compact" type="date" value={renew} onChange={(e) => setRenew(e.target.value)} />
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>保存档案</button>
          {profile?.billingUrl && (
            <a className="btn btn-outline btn-sm" href={profile.billingUrl} target="_blank" rel="noreferrer">打开账单</a>
          )}
        </div>
      </div>
      <div>
        <h4>谁在用</h4>
        {incident.state === 'ready' && (incident.data.affected.length > 0
          ? <ul className="detail-list">{incident.data.affected.map((user) => (
            <li key={user.userId}><strong>{user.email}</strong><span className="muted">{user.online ? '在线' : '离线'}</span></li>
          ))}</ul>
          : <span className="muted">当前没有在线用户连这台</span>)}
        <details>
          <summary>回程 / IP 质量</summary>
          <pre>{node.backtrace || '无'}</pre>
          <pre>{node.securityCheck || '无'}</pre>
        </details>
      </div>
    </div>
  );
}

function trafficRemaining(profile: NodeProfileDto | undefined, agent: { netIn: number | null; netOut: number | null } | undefined) {
  if (!profile) return null;
  if (profile.trafficQuotaBytes != null && profile.trafficUsedBytes != null) {
    return profile.trafficQuotaBytes - profile.trafficUsedBytes;
  }
  if (
    profile.trafficQuotaBytes != null
    && agent
    && profile.cycleNetIn != null
    && profile.cycleNetOut != null
  ) {
    const used = Math.max(0, (agent.netIn ?? 0) + (agent.netOut ?? 0) - profile.cycleNetIn - profile.cycleNetOut);
    return profile.trafficQuotaBytes - used;
  }
  return null;
}

function MonitorPage() {
  const resource = useResource(operationsApi.live);
  const profilesRes = useResource(operationsApi.nodeProfiles);
  const activityRes = useResource(operationsApi.activity);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newQuota, setNewQuota] = useState('');
  const [newRenew, setNewRenew] = useState('');
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
    const visible = qualityNodes.filter((node) => {
      const status = blockStatus(node);
      if (filter !== 'all' && status !== filter) return false;
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
    const riskChips = (node: LiveQualityNodeDto) => node.riskSignals
      .filter((signal) => signal.yes > 0)
      .slice(0, 4)
      .map((signal) => ({
        key: signal.tag,
        label: `${RISK_LABELS[signal.tag] ?? signal.tag} ${signal.yes}/${signal.yes + signal.no}`,
        majority: signal.yes > signal.no,
      }));
    // Absent is not clean. A node no collector run has looked at is exactly the
    // state the leaked panel lived in for weeks, so it reads as unknown.
    const exposureChip = (node: LiveQualityNodeDto) => {
      if (!node.exposure) return { label: '暴露面未探测', tone: 'muted' as const };
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
      {(live.agentsError || live.qualityError) && (
        <Banner
          tone="error"
          message={[
            live.agentsError ? `探针库存：${live.agentsError}` : null,
            live.qualityError ? `质量报告：${live.qualityError}` : null,
          ].filter(Boolean).join('；')}
        />
      )}

      {agentsConfigured === 0 && (
        <Banner tone="info" message="大陆三网 agent 未配置 — 当前用 HK/JP/SG 边缘 TCP 表示「边缘可达」，不会把海外探测误判为被墙。" />
      )}

      <div className="metrics">
        <article className="metric">
          <div className="metric-label"><span>节点</span></div>
          <div className="metric-value">{qualityNodes.length}</div>
          <div className="metric-hint">采集于 {timestamp(live.quality?.updatedAt)}</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>可达</span></div>
          <div className="metric-value">{reachable.length}</div>
          <div className="metric-hint">大陆正常或边缘可达 · 探针 {agents.length}</div>
        </article>
        <article className={`metric${blocked.length ? ' metric-alert' : ''}`}>
          <div className="metric-label"><span>疑似被墙</span></div>
          <div className="metric-value">{blocked.length}</div>
          <div className="metric-hint">大陆探针 ≥2/3 不通</div>
        </article>
        <article className={`metric${poor.length ? ' metric-warn' : ''}`}>
          <div className="metric-label"><span>质量差</span></div>
          <div className="metric-value">{poor.length}</div>
          <div className="metric-hint">{poor.length ? poor.map((n) => n.name).join('、') : '仅严重风险才标'}</div>
        </article>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>补服务器档案</h2>
            <p>填商家账单地址、套餐流量和续费日。不准的余量以账单页为准。</p>
          </div>
        </div>
        <div className="card-body">
          <form
            className="form-row"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!newName.trim()) return;
              setBusy(true);
              try {
                await operationsApi.createNodeProfile({
                  catalogName: newName.trim(),
                  billingUrl: newUrl.trim() || undefined,
                  trafficQuotaBytes: newQuota ? Number(newQuota) * 1024 * 1024 * 1024 : undefined,
                  renewsAt: newRenew ? Math.floor(new Date(newRenew).getTime() / 1000) : undefined,
                });
                setNewName('');
                setNewUrl('');
                setNewQuota('');
                setNewRenew('');
                profilesRes.reload();
              } finally {
                setBusy(false);
              }
            }}
          >
            <input className="input compact" placeholder="节点名（对齐探测名）" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={busy} />
            <input className="input compact" placeholder="https://账单页" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} disabled={busy} />
            <input className="input compact" type="number" min={0} placeholder="套餐 GB" value={newQuota} onChange={(e) => setNewQuota(e.target.value)} disabled={busy} />
            <input className="input compact" type="date" value={newRenew} onChange={(e) => setNewRenew(e.target.value)} disabled={busy} />
            <button className="btn btn-sm" type="submit" disabled={busy || !newName.trim()}>保存档案</button>
          </form>
        </div>
      </section>

      <div className="card">
        <div className="card-header monitor-toolbar">
          <div>
            <h2>服务器</h2>
            <p>点行展开回程、账单和谁在用这台</p>
          </div>
          <div className="form-row">
            <input className="input compact" type="search" placeholder="搜索名称 / IP" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className="input compact" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="LIKELY_BLOCKED">疑似被墙</option>
              <option value="OK">大陆正常</option>
              <option value="EDGE_OK">边缘可达</option>
              <option value="EDGE_FAIL">边缘不通</option>
              <option value="DOWN">不通</option>
            </select>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => resource.reload()}>刷新</button>
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="state"><strong>没有匹配的节点</strong></div>
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
                      {agent ? <Status value="active" /> : <span className="muted">未安装</span>}
                      {agent?.cpu != null && <small className="muted">CPU {Math.round(agent.cpu)}%</small>}
                    </td>
                    <td className="mono">{occupancy.get(node.name) ?? 0}</td>
                    <td className="mono">{remain == null ? '—' : formatBytes(remain)}</td>
                    <td className="muted">
                      {profile?.renewsAt ? timestamp(profile.renewsAt) : '—'}
                      {profile?.billingUrl && (
                        <a className="btn btn-outline btn-sm" href={profile.billingUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>打开账单</a>
                      )}
                    </td>
                    <td>
                      <div className="chip-list">
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

function ControlPage() {
  const catalog = useResource(operationsApi.exitCatalog);
  const policy = useResource(operationsApi.trafficPolicy);
  const [yaml, setYaml] = useState('');
  const [policyText, setPolicyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (policy.state === 'ready') {
      try {
        setPolicyText(JSON.stringify(JSON.parse(policy.data.json), null, 2));
      } catch {
        setPolicyText(policy.data.json);
      }
    }
  }, [policy.state, policy.state === 'ready' ? policy.data.json : '']);

  async function replaceCatalog(event: FormEvent) {
    event.preventDefault();
    if (!yaml.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const expected = catalog.state === 'ready' ? catalog.data.revision : 0;
      const result = await operationsApi.replaceCatalog(yaml, expected);
      setMessage(`节点目录已更新到版本 ${result.revision}`);
      setYaml('');
      catalog.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '替换目录失败');
    } finally {
      setBusy(false);
    }
  }

  async function publishPolicy(next: unknown) {
    const expected = policy.state === 'ready' ? policy.data.revision : 0;
    const result = await operationsApi.replaceTrafficPolicy(next, expected);
    setMessage(`精确直连策略已更新到版本 ${result.revision}`);
    policy.reload();
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await publishPolicy(JSON.parse(policyText));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存策略失败');
    } finally {
      setBusy(false);
    }
  }

  return <div className="stack">
    <Banner message={error} tone="error" />
    <Banner message={message} tone="ok" />

    <section className="card">
      <div className="card-header">
        <div>
          <h2>云端节点目录</h2>
          <p>
            {catalog.state === 'ready' && catalog.data.revision > 0
              ? `当前版本 ${catalog.data.revision} · ${timestamp(catalog.data.updatedAt)}`
              : '尚未上传云端节点目录'}
          </p>
        </div>
      </div>
      <div className="card-body">
        <form className="stack" onSubmit={replaceCatalog}>
          <label>
            <span className="muted">从本机载入完整 Clash YAML</span>
            <input
              className="input"
              type="file"
              accept=".yaml,.yml,application/yaml,text/yaml,text/plain"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size < 11 || file.size > 1024 * 1024) {
                  setError('目录文件必须为 11 bytes–1 MiB');
                  event.target.value = '';
                  return;
                }
                setYaml(await file.text());
                setMessage('目录已在本机载入；确认后再替换云端版本。');
              }}
            />
          </label>
          <textarea
            className="input control-textarea"
            rows={12}
            spellCheck={false}
            autoComplete="off"
            placeholder={'proxies:\n  - name: ...'}
            value={yaml}
            onChange={(event) => setYaml(event.target.value)}
            disabled={busy}
          />
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !yaml.trim()}>替换云端节点目录</button>
          </div>
        </form>
      </div>
    </section>

    <section className="card">
      <div className="card-header">
        <div>
          <h2>精确直连策略</h2>
          <p>
            {policy.state === 'ready' && policy.data.revision > 0
              ? `当前版本 ${policy.data.revision} · ${timestamp(policy.data.updatedAt)}`
              : '尚未启用国内精确直连'}
          </p>
        </div>
      </div>
      <div className="card-body">
        <form className="stack" onSubmit={savePolicy}>
          <textarea
            className="input control-textarea"
            rows={14}
            spellCheck={false}
            autoComplete="off"
            value={policyText}
            onChange={(event) => setPolicyText(event.target.value)}
            disabled={busy || policy.state !== 'ready'}
          />
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || policy.state !== 'ready'}>替换精确直连策略</button>
            <button
              className="btn btn-outline"
              type="button"
              disabled={busy || policy.state !== 'ready'}
              onClick={async () => {
                if (!confirm('只停止视频网页直连，保留原生微信试验？')) return;
                setBusy(true);
                setError(null);
                try {
                  const current = JSON.parse(policyText) as { domains?: unknown; mediaEndpoints?: unknown };
                  await publishPolicy({
                    version: 2,
                    domains: current.domains || [],
                    mediaEndpoints: current.mediaEndpoints || [],
                    webDomains: [],
                  });
                } catch (err) {
                  setError(err instanceof Error ? err.message : '更新失败');
                } finally {
                  setBusy(false);
                }
              }}
            >只停视频网页直连</button>
            <button
              className="btn btn-outline"
              type="button"
              disabled={busy || policy.state !== 'ready'}
              onClick={async () => {
                if (!confirm('立即停止全部国内精确直连并让客户端安全重连？')) return;
                setBusy(true);
                setError(null);
                try {
                  await publishPolicy({ version: 1, domains: [], mediaEndpoints: [] });
                } catch (err) {
                  setError(err instanceof Error ? err.message : '更新失败');
                } finally {
                  setBusy(false);
                }
              }}
            >立即停止全部直连</button>
          </div>
        </form>
      </div>
    </section>
  </div>;
}

function App() {
  const page = usePage();
  const selected = pages.find((entry) => entry.id === page)!;
  const groups = useMemo(() => {
    const map = new Map<string, typeof pages>();
    for (const entry of pages) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">T</span>
          <div className="brand-text">
            <strong>Tono</strong>
            <small>运维</small>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="运维页面">
          {groups.map(([group, items]) => (
            <div key={group} className="nav-block">
              <div className="nav-group">{group}</div>
              {items.map((entry) => (
                <a
                  key={entry.id}
                  className={`nav-item${page === entry.id ? ' active' : ''}`}
                  href={`#/${entry.id}`}
                >
                  <Icon d={icons[entry.id]} />
                  <span>{entry.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="muted">唯一运维入口</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <div className="breadcrumb">
              <span>Tono</span>
              <span className="sep">/</span>
              <span className="current">{selected.label}</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="badge">Access admin</span>
          </div>
        </header>

        <div className="content">
          <div className="page-head">
            <div>
              <h1>{selected.label}</h1>
              <p>
                {page === 'dashboard' && '红条、库存、谁在线、该处理谁'}
                {page === 'monitor' && '探测、指标、余量、续费、打开账单'}
                {page === 'users' && '开通、派线、Claude 账本'}
                {page === 'control' && '替换节点目录和精确直连策略'}
              </p>
            </div>
          </div>

          {page === 'dashboard' && <Dashboard />}
          {page === 'monitor' && <MonitorPage />}
          {page === 'users' && <UsersPage />}
          {page === 'control' && <ControlPage />}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
