import { StrictMode, useEffect, useMemo, useState, type FormEvent, type ReactNode, type SVGProps } from 'react';
import { createRoot } from 'react-dom/client';
import {
  operationsApi,
  type AllowlistEntry,
  type CatalogRevisionDto,
  type DashboardDto,
  type HomeExitDto,
  type NodeDto,
  type ServerDto,
  type UserDto,
} from './api';
import './styles.css';

type Page = 'dashboard' | 'users' | 'homes' | 'servers' | 'nodes' | 'catalog';
type Resource<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

const pages: Array<{ id: Page; label: string; group: string }> = [
  { id: 'dashboard', label: '总览', group: '概览' },
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

function Dashboard() {
  const resource = useResource(operationsApi.dashboard);
  return <StateBoundary resource={resource}>{(data: DashboardDto) => <>
    <div className="metrics">
      {([
        ['用户', data.users, '已注册账号'],
        ['设备', data.devices, '客户端设备'],
        ['服务器', data.servers, '物理机清单'],
        ['逻辑节点', data.logicalNodes, 'catalog 节点'],
      ] as const).map(([label, value, hint]) => (
        <article className="metric" key={label}>
          <div className="metric-label"><span>{label}</span></div>
          <div className="metric-value">{value.active}</div>
          <div className="metric-hint">{value.total} 总计 · {hint}</div>
        </article>
      ))}
    </div>

    <div className="catalog-banner">
      <div>
        <div className="eyebrow">Encrypted catalog</div>
        <h2>Revision {data.catalog.revision}</h2>
      </div>
      <div className="muted">更新于 {timestamp(data.catalog.updatedAt)}</div>
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
        <span>被墙 · 回程 · IP 质量</span>
      </a>
    </div>
  </>}</StateBoundary>;
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
          {(rows) => <div className="chip-list">
            {rows.map((entry) => <span className="chip" key={entry.email}>
              {entry.email}
              <button type="button" className="chip-x" disabled={busy} onClick={() => removeAllow(entry.email)} aria-label="remove">×</button>
            </span>)}
          </div>}
        </StateBoundary>
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
              {rows.map((user) => <tr key={user.id}>
                <td>
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
                      <small className="mono">{user.homeBinding.proxyName}{user.homeBinding.egressIpv4 ? ` · ${user.homeBinding.egressIpv4}` : ''}</small>
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
                          {home.displayName} ({home.proxyName}{home.egressIpv4 ? ` · ${home.egressIpv4}` : ''})
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
              </tr>)}
            </tbody>
          </table>}
        </StateBoundary>
      </div>
    </section>
  </div>;
}

function HomesPage() {
  const homes = useResource(operationsApi.homeExits);
  const [proxyName, setProxyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [egressIpv4, setEgressIpv4] = useState('');
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
        notes: notes.trim() || undefined,
      });
      setMessage(`已登记 ${created.displayName}（${created.proxyName}）`);
      setProxyName('');
      setDisplayName('');
      setEgressIpv4('');
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
            <code>proxyName</code> 必须与已发布 catalog 里该节点的 Clash <code>name</code> 完全一致。
            登记为 active 后，该节点只会出现在绑定用户的 catalog 里。
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
                <th>家庭 IP</th>
                <th>状态</th>
                <th>更新</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((home) => <tr key={home.id}>
                <td><strong>{home.displayName}</strong>{home.notes ? <small>{home.notes}</small> : null}</td>
                <td className="mono">{home.proxyName}</td>
                <td className="mono">{home.egressIpv4 || '—'}</td>
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
                {page === 'dashboard' && '控制面容量与快捷入口'}
                {page === 'users' && '注册白名单、账号启停、家庭 IP 绑定'}
                {page === 'homes' && '登记住宅 / 家庭出口节点'}
                {page === 'servers' && '物理服务器只读清单'}
                {page === 'nodes' && '逻辑 catalog 节点'}
                {page === 'catalog' && '已发布 revision 元数据'}
              </p>
            </div>
          </div>

          {page === 'dashboard' && <Dashboard />}
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
