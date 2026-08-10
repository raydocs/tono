import { Fragment, StrictMode, useEffect, useMemo, useState, type FormEvent, type ReactNode, type SVGProps } from 'react';
import { createRoot } from 'react-dom/client';
import {
  operationsApi,
  type ActivityDto,
  type AllowlistEntry,
  type CatalogRevisionDto,
  type DashboardDto,
  type HomeExitDto,
  type LiveDto,
  type LiveQualityNodeDto,
  type NodeDto,
  type ServerDto,
  type UserDetailDto,
  type UserDto,
} from './api';
import './styles.css';

type Page = 'dashboard' | 'users' | 'homes' | 'monitor' | 'servers' | 'nodes' | 'catalog';
type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

const pages: Array<{ id: Page; label: string; group: string }> = [
  { id: 'dashboard', label: '总览', group: '概览' },
  { id: 'monitor', label: '节点监控', group: '概览' },
  { id: 'users', label: '用户', group: '产品' },
  { id: 'homes', label: '家庭出口', group: '产品' },
  { id: 'servers', label: '服务器', group: '运维' },
  { id: 'nodes', label: '逻辑节点', group: '运维' },
  { id: 'catalog', label: 'Catalog', group: '运维' },
];

function Icon({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon" aria-hidden {...props}>
      <path d={d} />
    </svg>
  );
}

const icons: Record<Page | 'quality' | 'komari' | 'external', string> = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  homes: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10',
  servers: 'M4 6h16M4 12h16M4 18h16M8 6v.01M8 12v.01M8 18v.01',
  nodes: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  catalog: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  monitor: 'M22 12h-4l-3 9L9 3l-3 9H2',
  quality: 'M22 12h-4l-3 9L9 3l-3 9H2',
  komari: 'M18 20V10M12 20V4M6 20v-6',
  external: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3',
};

function currentPage(): Page {
  const value = window.location.hash.replace(/^#\/?/, '');
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

function Status({ value }: { value: string }) {
  return <span className={`status status-${value.replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>;
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
    return <div className="state"><strong>暂无流量数据</strong><span>家庭出口上报用量后自动生成。</span></div>;
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
  return <StateBoundary resource={resource}>{(data: DashboardDto) => {
    const liveData = live.state === 'ready' ? live.data : null;
    const qualityNodes = liveData?.quality?.nodes ?? [];
    const agents = liveData?.agents ?? [];
    const agentNames = new Set(agents.map((agent) => agent.name));
    const offline = qualityNodes.filter((node) => !node.ok);
    const blocked = qualityNodes.filter((node) => node.block && node.block.status !== 'OK');
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

    const versions = new Map<string, number>();
    for (const user of activityUsers) {
      versions.set(user.clientVersion, (versions.get(user.clientVersion) ?? 0) + 1);
    }
    const versionRows = [...versions.entries()].sort((a, b) => b[1] - a[1]);
    const versionMax = Math.max(1, ...versionRows.map(([, count]) => count));

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
      }
    }

    const nodeState = (node: LiveQualityNodeDto) => {
      if (!node.ok) return { key: 'down', label: '探测失败' };
      if (node.block && node.block.status !== 'OK') return { key: 'blocked', label: node.block.label || '被墙' };
      if (node.quality && node.quality !== 'ok') return { key: 'warn', label: `质量 ${node.quality}` };
      return { key: 'ok', label: '正常' };
    };

    return <>
      <div className="metrics">
        <article className="metric">
          <div className="metric-label"><span>节点在线</span></div>
          <div className="metric-value">
            {liveData ? `${qualityNodes.length - offline.length}/${qualityNodes.length}` : '—'}
          </div>
          <div className="metric-hint">Komari 探针 {agents.length || '—'} 个 · 大陆探测口径</div>
        </article>
        <article className={`metric${blocked.length ? ' metric-alert' : ''}`}>
          <div className="metric-label"><span>被墙</span></div>
          <div className="metric-value">{liveData ? blocked.length : '—'}</div>
          <div className="metric-hint">{blocked.length ? blocked.map((n) => n.name).join('、') : '大陆探针多数不通才算'}</div>
        </article>
        <article className={`metric${degraded.length ? ' metric-warn' : ''}`}>
          <div className="metric-label"><span>质量异常</span></div>
          <div className="metric-value">{liveData ? degraded.length : '—'}</div>
          <div className="metric-hint">{degraded.length ? degraded.map((n) => n.name).join('、') : 'IP 质量关键词命中'}</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>用户</span></div>
          <div className="metric-value">{data.users.active}</div>
          <div className="metric-hint">{data.users.total} 总计 · 已注册账号</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>设备</span></div>
          <div className="metric-value">{data.devices.active}</div>
          <div className="metric-hint">{data.devices.total} 总计 · 客户端设备</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>在线用户</span></div>
          <div className="metric-value">
            {activityRes.state === 'ready' ? activityRes.data.onlineUsers : '—'}
          </div>
          <div className="metric-hint">
            {activityRes.state === 'ready'
              ? `${activityRes.data.onlineDevices} 台设备在用 · ${Math.round(activityRes.data.onlineWindowSeconds / 60)} 分钟心跳`
              : '遥测心跳口径'}
          </div>
        </article>
      </div>

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

        <section className="card">
          <div className="card-header">
            <div>
              <h2>用户节点分布</h2>
              <p>家庭 IP 绑定 vs 共享 VPS 池</p>
            </div>
          </div>
          <div className="card-body">
            {usersRes.state === 'ready' && (() => {
              const groups = new Map<string, number>();
              let unbound = 0;
              for (const user of usersRes.data) {
                if (user.homeBinding) {
                  groups.set(user.homeBinding.displayName, (groups.get(user.homeBinding.displayName) ?? 0) + 1);
                } else {
                  unbound += 1;
                }
              }
              const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]);
              const max = Math.max(1, unbound, ...rows.map(([, count]) => count));
              return (
                <div className="lb">
                  {rows.map(([name, count]) => (
                    <div className="lb-row lb-row-plain" key={name}>
                      <span className="lb-email">{name}</span>
                      <div className="lb-track">
                        <div className="lb-fill" style={{ width: `${Math.max(2, (count / max) * 100)}%` }} />
                      </div>
                      <span className="lb-value mono">{count} 人</span>
                    </div>
                  ))}
                  <div className="lb-row lb-row-plain">
                    <span className="lb-email muted">共享 VPS 池（未绑定家宽）</span>
                    <div className="lb-track">
                      <div className="lb-fill" style={{ width: `${Math.max(2, (unbound / max) * 100)}%` }} />
                    </div>
                    <span className="lb-value mono">{unbound} 人</span>
                  </div>
                </div>
              );
            })()}
            {usersRes.state !== 'ready' && <div className="state"><span className="spinner" /></div>}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>客户端版本分布</h2>
              <p>按最近心跳上报的版本统计</p>
            </div>
          </div>
          <div className="card-body">
            {activityRes.state === 'ready' && (versionRows.length > 0 ? (
              <div className="lb">
                {versionRows.map(([version, count]) => (
                  <div className="lb-row lb-row-plain" key={version}>
                    <span className="lb-email mono">{version}</span>
                    <div className="lb-track">
                      <div className="lb-fill" style={{ width: `${Math.max(2, (count / versionMax) * 100)}%` }} />
                    </div>
                    <span className="lb-value mono">{count} 人</span>
                  </div>
                ))}
              </div>
            ) : <div className="state"><strong>暂无数据</strong><span>等待客户端心跳上报。</span></div>)}
            {activityRes.state !== 'ready' && <div className="state"><span className="spinner" /></div>}
          </div>
        </section>
      </div>

      <div className="quick-links">
        <a className="link-card" href="#/users">
          <strong>添加用户 / 绑定家庭 IP</strong>
          <span>白名单授权 → 客户端验证码登录 → 绑定住宅出口</span>
        </a>
        <a className="link-card" href="#/homes">
          <strong>登记家庭出口</strong>
          <span>proxy name 必须与 catalog 节点 name 完全一致</span>
        </a>
        <a className="link-card" href="https://quality.afk.ccwu.cc/" target="_blank" rel="noreferrer">
          <strong>节点质量面板 ↗</strong>
          <span>被墙 · 回程 · IP 质量完整报告</span>
        </a>
      </div>

      <div className="muted catalog-footnote">
        Encrypted catalog · Revision {data.catalog.revision} · 更新于 {timestamp(data.catalog.updatedAt)} ·{' '}
        {data.servers.active} 服务器 / {data.logicalNodes.active} 逻辑节点
      </div>
    </>;
  }}</StateBoundary>;
}

function UsersPage() {
  const users = useResource(operationsApi.users);
  const allowlist = useResource(operationsApi.signupAllowlist);
  const homes = useResource(operationsApi.homeExits);
  const catalog = useResource(operationsApi.exitCatalog);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindPick, setBindPick] = useState<Record<string, string>>({});
  const [defaultPick, setDefaultPick] = useState<Record<string, string>>({});
  const [showAllowlist, setShowAllowlist] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const reloadAll = () => {
    users.reload();
    allowlist.reload();
    homes.reload();
    catalog.reload();
  };

  async function addUser(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await operationsApi.addSignupEmail(email.trim());
      setMessage(result.created
        ? `已授权 ${result.email}。用户用该邮箱在客户端登录验证码即可建号。`
        : `${result.email} 已在白名单中。`);
      setEmail('');
      allowlist.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  }

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
    const next = user.status === 'active' ? 'disabled' : 'active';
    if (!confirm(`${next === 'disabled' ? '禁用' : '启用'}用户 ${user.email}？`)) return;
    setBusy(true);
    setError(null);
    try {
      await operationsApi.setUserStatus(user.id, next);
      setMessage(`用户 ${user.email} 已${next === 'disabled' ? '禁用' : '启用'}`);
      users.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态更新失败');
    } finally {
      setBusy(false);
    }
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

  // Shared VPS nodes = catalog proxies minus every registered home exit proxyName.
  const sharedProxies = useMemo(() => {
    if (catalog.state !== 'ready') return [];
    const homeNames = new Set((homes.state === 'ready' ? homes.data : []).map((h) => h.proxyName));
    return catalogProxyNames(catalog.data.yaml).filter((name) => !homeNames.has(name));
  }, [catalog, homes]);

  return <div className="stack">
    <Banner message={error} tone="error" />
    <Banner message={message} tone="ok" />

    <section className="card">
      <div className="card-header">
        <div>
          <h2>添加用户</h2>
          <p>Tono 无密码：把邮箱加入注册白名单，用户在客户端用验证码登录即创建账号。</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={reloadAll} disabled={busy}>刷新</button>
      </div>
      <div className="card-body">
        <form className="form-row" onSubmit={addUser}>
          <input
            className="input"
            type="email"
            required
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <button className="btn" type="submit" disabled={busy || !email.trim()}>授权注册</button>
        </form>
        <StateBoundary resource={allowlist} empty={(rows: AllowlistEntry[]) => rows.length === 0}>
          {(rows) => <div className="allowlist-fold">
            <div className="fold-bar">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={() => setShowAllowlist((value) => !value)}
              >
                {showAllowlist ? '收起授权列表' : `管理已授权邮箱（${rows.length}）`}
              </button>
              {!showAllowlist && <span className="muted fold-hint">默认收起防误删，撤销仍会二次确认</span>}
            </div>
            {showAllowlist && <div className="chip-list">
              {rows.map((entry) => <span className="chip" key={entry.email}>
                {entry.email}
                <button type="button" className="chip-x" disabled={busy} onClick={() => removeAllow(entry.email)} aria-label="remove">×</button>
              </span>)}
            </div>}
          </div>}
        </StateBoundary>
      </div>
    </section>

    <section className="card">
      <div className="card-header">
        <div>
          <h2>流量榜单</h2>
          <p>按累计用量排序（家庭出口上报口径），仅列前五。</p>
        </div>
      </div>
      <div className="card-body">
        {users.state === 'ready' && <UsageLeaderboard users={users.data} />}
      </div>
    </section>

    <section className="card">
      <div className="card-header">
        <div>
          <h2>已注册用户</h2>
          <p>一人一家庭 IP：选择已登记的住宅出口并绑定。共享 VPS 节点仍对所有人可见。</p>
        </div>
      </div>
      <div className="table-wrap">
        <StateBoundary resource={users} empty={(rows: UserDto[]) => rows.length === 0}>
          {(rows) => <table>
            <thead>
              <tr>
                <th>用户</th>
                <th>状态</th>
                <th>用量</th>
                <th>家庭 IP</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => <Fragment key={user.id}>
                <tr>
                <td>
                  <button
                    type="button"
                    className="expand-toggle"
                    onClick={() => setExpanded(expanded === user.id ? null : user.id)}
                    aria-label="展开详情"
                    title="用量 / 设备 / 诊断报告"
                  >{expanded === user.id ? '▾' : '▸'}</button>
                  <strong>{user.email}</strong>
                  <small className="mono">{user.id}</small>
                </td>
                <td><Status value={user.status} /></td>
                <td className="mono">
                  {user.usageBytes.toLocaleString()}
                  {user.quotaBytes != null ? ` / ${user.quotaBytes.toLocaleString()}` : ''}
                </td>
                <td>
                  {user.homeBinding ? (
                    <div>
                      <strong>{user.homeBinding.displayName}</strong>
                      <small className="mono">
                        {user.homeBinding.kind === 'socks5'
                          ? `socks5 · ${user.homeBinding.socks5Host}:${user.homeBinding.socks5Port}`
                          : `${user.homeBinding.proxyName}${user.homeBinding.egressIpv4 ? ` · ${user.homeBinding.egressIpv4}` : ''}`}
                      </small>
                      {user.homeBinding.defaultProxyName && (
                        <small className="muted">默认 VPS：{user.homeBinding.defaultProxyName}</small>
                      )}
                    </div>
                  ) : <span className="muted">未绑定</span>}
                </td>
                <td>
                  <div className="row-actions">
                    <select
                      className="input compact"
                      value={bindPick[user.id] || user.homeBinding?.homeExitId || ''}
                      onChange={(e) => setBindPick((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      disabled={busy || activeHomes.length === 0}
                    >
                      <option value="">{activeHomes.length ? '选择家庭出口…' : '先登记家庭出口'}</option>
                      {activeHomes.map((home) => (
                        <option key={home.id} value={home.id}>
                          {home.displayName} ({home.kind === 'socks5' ? `socks5 · ${home.socks5Host}:${home.socks5Port}` : `${home.proxyName}${home.egressIpv4 ? ` · ${home.egressIpv4}` : ''}`})
                        </option>
                      ))}
                    </select>
                    <select
                      className="input compact"
                      value={defaultPick[user.id] ?? user.homeBinding?.defaultProxyName ?? ''}
                      onChange={(e) => setDefaultPick((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      disabled={busy || sharedProxies.length === 0}
                      title="绑定家宽后，Claude 流量走家庭 IP，其它流量走默认 VPS"
                    >
                      <option value="">{sharedProxies.length ? '默认 VPS（不指定）' : '无可用共享节点'}</option>
                      {sharedProxies.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => bindHome(user)}>
                      {user.homeBinding ? '保存' : '绑定'}
                    </button>
                    {user.homeBinding && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => unbindHome(user)}>解绑</button>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => toggleUser(user)}>
                      {user.status === 'active' ? '禁用' : '启用'}
                    </button>
                  </div>
                </td>
                </tr>
                {expanded === user.id && (
                  <tr className="detail-row">
                    <td colSpan={5}><UserDetailPanel user={user} /></td>
                  </tr>
                )}
              </Fragment>)}
            </tbody>
          </table>}
        </StateBoundary>
      </div>
    </section>
  </div>;
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
          </div>
        </div>

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <h2>登记家庭 / 住宅出口</h2>
          <p>
            <code>catalog</code> 类型的 <code>proxyName</code> 必须与已发布 catalog 里该节点的 Clash <code>name</code> 完全一致；
            <code>socks5</code> 类型由云端直接下发家宽上游凭据，客户端经用户选中节点链式出网。
            登记为 active 后，家庭出口只会出现在绑定用户的 catalog 里。
          </p>
        </div>
      </div>
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
    </section>

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

function MonitorPage() {
  const resource = useResource(operationsApi.live);
  return <StateBoundary resource={resource}>{(live: LiveDto) => {
    const qualityNodes = live.quality?.nodes ?? [];
    const agents = live.agents ?? [];
    const agentByName = new Map(agents.map((agent) => [agent.name, agent]));
    const blocked = qualityNodes.filter((node) => node.block && node.block.status !== 'OK');
    const degraded = qualityNodes.filter((node) => node.quality && node.quality !== 'ok');
    return <div className="stack">
      {(live.agentsError || live.qualityError) && (
        <Banner
          tone="error"
          message={[
            live.agentsError ? `Komari 数据源：${live.agentsError}` : null,
            live.qualityError ? `质量报告数据源：${live.qualityError}` : null,
          ].filter(Boolean).join('；')}
        />
      )}

      <div className="metrics">
        <article className="metric">
          <div className="metric-label"><span>监控节点</span></div>
          <div className="metric-value">{qualityNodes.length}</div>
          <div className="metric-hint">采集于 {timestamp(live.quality?.updatedAt)}</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>Komari 探针</span></div>
          <div className="metric-value">{agents.length}</div>
          <div className="metric-hint">实时资源监控 agent</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>被墙</span></div>
          <div className="metric-value">{blocked.length}</div>
          <div className="metric-hint">大陆探针多数不通</div>
        </article>
        <article className="metric">
          <div className="metric-label"><span>质量异常</span></div>
          <div className="metric-value">{degraded.length}</div>
          <div className="metric-hint">IP 质量关键词命中</div>
        </article>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>节点</th><th>探针</th><th>大陆探测</th><th>被墙</th><th>IP 质量</th><th>回程线路</th><th>风险词</th></tr>
            </thead>
            <tbody>{qualityNodes.map((node) => {
              const agent = agentByName.get(node.name);
              return <tr key={node.name}>
                <td><strong>{node.name}</strong>{node.host ? <small className="mono">{node.host}</small> : null}</td>
                <td>
                  {agent ? <Status value="active" /> : <span className="muted">未安装</span>}
                  {agent?.os ? <small className="muted">{agent.os}</small> : null}
                </td>
                <td>{node.ok ? <Status value="active" /> : <Status value="degraded" />}</td>
                <td>
                  {node.block
                    ? (node.block.status === 'OK' ? <Status value="active" /> : <Status value="degraded" />)
                    : '—'}
                  {node.block?.label ? <small className="muted">{node.block.label}</small> : null}
                </td>
                <td>{node.quality ?? '—'}</td>
                <td className="muted">{node.routeKeywords.join(' · ') || '—'}</td>
                <td className="muted">{node.riskKeywords.join(' · ') || '—'}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>

      <div className="quick-links">
        <a className="link-card" href="https://ops.afk.ccwu.cc/" target="_blank" rel="noreferrer">
          <strong>Komari 完整面板 ↗</strong>
          <span>CPU / 内存 / 流量 / 延迟曲线</span>
        </a>
        <a className="link-card" href="https://quality.afk.ccwu.cc/" target="_blank" rel="noreferrer">
          <strong>质量面板 ↗</strong>
          <span>securityCheck / backtrace 完整报告</span>
        </a>
      </div>
    </div>;
  }}</StateBoundary>;
}

function Servers() {
  const resource = useResource(operationsApi.servers);
  return <StateBoundary resource={resource} empty={(rows: ServerDto[]) => rows.length === 0}>{(rows) => <div className="cards">
    {rows.map((server) => <article className="card server-card" key={server.id}>
      <div className="card-heading">
        <div>
          <span className="eyebrow">{server.regionCode}</span>
          <h2>{server.displayName}</h2>
        </div>
        <Status value={server.status} />
      </div>
      <dl>
        <div><dt>Provider</dt><dd>{server.provider || 'Not recorded'}</dd></div>
        <div><dt>Latest release</dt><dd>{server.latestDeployment?.releaseVersion || 'No deployment'}</dd></div>
        <div><dt>Deployment</dt><dd>{server.latestDeployment ? <Status value={server.latestDeployment.status} /> : '—'}</dd></div>
        <div><dt>Updated</dt><dd>{timestamp(server.updatedAt)}</dd></div>
      </dl>
    </article>)}
  </div>}</StateBoundary>;
}

function Nodes() {
  const resource = useResource(operationsApi.nodes);
  return <div className="card">
    <div className="table-wrap">
      <StateBoundary resource={resource} empty={(rows: NodeDto[]) => rows.length === 0}>{(rows) => <table>
        <thead><tr><th>Node</th><th>Server</th><th>Region</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>{rows.map((node) => <tr key={node.id}>
          <td><strong>{node.displayName}</strong><small className="mono">{node.id}</small></td>
          <td>{node.serverDisplayName}</td>
          <td>{node.regionCode}</td>
          <td><Status value={node.status} /></td>
          <td className="muted">{timestamp(node.updatedAt)}</td>
        </tr>)}</tbody>
      </table>}</StateBoundary>
    </div>
  </div>;
}

function Catalog() {
  const resource = useResource(operationsApi.catalogRevisions);
  return <StateBoundary resource={resource} empty={(rows: CatalogRevisionDto[]) => rows.length === 0}>{(rows) => <div className="timeline">
    {rows.map((revision) => <article className="revision" key={revision.revision}>
      <div className="revision-number">r{revision.revision}</div>
      <div>
        <div className="card-heading">
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Catalog revision {revision.revision}</h2>
          {revision.current && <Status value="active" />}
        </div>
        <p className="hash">{revision.sha256}</p>
        <p className="muted">{revision.serverCount} servers · {revision.logicalNodeCount} nodes · {revision.deploymentCount} deployments · {timestamp(revision.publishedAt)}</p>
      </div>
    </article>)}
  </div>}</StateBoundary>;
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
            <small>Admin</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map(([group, items]) => (
            <div key={group}>
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
          <a href="https://quality.afk.ccwu.cc/" target="_blank" rel="noreferrer">
            <Icon d={icons.quality} />
            节点质量
            <Icon d={icons.external} style={{ marginLeft: 'auto', width: 12, height: 12, opacity: 0.6 }} />
          </a>
          <a href="https://ops.afk.ccwu.cc/" target="_blank" rel="noreferrer">
            <Icon d={icons.komari} />
            Komari
            <Icon d={icons.external} style={{ marginLeft: 'auto', width: 12, height: 12, opacity: 0.6 }} />
          </a>
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
                {page === 'dashboard' && '节点健康、用户流量与节点分布，一屏速览'}
                {page === 'monitor' && 'Komari 探针 + 大陆探测 / 被墙 / IP 质量实时聚合'}
                {page === 'users' && '注册白名单、账号启停、家庭 IP 绑定'}
                {page === 'homes' && '登记住宅 / 家庭出口节点'}
                {page === 'servers' && '物理服务器只读清单'}
                {page === 'nodes' && '逻辑 catalog 节点'}
                {page === 'catalog' && '已发布 revision 元数据'}
              </p>
            </div>
          </div>

          {page === 'dashboard' && <Dashboard />}
          {page === 'monitor' && <MonitorPage />}
          {page === 'users' && <UsersPage />}
          {page === 'homes' && <HomesPage />}
          {page === 'servers' && <Servers />}
          {page === 'nodes' && <Nodes />}
          {page === 'catalog' && <Catalog />}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
